import type { InspectionStage } from "../core/types.js";

type AppLocale = "ko" | "en";

interface Messages {
  closeWindow: string;
  openEpub: string;
  dropEpub: string;
  inspect: string;
  reinspect: string;
  exportEpub: string;
  idle: string;
  inspectionTab: string;
  logTab: string;
  inspectionItems: string;
  inspectingEpub: string;
  workspaceLabel: string;
  internalFilesLabel: string;
  noOpenEpub: string;
  noInspectionResults: string;
  switchToKorean: string;
  switchToEnglish: string;
  noEpub: string;
  stageLabel: (stage: InspectionStage) => string;
  workspaceMeta: (params: { stage: InspectionStage; issueCount: number; dirtyCount: number }) => string;
  statusInitial: string;
  statusUnsavedTabConfirm: (params: { fileName: string }) => string;
  statusCloseSaveFailed: (params: { detail: string }) => string;
  statusDroppedPathUnavailable: string;
  statusOpeningArchive: string;
  statusOpened: string;
  statusEditingFile: (params: { filePath: string }) => string;
  statusAutoSaving: string;
  statusAutoSaveFailed: (params: { detail: string }) => string;
  statusSaved: string;
  statusAutoSaveTimeout: (params: { seconds: number }) => string;
  statusUnsavedAppConfirm: (params: { count: number }) => string;
  statusQuitSaveFailed: (params: { detail: string }) => string;
  statusInspecting: string;
  statusInspectionStale: string;
  statusPassedAceSkipped: string;
  statusPassed: string;
  statusIssuesFound: (params: { count: number; aceSkipped: boolean }) => string;
  statusOperationFailed: (params: { detail: string }) => string;
  statusExportComplete: (params: { filePath: string }) => string;
  statusExportCompleteWithChanges: (params: { filePath: string }) => string;
  runtimeChecking: string;
  runtimePreparing: string;
  runtimeDownloading: string;
  runtimeReady: string;
  runtimeUnavailable: string;
  runtimeDownloadFailed: (params: { detail: string }) => string;
  editorNoFileSelected: string;
  editorNoDocumentIssues: string;
}

type MessageParams = Record<string, string | number | boolean>;
type LocalizedMessage = string | { key: keyof Messages; params?: MessageParams };

export { AppLocale, LocalizedMessage, MessageParams, Messages };
