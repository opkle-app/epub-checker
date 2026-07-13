import { ElectronBridge } from "./electronBridge.js";
import type { EpubAppState, EpubWorkspaceState } from "./types.js";

type WorkspaceListener = (state: EpubAppState) => void;

interface PendingAutoSave {
  workspaceId: string;
  filePath: string;
  content: string;
}

class WorkspaceStore {
  // WorkspaceStore is the renderer-side state machine.
  // It tracks many EPUB workspaces at once and exposes a single active workspace to the UI.
  // Backend session state is keyed by the same workspaceId through Electron IPC.
  private bridge: ElectronBridge;
  private listeners: Set<WorkspaceListener> = new Set();

  // Small debounced auto-save state machine, keyed by "workspaceId::filePath":
  //   autoSaveTimers    - pending debounce timers not yet fired.
  //   pendingAutoSaves  - latest content queued to save once the timer fires.
  //   autoSaveInFlight  - keys with a save IPC call currently in progress.
  //   autoSaveAgain     - keys whose content changed again while a save was
  //                       already in flight; re-flushed once that save resolves.
  // See scheduleAutoSave / flushAutoSave / flushPendingAutoSaves below.
  private autoSaveTimers: Map<string, ReturnType<typeof window.setTimeout>> = new Map();
  private autoSaveInFlight: Set<string> = new Set();
  private autoSaveAgain: Set<string> = new Set();
  private pendingAutoSaves: Map<string, PendingAutoSave> = new Map();
  public state: EpubAppState;

  constructor(bridge: ElectronBridge) {
    this.bridge = bridge;
    const emptyWorkspace = this.createEmptyWorkspace();
    this.state = {
      tabs: [],
      activeWorkspaceId: "",
      activeWorkspace: emptyWorkspace,
      message: "EPUB 파일을 열어 검사를 시작하세요.",
    };
  }

  // Registers a render callback, calls it once immediately with current state
  // (so subscribers don't need a separate initial render), and returns an
  // unsubscribe function.
  public subscribe = (listener: WorkspaceListener): (() => void) => {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  };

  private createEmptyWorkspace = (): EpubWorkspaceState => {
    return {
      stage: "idle",
      workspaceId: "",
      sourcePath: "",
      fileName: "",
      files: [],
      activeFilePath: "",
      activeContent: "",
      issues: [],
      exportPath: "",
      message: "EPUB 파일을 열어 검사를 시작하세요.",
    };
  };

  private getActiveWorkspace = (): EpubWorkspaceState => {
    return (
      this.state.tabs.find((tab) => tab.workspaceId === this.state.activeWorkspaceId) ?? this.createEmptyWorkspace()
    );
  };

  private setAppState = (patch: Partial<EpubAppState>): void => {
    // activeWorkspace is derived from tabs + activeWorkspaceId on every update.
    // This keeps render code simple and prevents stale active tab references.
    const next = {
      ...this.state,
      ...patch,
    };
    next.activeWorkspace =
      next.tabs.find((tab) => tab.workspaceId === next.activeWorkspaceId) ?? this.createEmptyWorkspace();
    next.message = next.activeWorkspace.message;
    this.state = next;
    for (const listener of this.listeners) {
      listener(this.state);
    }
  };

  private updateActiveWorkspace = (patch: Partial<EpubWorkspaceState>): void => {
    // Most commands apply only to the currently selected EPUB tab.
    // Non-active tabs must remain untouched so several EPUBs can be inspected independently.
    const active = this.getActiveWorkspace();
    if (active.workspaceId === "") {
      this.setAppState({ message: patch.message ?? this.state.message });
      return;
    }
    const nextActive = {
      ...active,
      ...patch,
    };
    const tabs = this.state.tabs.map((tab) => {
      return tab.workspaceId === active.workspaceId ? nextActive : tab;
    });
    this.setAppState({
      tabs,
      activeWorkspaceId: nextActive.workspaceId,
      activeWorkspace: nextActive,
    });
  };

  private updateWorkspace = (workspaceId: string, patch: Partial<EpubWorkspaceState>): void => {
    const target = this.state.tabs.find((tab) => tab.workspaceId === workspaceId);
    if (!target) {
      return;
    }
    const nextWorkspace = {
      ...target,
      ...patch,
    };
    const tabs = this.state.tabs.map((tab) => {
      return tab.workspaceId === workspaceId ? nextWorkspace : tab;
    });
    this.setAppState({
      tabs,
      activeWorkspaceId: this.state.activeWorkspaceId,
      activeWorkspace: nextWorkspace,
    });
  };

  private getSaveKey = (workspaceId: string, filePath: string): string => {
    return `${workspaceId}::${filePath}`;
  };

  private upsertWorkspace = (workspace: EpubWorkspaceState): void => {
    // Opening an EPUB creates a new renderer tab. Replacing an existing workspace is kept
    // here for future restore/reload behavior, even though current opens create new ids.
    const existingIndex = this.state.tabs.findIndex((tab) => tab.workspaceId === workspace.workspaceId);
    const tabs =
      existingIndex >= 0
        ? this.state.tabs.map((tab, index) => (index === existingIndex ? workspace : tab))
        : this.state.tabs.concat(workspace);
    this.setAppState({
      tabs,
      activeWorkspaceId: workspace.workspaceId,
      activeWorkspace: workspace,
    });
  };

  public switchTab = (workspaceId: string): void => {
    if (this.state.tabs.some((tab) => tab.workspaceId === workspaceId)) {
      this.setAppState({ activeWorkspaceId: workspaceId });
    }
  };

  public closeTab = (workspaceId: string): void => {
    for (const key of Array.from(this.autoSaveTimers.keys())) {
      if (key.startsWith(`${workspaceId}::`)) {
        const timer = this.autoSaveTimers.get(key);
        if (timer) {
          window.clearTimeout(timer);
        }
        this.autoSaveTimers.delete(key);
        this.pendingAutoSaves.delete(key);
        this.autoSaveAgain.delete(key);
      }
    }
    const tabs = this.state.tabs.filter((tab) => tab.workspaceId !== workspaceId);
    const activeWorkspaceId =
      this.state.activeWorkspaceId === workspaceId ? (tabs.at(-1)?.workspaceId ?? "") : this.state.activeWorkspaceId;
    this.setAppState({
      tabs,
      activeWorkspaceId,
    });
  };

  public openByDialog = async (): Promise<void> => {
    const selected = await this.bridge.selectFile();
    if (selected.canceled || !selected.filePath) {
      return;
    }
    await this.openByPath(selected.filePath);
  };

  public openByDroppedFile = async (file: File): Promise<void> => {
    const filePath = this.bridge.getPathForFile(file);
    if (filePath === "") {
      this.setAppState({ message: "드롭된 파일 경로를 읽을 수 없습니다." });
      return;
    }
    await this.openByPath(filePath);
  };

  public openManyDroppedFiles = async (files: FileList | File[]): Promise<void> => {
    // Dragging several EPUB files should create several tabs.
    // Non-EPUB files are ignored at this layer; later UI can report skipped files if needed.
    const list = Array.from(files).filter((file) => /\.epub$/i.test(file.name));
    for (const file of list) {
      await this.openByDroppedFile(file);
    }
  };

  public openByPath = async (filePath: string): Promise<void> => {
    this.setAppState({ message: "EPUB 압축을 열고 내부 문서를 읽는 중입니다." });
    try {
      const workspace = await this.bridge.openWorkspace(filePath);
      const firstFile =
        workspace.files.find((file) => file.kind === "xhtml" || file.kind === "html") ?? workspace.files[0];
      const nextWorkspace: EpubWorkspaceState = {
        stage: "ready",
        workspaceId: workspace.workspaceId,
        sourcePath: workspace.sourcePath,
        fileName: workspace.fileName,
        files: workspace.files,
        activeFilePath: firstFile?.path ?? "",
        activeContent: "",
        issues: [],
        exportPath: "",
        message: "파일을 열었습니다. 검사하거나 내부 문서를 선택하세요.",
      };
      this.upsertWorkspace(nextWorkspace);
      if (firstFile) {
        await this.openInternalFile(firstFile.path, workspace.workspaceId);
      }
      await this.inspectWorkspace(workspace.workspaceId);
    } catch (error) {
      this.setAppState({ message: (error as Error).message });
    }
  };

  public openInternalFile = async (
    filePath: string,
    workspaceId: string = this.state.activeWorkspaceId,
  ): Promise<void> => {
    const target = this.state.tabs.find((tab) => tab.workspaceId === workspaceId);
    if (!target) {
      return;
    }
    const file = await this.bridge.getFile(target.workspaceId, filePath);
    const nextWorkspace: EpubWorkspaceState = {
      ...target,
      stage: "editing",
      activeFilePath: file.path,
      activeContent: file.content,
      message: `${file.path} 편집 중`,
    };
    const tabs = this.state.tabs.map((tab) => (tab.workspaceId === target.workspaceId ? nextWorkspace : tab));
    this.setAppState({
      tabs,
      activeWorkspaceId: target.workspaceId,
      activeWorkspace: nextWorkspace,
    });
  };

  public updateActiveContent = (content: string): void => {
    const active = this.getActiveWorkspace();
    this.updateActiveWorkspace({
      activeContent: content,
      message: "수정 사항을 자동 저장하는 중입니다.",
    });
    if (active.workspaceId !== "" && active.activeFilePath !== "") {
      this.scheduleAutoSave(active.workspaceId, active.activeFilePath, content);
    }
  };

  public saveActiveFile = async (): Promise<void> => {
    const active = this.getActiveWorkspace();
    if (active.workspaceId === "" || active.activeFilePath === "") {
      return;
    }
    await this.flushPendingAutoSaves(active.workspaceId);
  };

  private scheduleAutoSave = (workspaceId: string, filePath: string, content: string): void => {
    // CodeMirror emits many small document changes while typing. Debouncing
    // keeps IPC quiet, while flushPendingAutoSaves still guarantees inspect and
    // export operate on the latest editor content.
    const key = this.getSaveKey(workspaceId, filePath);
    const existingTimer = this.autoSaveTimers.get(key);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }
    this.pendingAutoSaves.set(key, { workspaceId, filePath, content });
    const timer = window.setTimeout(() => {
      this.autoSaveTimers.delete(key);
      void this.flushAutoSave(key);
    }, 250);
    this.autoSaveTimers.set(key, timer);
  };

  private flushAutoSave = async (key: string): Promise<void> => {
    const pending = this.pendingAutoSaves.get(key);
    if (!pending) {
      return;
    }
    if (this.autoSaveInFlight.has(key)) {
      // If content changes while a save is already in flight, remember that the
      // same key must be saved again immediately after the current request ends.
      this.autoSaveAgain.add(key);
      return;
    }
    this.pendingAutoSaves.delete(key);
    this.autoSaveInFlight.add(key);
    try {
      await this.saveWorkspaceFile(pending.workspaceId, pending.filePath, pending.content, "자동 저장됨");
    } finally {
      this.autoSaveInFlight.delete(key);
      if (this.autoSaveAgain.has(key)) {
        this.autoSaveAgain.delete(key);
        const nextPending = this.pendingAutoSaves.get(key);
        if (nextPending) {
          void this.flushAutoSave(key);
        }
      }
    }
  };

  private getAutoSaveKeysForWorkspace = (workspaceId: string): string[] => {
    const prefix = `${workspaceId}::`;
    return Array.from(
      new Set([
        ...Array.from(this.autoSaveTimers.keys()),
        ...Array.from(this.pendingAutoSaves.keys()),
        ...Array.from(this.autoSaveInFlight.keys()),
      ]),
    ).filter((key) => key.startsWith(prefix));
  };

  private waitForAutoSaveIdle = async (key: string): Promise<void> => {
    while (this.autoSaveTimers.has(key) || this.pendingAutoSaves.has(key) || this.autoSaveInFlight.has(key)) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
    }
  };

  // Forces every debounced/queued save for a workspace to complete right now.
  // Called before inspect/export so EPUBCheck and the exported file always
  // reflect the latest editor content, never a stale pre-debounce version.
  private flushPendingAutoSaves = async (workspaceId: string): Promise<void> => {
    let keys = this.getAutoSaveKeysForWorkspace(workspaceId);
    for (const key of keys) {
      const timer = this.autoSaveTimers.get(key);
      if (timer) {
        window.clearTimeout(timer);
        this.autoSaveTimers.delete(key);
      }
      await this.flushAutoSave(key);
    }
    keys = this.getAutoSaveKeysForWorkspace(workspaceId);
    await Promise.all(keys.map((key) => this.waitForAutoSaveIdle(key)));
  };

  private saveWorkspaceFile = async (
    workspaceId: string,
    filePath: string,
    content: string,
    message: string,
  ): Promise<void> => {
    const workspace = await this.bridge.updateFile(workspaceId, filePath, content);
    this.updateWorkspace(workspaceId, {
      files: workspace.files,
      message,
    });
  };

  public inspect = async (): Promise<void> => {
    // Inspection exports the active in-memory workspace to a temporary EPUB first,
    // then asks Electron main to run EPUBCheck/Ace against that exported file.
    const active = this.getActiveWorkspace();
    if (active.workspaceId === "") {
      // Nothing open yet: treat "검사" the same as opening a file, since
      // openByPath() already runs inspection right after the workspace loads.
      await this.openByDialog();
      return;
    }
    await this.flushPendingAutoSaves(active.workspaceId);
    await this.inspectWorkspace(active.workspaceId);
  };

  // Yields one animation frame + one macrotask so the "inspecting" overlay
  // actually paints before the (potentially slow, blocking) EPUBCheck/Ace
  // IPC call starts — otherwise the state flip and the long-running await
  // could land in the same frame and the overlay would never appear.
  private waitForInspectionOverlayPaint = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        window.setTimeout(resolve, 0);
      });
    });
  };

  private inspectWorkspace = async (workspaceId: string): Promise<void> => {
    const target = this.state.tabs.find((tab) => tab.workspaceId === workspaceId);
    if (!target) {
      return;
    }
    this.updateWorkspace(workspaceId, {
      stage: "inspecting",
      message: "W3C EPUBCheck와 Ace 접근성 검사를 실행 중입니다.",
    });
    await this.waitForInspectionOverlayPaint();
    try {
      const response = await this.bridge.inspectWorkspace(workspaceId);
      this.updateWorkspace(workspaceId, {
        stage: response.result.errors.length === 0 ? "exported" : "ready",
        issues: response.result.errors,
        exportPath: response.exportPath,
        message:
          response.result.errors.length === 0
            ? "오류가 없습니다. 수정된 EPUB을 다운로드할 수 있습니다."
            : `${response.result.errors.length}개의 검사 항목이 발견되었습니다.`,
      });
    } catch (error) {
      this.updateWorkspace(workspaceId, { stage: "error", message: (error as Error).message });
    }
  };

  // Flushes pending edits, then asks the user where to save and asks the
  // backend to rebuild+write the repaired EPUB there (see workspace:export-as
  // in source/main.ts). This does not re-run validation; call inspect() first
  // if the export should reflect a clean re-check.
  public export = async (): Promise<void> => {
    const active = this.getActiveWorkspace();
    if (active.workspaceId === "") {
      return;
    }
    await this.flushPendingAutoSaves(active.workspaceId);
    const defaultName = active.fileName.replace(/\.epub$/i, "") + "-repaired.epub";
    const response = await this.bridge.exportWorkspaceAs(active.workspaceId, defaultName);
    if (response.canceled || !response.filePath) {
      return;
    }
    this.updateActiveWorkspace({
      stage: "exported",
      exportPath: response.filePath,
      message: `EPUB 생성 완료: ${response.filePath}`,
    });
  };
}

export { WorkspaceStore };
