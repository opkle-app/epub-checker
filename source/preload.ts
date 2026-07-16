import { contextBridge, ipcRenderer, webUtils } from "electron";

/**
 * Preload is the only renderer-visible bridge into Electron/Node.
 *
 * Keep this file intentionally narrow: every method exposed here should map to
 * one explicit IPC channel in source/main.ts, and renderer code should call it
 * through ElectronBridge rather than reaching for window.electronAPI directly.
 */
export interface LauncherRuntimeInfo {
  launcherRoot: string;
  platformRoot: string;
  platformKey: string;
  javaCommand: string;
  epubcheckJarPath: string;
  chromiumExecutablePath: string;
  playwrightBrowsersPath: string;
  missing: string[];
}

export interface EpubInspectError {
  fileName: string;
  line: string;
  error: string;
  severity?: "fatal" | "error" | "warning" | "usage" | "info";
  code?: string;
  lineNumber?: number;
  column?: number;
  rawMessage?: string;
  filePath?: string;
  source?: "epubcheck" | "ace";
}

export interface EpubInspectResult {
  status: "success" | "error";
  errors: EpubInspectError[];
  logs: string[];
}

export interface EpubSelectFileResult {
  canceled: boolean;
  filePath: string | null;
  fileName: string | null;
}

export interface EpubInspectResponse {
  runtime: LauncherRuntimeInfo;
  result: EpubInspectResult;
}

export type EpubEditableKind = "xhtml" | "html" | "xml" | "css" | "opf" | "ncx" | "txt";

export interface EpubWorkspaceFile {
  path: string;
  kind: EpubEditableKind;
  size: number;
  dirty: boolean;
}

export interface EpubWorkspaceOpenResult {
  workspaceId: string;
  sourcePath: string;
  fileName: string;
  files: EpubWorkspaceFile[];
  revision: number;
}

export interface EpubWorkspaceFileContent {
  workspaceId: string;
  path: string;
  content: string;
}

export interface EpubWorkspaceExportResult {
  workspaceId: string;
  filePath: string;
  revision: number;
}

export interface EpubWorkspaceExportAsResult {
  canceled: boolean;
  filePath: string | null;
  files?: EpubWorkspaceFile[];
  revision?: number;
}

contextBridge.exposeInMainWorld("electronAPI", {
  // Window controls are needed because the app uses a frameless custom top bar.
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  // main.ts intercepts the window's close event and sends "app:flush-before-close"
  // instead of closing immediately, waiting (with a timeout) for "app:flush-complete"
  // before actually closing — so a pending debounced edit isn't silently dropped by
  // the titlebar ×/Cmd+Q/OS shutdown the way tab-close used to be before that was fixed.
  onBeforeClose: (callback: (startFlush: () => void) => Promise<boolean> | boolean): void => {
    ipcRenderer.on("app:flush-before-close", async () => {
      let canClose = false;
      try {
        ipcRenderer.send("app:close-confirming");
        canClose = await callback(() => ipcRenderer.send("app:flush-started"));
      } catch (error) {
        console.error("Failed to prepare workspaces for close:", error);
      } finally {
        ipcRenderer.send("app:flush-complete", { canClose });
      }
    });
  },
  showNotification: (title: string, body: string) => ipcRenderer.send("app:notify", { title, body }),
  aboutComputer: () => ipcRenderer.invoke("aboutComputer"),
  // Save destination is always the native dialog (main.ts's "screen:capture"
  // handler) — no filePath option here, to avoid re-introducing an arbitrary
  // file write via a renderer-supplied path.
  captureScreenshot: (options?: { format?: "png" | "jpeg"; quality?: number }) =>
    ipcRenderer.invoke("screen:capture", options),

  // EPUB runtime and workspace calls stay on the main process side.
  // The renderer only receives paths, structured metadata, and editable text.
  getEpubRuntimeInfo: (): Promise<LauncherRuntimeInfo> => ipcRenderer.invoke("epub:runtime-info"),
  onEpubRuntimeStatus: (callback: (message: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on("epub:runtime-status", listener);
    return () => ipcRenderer.removeListener("epub:runtime-status", listener);
  },
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  selectEpubFile: (): Promise<EpubSelectFileResult> => ipcRenderer.invoke("epub:select-file"),
  inspectEpubFile: (filePath: string, options?: { includeAce?: boolean }): Promise<EpubInspectResponse> => {
    return ipcRenderer.invoke("epub:inspect-file", {
      filePath,
      includeAce: options?.includeAce,
    });
  },
  openEpubWorkspace: (filePath: string): Promise<EpubWorkspaceOpenResult> => {
    return ipcRenderer.invoke("workspace:open", { filePath });
  },
  closeEpubWorkspace: (workspaceId: string): Promise<{ closed: boolean }> => {
    return ipcRenderer.invoke("workspace:close", { workspaceId });
  },
  getEpubWorkspaceFile: (workspaceId: string, filePath: string): Promise<EpubWorkspaceFileContent> => {
    return ipcRenderer.invoke("workspace:get-file", { workspaceId, filePath });
  },
  updateEpubWorkspaceFile: (
    workspaceId: string,
    filePath: string,
    content: string,
  ): Promise<EpubWorkspaceOpenResult> => {
    return ipcRenderer.invoke("workspace:update-file", { workspaceId, filePath, content });
  },
  exportEpubWorkspace: (workspaceId: string): Promise<EpubWorkspaceExportResult> => {
    return ipcRenderer.invoke("workspace:export", { workspaceId });
  },
  exportEpubWorkspaceAs: (workspaceId: string, defaultName?: string): Promise<EpubWorkspaceExportAsResult> => {
    return ipcRenderer.invoke("workspace:export-as", { workspaceId, defaultName });
  },
  inspectEpubWorkspace: (
    workspaceId: string,
    options?: { includeAce?: boolean },
  ): Promise<{ result: EpubInspectResult; revision: number; aceUnavailableReason?: string }> => {
    return ipcRenderer.invoke("workspace:inspect", {
      workspaceId,
      includeAce: options?.includeAce,
    });
  },
});
