// Renderer-side mirror of the main-process IPC payload shapes (see
// source/preload.ts and source/main.ts). The renderer can't import from the
// main process directly, so these types are kept in sync by hand. If an IPC
// payload shape changes in main.ts/preload.ts, update the matching type here.

type InspectionStage = "idle" | "opening" | "ready" | "inspecting" | "editing" | "exported" | "error";

type EpubEditableKind = "xhtml" | "html" | "xml" | "css" | "opf" | "ncx" | "txt";

interface EpubInspectError {
  fileName: string;
  line: string;
  error: string;
  severity?: "fatal" | "error" | "warning" | "usage" | "info" | string;
  code?: string;
  lineNumber?: number;
  column?: number;
  rawMessage?: string;
  filePath?: string;
  source?: "epubcheck" | "ace";
}

interface EpubInspectResult {
  status: "success" | "error";
  errors: EpubInspectError[];
}

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

interface EpubSelectFileResult {
  canceled: boolean;
  filePath: string | null;
  fileName: string | null;
}

interface EpubWorkspaceInspectResponse {
  exportPath: string;
  result: EpubInspectResult;
}

interface EpubWorkspaceExportResult {
  workspaceId: string;
  filePath: string;
}

interface EpubWorkspaceExportAsResult {
  canceled: boolean;
  filePath: string | null;
}

interface EpubIssueTarget {
  issue: EpubInspectError;
  filePath: string;
  lineNumber: number;
  column: number;
}

// One open EPUB = one EpubWorkspaceState = one workspace tab. Everything a
// tab needs to redraw itself independently (file list, editor content, issue
// list, export status) lives here so switching tabs never loses state.
interface EpubWorkspaceState {
  stage: InspectionStage;
  workspaceId: string;
  sourcePath: string;
  fileName: string;
  files: EpubWorkspaceFile[];
  activeFilePath: string;
  activeContent: string;
  issues: EpubInspectError[];
  exportPath: string;
  message: string;
}

// Top-level renderer state: the full set of open workspace tabs plus which
// one is active. WorkspaceStore owns this; AppController only reads it.
interface EpubAppState {
  tabs: EpubWorkspaceState[];
  activeWorkspaceId: string;
  activeWorkspace: EpubWorkspaceState;
  message: string;
}

export {
  InspectionStage,
  EpubEditableKind,
  EpubInspectError,
  EpubInspectResult,
  EpubWorkspaceFile,
  EpubWorkspaceOpenResult,
  EpubWorkspaceFileContent,
  EpubSelectFileResult,
  EpubWorkspaceInspectResponse,
  EpubWorkspaceExportResult,
  EpubWorkspaceExportAsResult,
  EpubIssueTarget,
  EpubWorkspaceState,
  EpubAppState,
};
