// Renderer-side wrapper around window.electronAPI (exposed by source/preload.ts).
// Every method here is a thin 1:1 pass-through to one preload/IPC call — the
// point of this file is not logic, it's a single choke point so UI/store code
// never touches window.electronAPI directly. See docs/RENDERER_GUIDE.md #9.
import type {
  EpubInspectResult,
  EpubSelectFileResult,
  EpubWorkspaceExportResult,
  EpubWorkspaceExportAsResult,
  EpubWorkspaceFileContent,
  EpubWorkspaceInspectResponse,
  EpubWorkspaceOpenResult,
} from "./types.js";

interface EpubCheckerElectronApi {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  getPathForFile: (file: File) => string;
  selectEpubFile: () => Promise<EpubSelectFileResult>;
  openEpubWorkspace: (filePath: string) => Promise<EpubWorkspaceOpenResult>;
  getEpubWorkspaceFile: (workspaceId: string, filePath: string) => Promise<EpubWorkspaceFileContent>;
  updateEpubWorkspaceFile: (workspaceId: string, filePath: string, content: string) => Promise<EpubWorkspaceOpenResult>;
  exportEpubWorkspace: (workspaceId: string, outputPath?: string) => Promise<EpubWorkspaceExportResult>;
  exportEpubWorkspaceAs: (workspaceId: string, defaultName?: string) => Promise<EpubWorkspaceExportAsResult>;
  inspectEpubWorkspace: (
    workspaceId: string,
    options?: { includeAce?: boolean },
  ) => Promise<EpubWorkspaceInspectResponse>;
}

declare global {
  interface Window {
    electronAPI?: EpubCheckerElectronApi;
  }
}

class ElectronBridge {
  // Keep all direct window.electronAPI calls inside this bridge.
  // UI and store code should depend on ElectronBridge methods, not preload details.
  // This makes it easier to mock the backend later and keeps IPC naming centralized.
  private get api(): EpubCheckerElectronApi {
    if (!window.electronAPI) {
      throw new Error("Electron API is not available");
    }
    return window.electronAPI;
  }

  public minimizeWindow = (): void => {
    this.api.minimize();
  };

  public toggleMaximizeWindow = (): void => {
    this.api.maximize();
  };

  public closeWindow = (): void => {
    this.api.close();
  };

  public isWindowMaximized = async (): Promise<boolean> => {
    return await this.api.isMaximized();
  };

  public getPathForFile = (file: File): string => {
    return this.api.getPathForFile(file);
  };

  public selectFile = async (): Promise<EpubSelectFileResult> => {
    return await this.api.selectEpubFile();
  };

  public openWorkspace = async (filePath: string): Promise<EpubWorkspaceOpenResult> => {
    return await this.api.openEpubWorkspace(filePath);
  };

  public getFile = async (workspaceId: string, filePath: string): Promise<EpubWorkspaceFileContent> => {
    return await this.api.getEpubWorkspaceFile(workspaceId, filePath);
  };

  public updateFile = async (
    workspaceId: string,
    filePath: string,
    content: string,
  ): Promise<EpubWorkspaceOpenResult> => {
    return await this.api.updateEpubWorkspaceFile(workspaceId, filePath, content);
  };

  public inspectWorkspace = async (workspaceId: string): Promise<EpubWorkspaceInspectResponse> => {
    return await this.api.inspectEpubWorkspace(workspaceId, { includeAce: true });
  };

  public exportWorkspace = async (workspaceId: string): Promise<EpubWorkspaceExportResult> => {
    return await this.api.exportEpubWorkspace(workspaceId);
  };

  public exportWorkspaceAs = async (
    workspaceId: string,
    defaultName?: string,
  ): Promise<EpubWorkspaceExportAsResult> => {
    return await this.api.exportEpubWorkspaceAs(workspaceId, defaultName);
  };
}

export { ElectronBridge, EpubCheckerElectronApi };
