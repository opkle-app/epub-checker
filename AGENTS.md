# EpubChecker Agent Guide

This project is a new local-first EPUB validation and repair app. Keep all EPUB processing local in Electron/Node. Do not design server upload flows.

## Product Direction

The user wants:

- Drag and drop or file input for `.epub`.
- One EPUB file equals one app-level tab.
- Multiple EPUBs open and inspected at the same time.
- W3C EPUBCheck plus Ace by DAISY accessibility inspection.
- Full logs and structured issue lists.
- Issue navigation into the affected EPUB internal file.
- CodeMirror 6 editing for XHTML/OPF/CSS/XML files.
- Rebuild repaired EPUB locally.
- Re-run validation on the repaired EPUB.
- Export/download the clean repaired `.epub`.

## Architecture Rules

- Electron main process is the backend.
- Renderer must not access Node directly.
- Renderer uses `window.electronAPI` only through preload.
- Runtime binaries belong under `launcher/`.
- `launcher/` is gitignored and should remain untracked.
- Do not send EPUB contents to remote servers.
- Prefer extending existing local modules before adding new layers.

## Important Files

- `source/main.ts`: Electron app, IPC handlers, local backend wiring.
- `source/preload.ts`: safe renderer API surface.
- `source/apps/launcherRuntime.ts`: resolves local JRE, epubcheck jar, Chromium.
- `source/apps/epubMaker/epubMaker.ts`: EPUBCheck and Ace orchestration.
- `source/apps/epubWorkspace.ts`: EPUB zip workspace, file read/update/export/inspect.
- `source/apps/abstractNode/abstractNode.ts`: renderer build orchestrator.
- `source/apps/abstractNode/src/index.ts`: AbstractNode frontend DOM utility.
- `source/apps/abstractNode/src/app.ts`: renderer boot entry.
- `source/apps/abstractNode/src/core/workspaceStore.ts`: renderer multi-tab state.
- `source/apps/abstractNode/src/ui/appController.ts`: main renderer layout.
- `source/apps/abstractNode/src/editor/editorPane.ts`: temporary editor adapter.

## AbstractNode Style

Use AbstractNode mostly through static destructuring:

```ts
import { AbstractNode } from "../index.js";

const { createDom } = AbstractNode;
```

Prefer `createDom({...})` over `new AbstractNode().createDom({...})`.

## Renderer Development

Before changing renderer code, read `docs/RENDERER_GUIDE.md`.

Key rules:

- `appController.ts` owns layout/rendering.
- `workspaceStore.ts` owns state transitions.
- `electronBridge.ts` is the only renderer-side wrapper around `window.electronAPI`.
- `editorPane.ts` is an adapter and should be replaced with CodeMirror 6 without changing its public methods too much.
- One EPUB equals one renderer workspace tab.

## Development

Run:

```bash
npm run dev
```

This builds renderer, compiles Electron main/preload, and opens Electron.

Validation before handoff:

```bash
npm run check
```

## Do Not Break

- The renderer build must still generate `renderer/index.html` and `renderer/main.mjs`.
- Electron main loads local `renderer/index.html`.
- Workspace IDs are backend session keys and renderer tab keys.
- `EpubWorkspaceManager` may hold multiple sessions.
- `workspace:inspect` validates the currently active workspace export.
