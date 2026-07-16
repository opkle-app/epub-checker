import type { LocalizedMessage } from "../i18n/types.js";

// Renderer-side mirror of the main-process IPC payload shapes (see
// source/preload.ts and source/main.ts). The renderer can't import from the
// main process directly, so these types are kept in sync by hand. If an IPC
// payload shape changes in main.ts/preload.ts, update the matching type here.

type InspectionStage = "idle" | "opening" | "ready" | "inspecting" | "editing" | "validated" | "exported" | "error";

type EpubEditableKind = "xhtml" | "html" | "xml" | "css" | "opf" | "ncx" | "txt";

interface EpubRuntimeStatus {
  code:
    | "chromium-checking"
    | "chromium-preparing"
    | "chromium-downloading"
    | "chromium-ready"
    | "chromium-unavailable"
    | "chromium-download-failed";
  detail?: string;
}

interface EpubInspectError {
  fileName: string;
  line: string;
  error: string;
  severity?: "fatal" | "error" | "warning" | "usage" | "info" | string;
  code?: string;
  lineNumber?: number;
  column?: number;
  rawMessage?: string;
  suggestion?: string;
  additionalLocations?: number;
  filePath?: string;
  source?: "epubcheck" | "ace";
}

interface EpubInspectResult {
  status: "success" | "error";
  errors: EpubInspectError[];
  logs: string[];
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
  revision: number;
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
  result: EpubInspectResult;
  revision: number;
  aceUnavailableReason?: string;
}

interface EpubWorkspaceExportResult {
  workspaceId: string;
  filePath: string;
  revision: number;
}

interface EpubWorkspaceExportAsResult {
  canceled: boolean;
  filePath: string | null;
  files?: EpubWorkspaceFile[];
  revision?: number;
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
  logs: string[];
  exportPath: string;
  message: LocalizedMessage;
  revision: number;
}

// Top-level renderer state: the full set of open workspace tabs plus which
// one is active. WorkspaceStore owns this; AppController only reads it.
interface EpubAppState {
  tabs: EpubWorkspaceState[];
  activeWorkspaceId: string;
  activeWorkspace: EpubWorkspaceState;
  message: LocalizedMessage;
  runtimeMessage: LocalizedMessage;
}

export {
  InspectionStage,
  EpubRuntimeStatus,
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
