import fsPromise from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import JSZip from "jszip";
import { Mother } from "./mother.js";
import { EpubMaker } from "./epubMaker/epubMaker.js";
import type { EpubInspectResult } from "./classStorage/epubType.js";

type EpubEditableKind = "xhtml" | "html" | "xml" | "css" | "opf" | "ncx" | "txt";

interface EpubWorkspaceFile {
  path: string;
  kind: EpubEditableKind;
  size: number;
  dirty: boolean;
}

interface EpubWorkspaceOpenResult {
  workspaceId: string;
  sourcePath: string;
  fileName: string;
  files: EpubWorkspaceFile[];
  revision: number;
}

interface EpubWorkspaceFileContent {
  workspaceId: string;
  path: string;
  content: string;
}

interface EpubWorkspaceExportResult {
  workspaceId: string;
  filePath: string;
  revision: number;
}

interface EpubWorkspaceSession {
  id: string;
  sourcePath: string;
  fileName: string;
  // JSZip is kept in memory for the life of one app-level EPUB tab.
  // Editing an internal file mutates this zip session, while the original EPUB
  // on disk remains untouched until the user exports a repaired copy.
  zip: JSZip;
  dirtyFiles: Set<string>;
  revision: number;
}

class EpubWorkspaceManager {
  // Generous caps for any legitimate EPUB, but bound how much memory a
  // crafted archive can force this process to allocate when decompressed.
  private static readonly MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
  private static readonly MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
  private static readonly MAX_SINGLE_ENTRY_BYTES = 128 * 1024 * 1024;

  private sessions: Map<string, EpubWorkspaceSession> = new Map();

  // The ZIP central directory's declared "uncompressed size" per entry
  // (what `open()`'s pre-check below sums) is attacker-controlled metadata —
  // JSZip does not cap decompression to it, only compares actual-vs-declared
  // size *after* fully inflating, so a small on-disk entry can still declare
  // a tiny size while its real DEFLATE stream expands far past it (a classic
  // zip-bomb). The actual enforcement point has to be while bytes are
  // streaming out of the decompressor, not a check against metadata the
  // attacker also controls — hence this streams each entry and aborts the
  // moment either the per-entry or the shared aggregate cap is exceeded,
  // instead of buffering via `.async(...)` and checking afterward.
  private static readEntryLimited = (
    file: JSZip.JSZipObject,
    options: { maxEntryBytes: number; aggregate?: { total: number; max: number } },
  ): Promise<Buffer> => {
    return new Promise((resolve, reject) => {
      const stream = file.nodeStream("nodebuffer");
      const chunks: Buffer[] = [];
      let entryTotal = 0;
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        (stream as unknown as { destroy?: () => void }).destroy?.();
        reject(err);
      };
      stream.on("data", (chunk: Buffer) => {
        if (settled) return;
        entryTotal += chunk.length;
        if (entryTotal > options.maxEntryBytes) {
          fail(new Error(`Zip entry exceeds the ${options.maxEntryBytes}-byte decompression limit`));
          return;
        }
        if (options.aggregate) {
          options.aggregate.total += chunk.length;
          if (options.aggregate.total > options.aggregate.max) {
            fail(new Error(`EPUB contents exceed the ${options.aggregate.max}-byte total decompression limit`));
            return;
          }
        }
        chunks.push(chunk);
      });
      stream.on("end", () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks));
      });
      stream.on("error", fail);
    });
  };

  private getEditableKind = (filePath: string): EpubEditableKind | null => {
    const lower = filePath.toLowerCase();
    if (/\.xhtml$/.test(lower)) {
      return "xhtml";
    }
    if (/\.html?$/.test(lower)) {
      return "html";
    }
    if (/\.opf$/.test(lower)) {
      return "opf";
    }
    if (/\.ncx$/.test(lower)) {
      return "ncx";
    }
    if (/\.xml$/.test(lower)) {
      return "xml";
    }
    if (/\.css$/.test(lower)) {
      return "css";
    }
    if (/\.txt$/.test(lower)) {
      return "txt";
    }
    return null;
  };

  private getSession = (workspaceId: string): EpubWorkspaceSession => {
    const session = this.sessions.get(workspaceId);
    if (!session) {
      throw new Error("EPUB workspace not found");
    }
    return session;
  };

  private listEditableFiles = (session: EpubWorkspaceSession): EpubWorkspaceFile[] => {
    const files: EpubWorkspaceFile[] = [];
    session.zip.forEach((relativePath, file) => {
      if (file.dir) {
        return;
      }
      const kind = this.getEditableKind(relativePath);
      if (!kind) {
        return;
      }
      files.push({
        path: relativePath,
        kind,
        size: Number((file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0),
        dirty: session.dirtyFiles.has(relativePath),
      });
    });
    return files.sort((a, b) => a.path.localeCompare(b.path));
  };

  public open = async (filePath: string): Promise<EpubWorkspaceOpenResult> => {
    if (!/\.epub$/i.test(filePath)) {
      throw new Error("Only .epub files can be opened");
    }
    const sourceStat = await fsPromise.stat(filePath);
    if (sourceStat.size > EpubWorkspaceManager.MAX_ARCHIVE_BYTES) {
      throw new Error("EPUB archive is larger than the 512 MiB safety limit");
    }
    const buffer = await fsPromise.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);

    let totalUncompressedBytes = 0;
    zip.forEach((_relativePath, file) => {
      if (!file.dir) {
        totalUncompressedBytes += Number(
          (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0,
        );
      }
    });
    if (totalUncompressedBytes > EpubWorkspaceManager.MAX_UNCOMPRESSED_BYTES) {
      // Fast rejection for the honest case (a genuinely huge EPUB) without
      // decompressing anything — NOT the real defense against a lying zip,
      // since this metadata is attacker-controlled. getFile()/export() below
      // enforce the actual limit against real decompressed bytes as they
      // stream out, which is what a crafted archive can't lie its way past.
      const mib = (n: number) => Math.round(n / (1024 * 1024));
      throw new Error(
        `EPUB contents are too large to open (${mib(totalUncompressedBytes)} MiB uncompressed, ` +
          `limit ${mib(EpubWorkspaceManager.MAX_UNCOMPRESSED_BYTES)} MiB)`,
      );
    }

    const workspaceId = randomUUID();
    const session: EpubWorkspaceSession = {
      id: workspaceId,
      sourcePath: filePath,
      fileName: path.basename(filePath),
      zip,
      dirtyFiles: new Set(),
      revision: 0,
    };
    this.sessions.set(workspaceId, session);
    return {
      workspaceId,
      sourcePath: filePath,
      fileName: session.fileName,
      files: this.listEditableFiles(session),
      revision: session.revision,
    };
  };

  public getFile = async (workspaceId: string, filePath: string): Promise<EpubWorkspaceFileContent> => {
    const session = this.getSession(workspaceId);
    const file = session.zip.file(filePath);
    if (!file) {
      throw new Error("EPUB internal file not found");
    }
    const buffer = await EpubWorkspaceManager.readEntryLimited(file, {
      maxEntryBytes: EpubWorkspaceManager.MAX_SINGLE_ENTRY_BYTES,
    });
    return {
      workspaceId,
      path: filePath,
      content: buffer.toString("utf8"),
    };
  };

  public updateFile = async (
    workspaceId: string,
    filePath: string,
    content: string,
  ): Promise<EpubWorkspaceOpenResult> => {
    const session = this.getSession(workspaceId);
    if (!session.zip.file(filePath)) {
      throw new Error("EPUB internal file not found");
    }
    session.zip.file(filePath, content);
    session.dirtyFiles.add(filePath);
    session.revision += 1;
    return {
      workspaceId,
      sourcePath: session.sourcePath,
      fileName: session.fileName,
      files: this.listEditableFiles(session),
      revision: session.revision,
    };
  };

  public export = async (workspaceId: string, outputPath?: string): Promise<EpubWorkspaceExportResult> => {
    const session = this.getSession(workspaceId);
    const revision = session.revision;
    const targetPath =
      outputPath ??
      path.join(
        Mother.tempFolder,
        "repaired",
        `${path.basename(session.fileName, path.extname(session.fileName))}-repaired-${randomUUID()}.epub`,
      );

    await fsPromise.mkdir(path.dirname(targetPath), { recursive: true });

    const outputZip = new JSZip();
    // Shared across every entry decompressed in this export() call. A
    // per-entry-only cap would still allow many medium-sized entries to exceed
    // the total safety budget.
    const decompressionBudget = { total: 0, max: EpubWorkspaceManager.MAX_UNCOMPRESSED_BYTES };
    const mimetypeFile = session.zip.file("mimetype");
    // EPUB requires the mimetype entry to be the first item and stored without
    // compression. Some readers and validators reject archives that break this
    // packaging rule, so rebuilds preserve that special case explicitly.
    if (mimetypeFile) {
      const mimetypeBuffer = await EpubWorkspaceManager.readEntryLimited(mimetypeFile, {
        maxEntryBytes: EpubWorkspaceManager.MAX_SINGLE_ENTRY_BYTES,
        aggregate: decompressionBudget,
      });
      outputZip.file("mimetype", mimetypeBuffer, {
        compression: "STORE",
      });
    }

    const entries: Array<{ relativePath: string; file: JSZip.JSZipObject }> = [];
    session.zip.forEach((relativePath, file) => {
      if (relativePath === "mimetype") {
        return;
      }
      if (file.dir) {
        outputZip.folder(relativePath);
        return;
      }
      entries.push({ relativePath, file });
    });
    // Inflate sequentially. JSZip still needs the completed archive in memory,
    // but this avoids multiplying peak memory by inflating many large entries
    // concurrently on top of the output buffer.
    for (const entry of entries) {
      const buffer = await EpubWorkspaceManager.readEntryLimited(entry.file, {
        maxEntryBytes: EpubWorkspaceManager.MAX_SINGLE_ENTRY_BYTES,
        aggregate: decompressionBudget,
      });
      outputZip.file(entry.relativePath, buffer);
    }

    const buffer = await outputZip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    await fsPromise.writeFile(targetPath, buffer);

    return {
      workspaceId,
      filePath: targetPath,
      revision,
    };
  };

  // Releases the in-memory JSZip session for a closed tab. Without this,
  // EpubWorkspaceManager.sessions grows for every EPUB ever opened in the
  // app's lifetime, not just the ones currently open — main-process memory
  // scales with total EPUBs opened over a long session, not concurrent count.
  public close = (workspaceId: string): void => {
    this.sessions.delete(workspaceId);
  };

  public markExported = (workspaceId: string, exportedRevision: number): EpubWorkspaceFile[] => {
    const session = this.getSession(workspaceId);
    if (session.revision === exportedRevision) {
      session.dirtyFiles.clear();
    }
    return this.listEditableFiles(session);
  };

  public inspect = async (
    workspaceId: string,
    maker: EpubMaker,
    includeAce: boolean,
  ): Promise<{ result: EpubInspectResult; revision: number }> => {
    const exported = await this.export(workspaceId);
    // Unlike epub:inspect-file (which inspects the user's own original file
    // and must never delete it), `exported.filePath` here is always a fresh
    // throwaway copy this call just wrote under Mother.tempFolder/repaired —
    // deleteMode:true so repeated "검사" clicks during editing don't
    // accumulate a full EPUB copy on disk on every single validation.
    const result = await maker.inspectEpub(exported.filePath, {
      includeAce,
      deleteMode: true,
    });
    return {
      result,
      revision: exported.revision,
    };
  };
}

export {
  EpubWorkspaceManager,
  EpubWorkspaceFile,
  EpubWorkspaceOpenResult,
  EpubWorkspaceFileContent,
  EpubWorkspaceExportResult,
};
