import type { InspectionStage } from "../../core/types.js";
import type { Messages } from "../types.js";

const stageLabels: Record<InspectionStage, string> = {
  idle: "Idle",
  opening: "Opening",
  ready: "Ready",
  inspecting: "Inspecting",
  editing: "Editing",
  validated: "Validated",
  exported: "Exported",
  error: "Error",
};

const en: Messages = {
  closeWindow: "Close",
  openEpub: "Open EPUB",
  dropEpub: "Drop .epub files here",
  inspect: "Inspect",
  reinspect: "Re-inspect",
  exportEpub: "Export",
  idle: "Idle",
  inspectionTab: "Inspection",
  logTab: "Logs",
  inspectionItems: "Inspection issues",
  inspectingEpub: "Inspecting EPUB",
  workspaceLabel: "> Workspaces",
  internalFilesLabel: "> Internal files",
  noOpenEpub: "No EPUBs open",
  noInspectionResults: "No inspection results yet.",
  switchToKorean: "Switch to Korean",
  switchToEnglish: "Switch to English",
  noEpub: "No EPUB",
  stageLabel: (stage) => stageLabels[stage],
  workspaceMeta: ({ stage, issueCount, dirtyCount }) => {
    const issues = `${issueCount} ${issueCount === 1 ? "issue" : "issues"}`;
    const edits = dirtyCount > 0 ? ` · ${dirtyCount} ${dirtyCount === 1 ? "edit" : "edits"}` : "";
    return `${stageLabels[stage]} · ${issues}${edits}`;
  },
  statusInitial: "Open an EPUB file to begin inspection.",
  statusUnsavedTabConfirm: ({ fileName }) =>
    `“${fileName}” has changes that have not been exported. Closing this tab will discard them.`,
  statusCloseSaveFailed: ({ detail }) => `The tab was not closed because auto-save failed: ${detail}`,
  statusDroppedPathUnavailable: "The dropped file path could not be read.",
  statusOpeningArchive: "Opening the EPUB archive and reading its internal documents.",
  statusOpened: "The file is open. Run an inspection or select an internal document.",
  statusEditingFile: ({ filePath }) => `Editing ${filePath}`,
  statusAutoSaving: "Auto-saving changes.",
  statusAutoSaveFailed: ({ detail }) => `Auto-save failed: ${detail}`,
  statusSaved: "Saved to the workspace",
  statusAutoSaveTimeout: ({ seconds }) => `Auto-save did not finish within ${seconds} seconds.`,
  statusUnsavedAppConfirm: ({ count }) =>
    `${count} ${count === 1 ? "EPUB has" : "EPUBs have"} changes that have not been exported. Quitting will discard them.`,
  statusQuitSaveFailed: ({ detail }) => `The app was not closed because auto-save failed: ${detail}`,
  statusInspecting: "Running W3C EPUBCheck and Ace accessibility inspection.",
  statusInspectionStale: "The content changed during inspection, so these results are stale. Run the inspection again.",
  statusPassedAceSkipped: "EPUBCheck passed. Ace was skipped because Chromium could not be prepared.",
  statusPassed: "EPUBCheck and Ace found no errors. The repaired EPUB is ready to export.",
  statusIssuesFound: ({ count, aceSkipped }) =>
    `${count} inspection ${count === 1 ? "issue was" : "issues were"} found.${aceSkipped ? " Ace was skipped because Chromium could not be prepared." : ""}`,
  statusOperationFailed: ({ detail }) => detail,
  statusExportComplete: ({ filePath }) => `EPUB created: ${filePath}`,
  statusExportCompleteWithChanges: ({ filePath }) =>
    `EPUB created: ${filePath} (additional changes were made during export, so the workspace remains modified).`,
  runtimeChecking: "Checking the Chromium runtime for accessibility inspection.",
  runtimePreparing: "Preparing Chromium for accessibility inspection in the background.",
  runtimeDownloading: "Downloading the local Chromium runtime required for accessibility inspection.",
  runtimeReady: "The accessibility inspection runtime is ready.",
  runtimeUnavailable: "The Chromium runtime could not be prepared.",
  runtimeDownloadFailed: ({ detail }) => `Chromium download failed: ${detail}`,
  editorNoFileSelected: "No file selected",
  editorNoDocumentIssues: "No inspection issues are linked to this document.",
};

export { en };
