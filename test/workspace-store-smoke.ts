import assert from "node:assert/strict";
import { WorkspaceStore } from "../source/apps/abstractNode/src/core/workspaceStore.js";

let confirmResult = true;
(globalThis as any).window = {
  setTimeout,
  clearTimeout,
  confirm: () => confirmResult,
  alert: () => undefined,
};
(globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(callback, 0);

let updateAttempts = 0;
let closeCalls = 0;
const bridge = {
  updateFile: async (workspaceId: string, filePath: string) => {
    updateAttempts += 1;
    if (updateAttempts === 1) throw new Error("simulated IPC failure");
    return {
      workspaceId,
      sourcePath: "/tmp/book.epub",
      fileName: "book.epub",
      files: [{ path: filePath, kind: "xhtml", size: 10, dirty: true }],
      revision: updateAttempts,
    };
  },
  closeWorkspace: async () => {
    closeCalls += 1;
    return { closed: true };
  },
} as any;

const store = new WorkspaceStore(bridge);
const workspace = {
  stage: "editing" as const,
  workspaceId: "workspace-1",
  sourcePath: "/tmp/book.epub",
  fileName: "book.epub",
  files: [{ path: "OEBPS/chapter.xhtml", kind: "xhtml" as const, size: 10, dirty: true }],
  activeFilePath: "OEBPS/chapter.xhtml",
  activeContent: "before",
  issues: [],
  logs: [],
  exportPath: "",
  message: "editing",
  revision: 0,
};
store.state = {
  tabs: [workspace],
  activeWorkspaceId: workspace.workspaceId,
  activeWorkspace: workspace,
  message: workspace.message,
  runtimeMessage: "ready",
};

store.updateActiveContent("latest content");
await assert.rejects(store.saveActiveFile(), /simulated IPC failure/);
await store.saveActiveFile();
assert.equal(updateAttempts, 2, "failed autosave content must remain queued for retry");

confirmResult = false;
await store.closeTab(workspace.workspaceId);
assert.equal(closeCalls, 0, "declining the dirty warning must keep the backend workspace open");
assert.equal(store.state.tabs.length, 1, "declining the dirty warning must keep the renderer tab open");

let flushStarted = false;
assert.equal(await store.prepareForAppClose(() => (flushStarted = true)), false);
assert.equal(flushStarted, false, "the main close timeout must not start while confirmation is declined");

let resolveInspection!: (value: any) => void;
const staleBridge = {
  inspectWorkspace: () => new Promise((resolve) => (resolveInspection = resolve)),
} as any;
const staleStore = new WorkspaceStore(staleBridge);
const staleWorkspace = { ...workspace, files: workspace.files.map((file) => ({ ...file, dirty: false })) };
staleStore.state = {
  tabs: [staleWorkspace],
  activeWorkspaceId: staleWorkspace.workspaceId,
  activeWorkspace: staleWorkspace,
  message: staleWorkspace.message,
  runtimeMessage: "ready",
};
const inspectionPromise = (staleStore as any).inspectWorkspace(staleWorkspace.workspaceId);
await new Promise((resolve) => setTimeout(resolve, 5));
const changedWorkspace = { ...staleWorkspace, revision: staleWorkspace.revision + 1 };
staleStore.state = {
  ...staleStore.state,
  tabs: [changedWorkspace],
  activeWorkspace: changedWorkspace,
};
resolveInspection({ result: { status: "success", errors: [], logs: [] }, revision: staleWorkspace.revision });
await inspectionPromise;
assert.equal(staleStore.state.activeWorkspace.stage, "ready");
assert.match(staleStore.state.activeWorkspace.message, /다시 검사/);

console.log("WorkspaceStore autosave, close, and stale-inspection guards ✓");
