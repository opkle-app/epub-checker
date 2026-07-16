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
  // Bumped on every openInternalFile call, keyed by workspaceId, so a slower
  // earlier request can't clobber a faster later one when both resolve out
  // of order (see openInternalFile below).
  private openFileRequestTokens: Map<string, number> = new Map();
  public state: EpubAppState;

  constructor(bridge: ElectronBridge) {
    this.bridge = bridge;
    const emptyWorkspace = this.createEmptyWorkspace();
    this.state = {
      tabs: [],
      activeWorkspaceId: "",
      activeWorkspace: emptyWorkspace,
      message: "EPUB 파일을 열어 검사를 시작하세요.",
      revision: 0,
      runtimeMessage: "로컬 검사 런타임을 확인하는 중입니다.",
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

  public setRuntimeStatus = (message: string): void => {
    this.setAppState({ runtimeMessage: message });
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
      logs: [],
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

  public closeTab = async (workspaceId: string): Promise<void> => {
    const target = this.state.tabs.find((tab) => tab.workspaceId === workspaceId);
    if (!target) {
      return;
    }
    if (
      (target.files.some((file) => file.dirty) || this.getAutoSaveKeysForWorkspace(workspaceId).length > 0) &&
      !window.confirm(
        `“${target.fileName}”의 내보내지 않은 수정 사항이 있습니다. 이 탭을 닫으면 수정 사항이 사라집니다.`,
      )
    ) {
      return;
    }
    // Flush before discarding — a pending debounced edit used to just get
    // deleted here unsaved if the tab closed within the 250ms autosave
    // window, silently dropping the user's last keystrokes. Looped (bounded)
    // because the tab stays fully visible/editable for the whole duration of
    // this await — a keystroke landing during that IPC round-trip would
    // schedule a brand-new pending save that a single flush wouldn't catch.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await this.flushPendingAutoSaves(workspaceId);
      } catch (error) {
        console.error("[workspaceStore] failed to flush pending edits before closing tab:", error);
        this.updateWorkspace(workspaceId, {
          stage: "error",
          message: `자동 저장에 실패하여 탭을 닫지 않았습니다: ${(error as Error).message}`,
        });
        return;
      }
      if (this.getAutoSaveKeysForWorkspace(workspaceId).length === 0) {
        break;
      }
    }
    this.openFileRequestTokens.delete(workspaceId);
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
    // Releases the backend's in-memory session for this EPUB — without this
    // call, EpubWorkspaceManager on the main process retains every workspace
    // ever opened for the life of the app, not just currently-open ones.
    try {
      await this.bridge.closeWorkspace(workspaceId);
    } catch (error) {
      console.error("[workspaceStore] failed to close backend workspace session:", error);
    }
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
        logs: [],
        exportPath: "",
        message: "파일을 열었습니다. 검사하거나 내부 문서를 선택하세요.",
        revision: workspace.revision,
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
    // Token guard: if a second openInternalFile for the same tab starts
    // (user clicks another file) before this one's IPC call resolves, this
    // one must not win just because it happens to resolve first.
    const token = (this.openFileRequestTokens.get(workspaceId) ?? 0) + 1;
    this.openFileRequestTokens.set(workspaceId, token);

    const file = await this.bridge.getFile(target.workspaceId, filePath);

    if (this.openFileRequestTokens.get(workspaceId) !== token) {
      return;
    }
    // updateWorkspace re-reads the tab fresh (by id) and never forces
    // activeWorkspaceId — so a concurrent autosave's field updates on this
    // tab aren't clobbered by a stale pre-await snapshot, and switching to
    // (or closing) a different tab while this was pending is preserved
    // instead of getting silently snapped back to this one.
    this.updateWorkspace(workspaceId, {
      stage: "editing",
      activeFilePath: file.path,
      activeContent: file.content,
      message: `${file.path} 편집 중`,
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
      void this.flushAutoSave(key).catch((error) => {
        this.updateWorkspace(workspaceId, {
          stage: "error",
          message: `자동 저장 실패: ${(error as Error).message}`,
        });
      });
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
      await this.saveWorkspaceFile(pending.workspaceId, pending.filePath, pending.content, "작업 공간에 반영됨");
    } catch (error) {
      // Preserve the failed content unless a newer edit is already queued.
      // Inspection/export/close can retry it instead of silently validating
      // or discarding an older backend copy.
      if (!this.pendingAutoSaves.has(key)) {
        this.pendingAutoSaves.set(key, pending);
      }
      throw error;
    } finally {
      this.autoSaveInFlight.delete(key);
      if (this.autoSaveAgain.has(key)) {
        this.autoSaveAgain.delete(key);
        const nextPending = this.pendingAutoSaves.get(key);
        if (nextPending) {
          void this.flushAutoSave(key).catch((error) => {
            this.updateWorkspace(pending.workspaceId, {
              stage: "error",
              message: `자동 저장 실패: ${(error as Error).message}`,
            });
          });
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

  // Bounded so a hung save IPC call (main process stuck, dead channel) can't
  // wedge this loop — and everything awaiting it (closeTab/inspect/export) —
  // forever. Those callers already catch a rejection here and surface it as
  // stage:"error" instead of leaving the UI silently stuck.
  private static readonly AUTO_SAVE_IDLE_TIMEOUT_MS = 10000;

  private waitForAutoSaveIdle = async (key: string): Promise<void> => {
    const deadline = Date.now() + WorkspaceStore.AUTO_SAVE_IDLE_TIMEOUT_MS;
    while (this.autoSaveTimers.has(key) || this.pendingAutoSaves.has(key) || this.autoSaveInFlight.has(key)) {
      if (Date.now() > deadline) {
        throw new Error(`자동 저장이 ${WorkspaceStore.AUTO_SAVE_IDLE_TIMEOUT_MS / 1000}초 내에 끝나지 않았습니다.`);
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
    }
  };

  // Called from AppController's before-close flush registration (see
  // electronBridge.ts/preload.ts) — flushes every open tab's pending
  // debounced edits, not just the active one, since the whole app quitting
  // (not just one tab closing) previously had no safeguard at all: the
  // titlebar × / Cmd+Q / OS shutdown could close the window mid-debounce
  // with zero warning and zero attempt to save first.
  public prepareForAppClose = async (startFlush: () => void = () => undefined): Promise<boolean> => {
    const dirtyTabs = this.state.tabs.filter(
      (tab) => tab.files.some((file) => file.dirty) || this.getAutoSaveKeysForWorkspace(tab.workspaceId).length > 0,
    );
    if (
      dirtyTabs.length > 0 &&
      !window.confirm(
        `${dirtyTabs.length}개의 EPUB에 내보내지 않은 수정 사항이 있습니다. 앱을 종료하면 수정 사항이 사라집니다.`,
      )
    ) {
      return false;
    }
    // The main-process safety timeout starts only after the user has made a
    // decision. Time spent reading the confirmation dialog must never count
    // as a hung autosave and force-close the app behind the dialog.
    startFlush();
    try {
      await Promise.all(this.state.tabs.map((tab) => this.flushPendingAutoSaves(tab.workspaceId)));
      return true;
    } catch (error) {
      window.alert(`자동 저장에 실패하여 앱을 종료하지 않았습니다: ${(error as Error).message}`);
      return false;
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
      revision: workspace.revision,
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
    try {
      await this.flushPendingAutoSaves(active.workspaceId);
    } catch (error) {
      // Without this, a save failing here left the UI stuck on whatever it
      // showed before the click with zero feedback that inspect() never ran
      // (this call has no .catch() at its click-handler call site).
      this.updateWorkspace(active.workspaceId, { stage: "error", message: (error as Error).message });
      return;
    }
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
      const current = this.state.tabs.find((tab) => tab.workspaceId === workspaceId);
      const stale = !current || current.revision !== response.revision;
      this.updateWorkspace(workspaceId, {
        stage: !stale && response.result.status === "success" ? "validated" : "ready",
        issues: response.result.errors,
        logs: response.result.logs,
        message: stale
          ? "검사 중 내용이 변경되어 결과가 현재 편집본과 일치하지 않습니다. 다시 검사하세요."
          : response.result.errors.length === 0
            ? response.aceUnavailableReason
              ? "EPUBCheck 검사는 통과했습니다. Chromium을 준비하지 못해 Ace 검사는 건너뛰었습니다."
              : "EPUBCheck와 Ace 검사에서 오류가 없습니다. 수정된 EPUB을 내보낼 수 있습니다."
            : `${response.result.errors.length}개의 검사 항목이 발견되었습니다.${
                response.aceUnavailableReason ? " Ace 검사는 Chromium을 준비하지 못해 건너뛰었습니다." : ""
              }`,
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
    try {
      await this.flushPendingAutoSaves(active.workspaceId);
    } catch (error) {
      this.updateWorkspace(active.workspaceId, { stage: "error", message: (error as Error).message });
      return;
    }
    const defaultName = active.fileName.replace(/\.epub$/i, "") + "-repaired.epub";
    try {
      const response = await this.bridge.exportWorkspaceAs(active.workspaceId, defaultName);
      if (response.canceled || !response.filePath) {
        return;
      }
      // updateWorkspace(active.workspaceId, ...), not updateActiveWorkspace —
      // the save dialog + backend rebuild above is async, so by the time it
      // resolves the user may have switched to a different tab; this must
      // still land on the tab that was actually exported, not whatever
      // happens to be active right now.
      this.updateWorkspace(active.workspaceId, {
        stage: "exported",
        exportPath: response.filePath,
        files: response.files ?? active.files,
        message:
          response.revision === this.state.tabs.find((tab) => tab.workspaceId === active.workspaceId)?.revision
            ? `EPUB 생성 완료: ${response.filePath}`
            : `EPUB 생성 완료: ${response.filePath} (내보내기 중 추가 수정 사항이 생겨 작업 공간은 계속 수정됨 상태입니다.)`,
      });
    } catch (error) {
      this.updateWorkspace(active.workspaceId, { stage: "error", message: (error as Error).message });
    }
  };
}

export { WorkspaceStore };
