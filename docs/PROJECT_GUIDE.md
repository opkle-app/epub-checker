# EpubChecker Project Guide

This guide is for contributors and AI agents continuing development.

## 1. Product Concept

EpubChecker is a local EPUB validation and repair workspace.

The intended workflow is:

1. Open one or more `.epub` files locally.
2. Treat each EPUB as one app-level workspace tab.
3. Run W3C EPUBCheck and Ace by DAISY.
4. Show structured issues, logs, and source locations.
5. Open the affected internal EPUB file.
6. Edit XHTML, OPF, CSS, XML, NCX, HTML, or TXT with CodeMirror 6.
7. Save the edit into the in-memory EPUB zip workspace.
8. Rebuild the repaired EPUB locally.
9. Re-run validation.
10. Export the clean repaired `.epub`.

EPUB contents must not leave the local machine.

## 2. Runtime Layers

```text
Renderer
  AbstractNode UI, workspace tabs, issue lists, CodeMirror editor.

Preload
  Explicit window.electronAPI bridge.

Electron main
  Node backend for file dialogs, JSZip workspaces, validation, and export.
```

Do not introduce a server backend for EPUB validation, editing, repair, or export.

## 3. Local Runtime Binaries

`source/apps/launcherRuntime.ts` resolves runtime files from:

```text
process.cwd() + "/launcher"
```

Supported platform folder names:

```text
darwin-arm64
darwin-x64
win32-x64
linux-x64
```

Each platform folder should provide:

```text
jre/bin/java                  # or jre/Contents/Home/bin/java
epubcheck/epubcheck.jar
chromium/{chrome-mac*,chrome-win*,chrome-linux*}/...
```

Use the setup script:

```bash
npm run launcher:setup
```

Useful variants:

```bash
npm run launcher:setup:rebuild
npm run launcher:setup:mac:x64
npm run launcher:setup:mac:arm64
npm run launcher:setup:win:x64
```

The resolver sets:

- `JAVA_HOME`
- `JAVA_BIN`
- `EPUBCHECK_JAR`
- `PLAYWRIGHT_BROWSERS_PATH`
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
- `ACE_CHROMIUM_EXECUTABLE_PATH`

## 4. Backend Flow

Relevant files:

- `source/main.ts`
- `source/apps/epubWorkspace.ts`
- `source/apps/epubMaker/epubMaker.ts`
- `source/apps/epubMaker/module/aceByDaisy.ts`
- `source/apps/launcherRuntime.ts`

IPC workflow:

```text
workspace:open
  read .epub
  load JSZip
  create workspaceId
  list editable internal files

workspace:get-file
  return internal file text

workspace:update-file
  replace internal file content in memory
  mark file dirty

workspace:inspect
  export workspace to a temporary repaired EPUB
  run EPUBCheck
  run Ace if enabled
  return structured issues

workspace:export-as
  show save dialog
  write repaired EPUB
```

`EpubWorkspaceManager` supports multiple sessions. The renderer uses the same `workspaceId` as its tab key.

## 5. Renderer Flow

Relevant files:

- `source/apps/abstractNode/src/core/types.ts`
- `source/apps/abstractNode/src/core/electronBridge.ts`
- `source/apps/abstractNode/src/core/workspaceStore.ts`
- `source/apps/abstractNode/src/core/issueMapper.ts`
- `source/apps/abstractNode/src/ui/appController.ts`
- `source/apps/abstractNode/src/editor/editorPane.ts`

Renderer state shape:

```text
EpubAppState
  tabs: EpubWorkspaceState[]
  activeWorkspaceId: string
  activeWorkspace: EpubWorkspaceState
  message: string
```

State that must survive tab switching:

- file list
- active internal file
- editor content
- issue list
- export path
- current stage/message

## 6. CodeMirror 6 Editor

`editorPane.ts` is the CodeMirror 6 adapter. Keep its public API stable so UI code can stay simple:

```ts
setFile(filePath: string, content: string): void
setIssues(issues: EpubInspectError[]): void
focusLine(lineNumber: number): void
```

Responsibilities:

- Pick XML, HTML, or CSS language support from the active file extension.
- Emit content changes through the constructor `onChange` callback.
- Convert `EpubInspectError[]` into CM6 diagnostics.
- Reconfigure decorations when the active file changes.
- Keep style/theme details inside the adapter.

## 7. Validation Output

`EpubMaker.inspectEpub()` returns:

```ts
{
  status: "success" | "error";
  errors: EpubInspectError[];
}
```

Each error may include:

- source: `epubcheck` or `ace`
- severity
- code
- fileName
- filePath
- lineNumber
- column
- rawMessage
- error

The renderer should preserve raw data. UI can show friendly text, but the original path, code, and line/column data are required for issue navigation and debugging.

## 8. Development Mode

Run the app:

```bash
npm run dev
```

Verify without launching Electron:

```bash
npm run check
```

`npm run check` currently runs:

```text
renderer build
main TypeScript compile
preload TypeScript compile
```

## 9. Known Rough Edges

- Inspection progress and cancellation are not fully wired through the renderer yet.
- Runtime readiness exists in the backend resolver but does not have a dedicated UI panel yet.
- Release packaging still needs an `electron-builder` runtime bundling strategy.
- Sample EPUB fixtures and automated end-to-end QA should be added.

## 10. Development Rules

- Keep EPUB processing local.
- Do not let renderer code access Node directly.
- Add preload API methods intentionally and keep renderer types in sync.
- Prefer extending existing modules before adding new layers.
- Keep `launcher/` binaries out of git.
- Run `npm run check` before handoff.
