import type { EpubInspectError, EpubIssueTarget, EpubWorkspaceFile } from "./types.js";

/**
 * Resolves a validation issue (from EPUBCheck or Ace) to one of the EPUB's
 * internal editable files, so the UI can open the right file and jump to a
 * line/column.
 *
 * The tricky part: EPUBCheck and Ace don't report paths the same way the
 * in-memory zip workspace stores them — they may be absolute file:// URLs,
 * OS-specific slashes, or paths relative to a temp export folder rather than
 * the EPUB root. `resolveIssueTarget` normalizes both sides and picks the
 * best fuzzy match instead of requiring an exact string match.
 */
class IssueMapper {
  public static normalizePath = (value: string): string => {
    const withoutFragment = String(value ?? "")
      .trim()
      .replace(/[?#].*$/, "");
    let pathname = withoutFragment;
    try {
      const parsed = new URL(withoutFragment);
      pathname = parsed.protocol === "file:" ? parsed.pathname : withoutFragment;
    } catch {}
    try {
      pathname = decodeURIComponent(pathname);
    } catch {}
    return pathname
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .replace(/^[A-Za-z]:\//, "")
      .replace(/^\/+/, "")
      .trim();
  };

  private static basename = (value: string): string => {
    return value.split("/").filter(Boolean).at(-1) ?? "";
  };

  // Builds several plausible forms of the same path (full path, path from an
  // EPUB root marker like OEBPS/, last two segments, bare filename) since we
  // don't know in advance how much of the reported path survived export.
  private static getPathCandidates = (value: string): string[] => {
    const normalized = IssueMapper.normalizePath(value);
    if (normalized === "") {
      return [];
    }
    const parts = normalized.split("/").filter(Boolean);
    const candidates: string[] = [normalized];
    const epubRootMarkers = ["META-INF", "OEBPS", "OPS", "EPUB"];
    for (const marker of epubRootMarkers) {
      const index = parts.findIndex((part) => part.toLowerCase() === marker.toLowerCase());
      if (index >= 0) {
        candidates.push(parts.slice(index).join("/"));
      }
    }
    if (parts.length > 1) {
      candidates.push(parts.slice(-2).join("/"));
    }
    candidates.push(parts.at(-1) ?? "");
    return Array.from(new Set(candidates.filter((candidate) => candidate !== "")));
  };

  private static pathEndsWithSegment = (value: string, suffix: string): boolean => {
    return value === suffix || value.endsWith(`/${suffix}`);
  };

  // Higher score = more confident match. Tiers, best to worst:
  //   1000s: exact path match.
  //    800s: candidate is a path-segment suffix of the workspace file.
  //    600s: workspace file is a path-segment suffix of the candidate
  //          (rejected if the candidate is a bare filename that isn't unique
  //          across the EPUB — ambiguous, safer to not guess).
  //    100s: same filename and that filename is unique in the EPUB.
  //      -1: no usable match.
  private static scorePathMatch = (
    candidate: string,
    filePath: string,
    basenameCounts: Map<string, number>,
  ): number => {
    if (candidate === filePath) {
      return 1000 + filePath.length;
    }
    if (IssueMapper.pathEndsWithSegment(candidate, filePath)) {
      return 800 + filePath.length;
    }
    if (IssueMapper.pathEndsWithSegment(filePath, candidate)) {
      if (!candidate.includes("/") && basenameCounts.get(candidate) !== 1) {
        return -1;
      }
      return 600 + candidate.length;
    }
    const candidateBase = IssueMapper.basename(candidate);
    const fileBase = IssueMapper.basename(filePath);
    if (candidateBase !== "" && candidateBase === fileBase && basenameCounts.get(candidateBase) === 1) {
      return 100 + candidateBase.length;
    }
    return -1;
  };

  // Scores every (candidate path) x (workspace file) pair and returns the
  // best-scoring file, with a safe line/column fallback (1,1) so callers can
  // always jump into the editor even when EPUBCheck/Ace didn't report a
  // precise location.
  public static resolveIssueTarget = (issue: EpubInspectError, files: EpubWorkspaceFile[]): EpubIssueTarget | null => {
    const candidates = IssueMapper.getPathCandidates(issue.filePath ?? "");
    if (candidates.length === 0) {
      return null;
    }

    const normalizedFiles = files.map((file) => ({
      ...file,
      normalizedPath: IssueMapper.normalizePath(file.path),
    }));
    const basenameCounts = new Map<string, number>();
    for (const file of normalizedFiles) {
      const base = IssueMapper.basename(file.normalizedPath);
      if (base !== "") {
        basenameCounts.set(base, (basenameCounts.get(base) ?? 0) + 1);
      }
    }

    let best: { file: EpubWorkspaceFile; score: number } | null = null;
    for (const file of normalizedFiles) {
      for (const candidate of candidates) {
        const score = IssueMapper.scorePathMatch(candidate, file.normalizedPath, basenameCounts);
        if (score > (best?.score ?? -1)) {
          best = { file, score };
        }
      }
    }

    if (!best || best.score < 0) {
      return null;
    }

    return {
      issue,
      filePath: best.file.path,
      lineNumber: issue.lineNumber && issue.lineNumber > 0 ? issue.lineNumber : 1,
      column: issue.column && issue.column > 0 ? issue.column : 1,
    };
  };
}

export { IssueMapper };
