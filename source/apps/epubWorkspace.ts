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
}

interface EpubWorkspaceFileContent {
  workspaceId: string;
  path: string;
  content: string;
}

interface EpubWorkspaceExportResult {
  workspaceId: string;
  filePath: string;
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
}

class EpubWorkspaceManager {
  private sessions: Map<string, EpubWorkspaceSession> = new Map();

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
    const buffer = await fsPromise.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const workspaceId = randomUUID();
    const session: EpubWorkspaceSession = {
      id: workspaceId,
      sourcePath: filePath,
      fileName: path.basename(filePath),
      zip,
      dirtyFiles: new Set(),
    };
    this.sessions.set(workspaceId, session);
    return {
      workspaceId,
      sourcePath: filePath,
      fileName: session.fileName,
      files: this.listEditableFiles(session),
    };
  };

  public getFile = async (workspaceId: string, filePath: string): Promise<EpubWorkspaceFileContent> => {
    const session = this.getSession(workspaceId);
    const file = session.zip.file(filePath);
    if (!file) {
      throw new Error("EPUB internal file not found");
    }
    return {
      workspaceId,
      path: filePath,
      content: await file.async("string"),
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
    return {
      workspaceId,
      sourcePath: session.sourcePath,
      fileName: session.fileName,
      files: this.listEditableFiles(session),
    };
  };

  public export = async (workspaceId: string, outputPath?: string): Promise<EpubWorkspaceExportResult> => {
    const session = this.getSession(workspaceId);
    const targetPath =
      outputPath ??
      path.join(
        Mother.tempFolder,
        "repaired",
        `${path.basename(session.fileName, path.extname(session.fileName))}-repaired-${Date.now()}.epub`,
      );

    await fsPromise.mkdir(path.dirname(targetPath), { recursive: true });

    const outputZip = new JSZip();
    const mimetypeFile = session.zip.file("mimetype");
    // EPUB requires the mimetype entry to be the first item and stored without
    // compression. Some readers and validators reject archives that break this
    // packaging rule, so rebuilds preserve that special case explicitly.
    if (mimetypeFile) {
      outputZip.file("mimetype", await mimetypeFile.async("string"), {
        compression: "STORE",
      });
    }

    const entries: Array<Promise<void>> = [];
    session.zip.forEach((relativePath, file) => {
      if (relativePath === "mimetype") {
        return;
      }
      if (file.dir) {
        outputZip.folder(relativePath);
        return;
      }
      entries.push(
        file.async("nodebuffer").then((buffer) => {
          outputZip.file(relativePath, buffer);
        }),
      );
    });
    await Promise.all(entries);

    const buffer = await outputZip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    await fsPromise.writeFile(targetPath, buffer);

    return {
      workspaceId,
      filePath: targetPath,
    };
  };

  public inspect = async (
    workspaceId: string,
    maker: EpubMaker,
    includeAce: boolean,
  ): Promise<{ exportPath: string; result: EpubInspectResult }> => {
    const exported = await this.export(workspaceId);
    const result = await maker.inspectEpub(exported.filePath, {
      includeAce,
      deleteMode: false,
    });
    return {
      exportPath: exported.filePath,
      result,
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
