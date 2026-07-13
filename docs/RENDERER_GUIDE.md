# Renderer Guide

이 문서는 EpubChecker renderer를 이어서 개발하는 사람과 AI agent를 위한 작업 가이드입니다.

## 1. Renderer Direction

렌더러는 React/Vue 앱이 아닙니다. 이 프로젝트는 vanilla TypeScript와 `AbstractNode` DOM builder utility를 중심으로 화면을 구성합니다.

Renderer responsibilities:

- EPUB 파일 하나를 workspace 탭 하나로 표현
- 여러 EPUB을 동시에 열고 탭 전환
- 각 EPUB의 내부 파일 목록 표시
- 검사 결과와 로그 표시
- CodeMirror 6 편집기로 내부 파일 수정
- 수정 내용을 backend workspace에 자동 저장
- 재검사 및 repaired EPUB export

## 2. AbstractNode Style

가장 중요한 스타일 규칙:

```ts
import { AbstractNode } from "../index.js";

const { createDom } = AbstractNode;
```

권장:

```ts
const panel = createDom({
  mode: "section",
  class: [ "panel" ],
  children: [
    { mode: "h2", text: "Title" },
    { mode: "p", text: "Body" },
  ],
});
```

비권장:

```ts
const node = new AbstractNode();
node.createDom(...);
```

`new AbstractNode()`는 instance method가 정말 필요한 경우에만 사용합니다.

## 3. createDom Command Shape

`createDom`은 DOM command object를 받아 HTMLElement를 만듭니다.

```ts
createDom({
  mode: "button",
  class: [ "primary-button" ],
  text: "검사",
  attribute: {
    type: "button",
    title: "Run inspection",
  },
  event: {
    click: () => store.inspect(),
  },
  children: [
    { mode: "span", text: "child" },
  ],
});
```

Common fields:

- `mode`: 생성할 태그 이름
- `class`: `classList`에 추가할 문자열 배열
- `text`: `textContent`
- `attribute`: `setAttribute`로 들어갈 값
- `event`: `addEventListener`로 연결할 handler map
- `children`: 자식 DOM command 배열

## 4. Main Renderer Files

```text
source/apps/abstractNode/src/app.ts
  Renderer boot entry. Creates AppController and launches it.

source/apps/abstractNode/src/ui/appController.ts
  Owns the main layout and rendering.

source/apps/abstractNode/src/core/workspaceStore.ts
  Renderer state machine for tabs, editor content, issues, save, inspect, export.

source/apps/abstractNode/src/core/electronBridge.ts
  Wrapper around window.electronAPI. UI/store code should use this bridge.

source/apps/abstractNode/src/core/issueMapper.ts
  Resolves issue filePath/line/column against EPUB internal files.

source/apps/abstractNode/src/editor/editorPane.ts
  CodeMirror 6 adapter.
```

## 5. State Model

```ts
interface EpubAppState {
  tabs: EpubWorkspaceState[];
  activeWorkspaceId: string;
  activeWorkspace: EpubWorkspaceState;
  message: string;
}
```

EPUB 파일 하나는 `EpubWorkspaceState` 하나입니다.

```ts
interface EpubWorkspaceState {
  stage: InspectionStage;
  workspaceId: string;
  sourcePath: string;
  fileName: string;
  files: EpubWorkspaceFile[];
  activeFilePath: string;
  activeContent: string;
  issues: EpubInspectError[];
  exportPath: string;
  message: string;
}
```

탭 전환 시 보존되어야 하는 것:

- active internal file
- active editor content
- issue list
- dirty file list
- export path
- current stage/message

## 6. UI Layout

Current high-level layout:

```text
opkle-shell
  top-bar
  repair-shell
    left-rail
      EPUB drop zone
      inspect/export actions
      workspace/file list

    main-workspace
      workspace tabs
      CodeMirror editor

    right-panel
      issue list
      logs/status
```

`appController.ts` owns this layout. Keep broad layout work there instead of spreading DOM changes into store or editor code.

## 7. CodeMirror 6 Adapter

`editorPane.ts` exposes this public API:

```ts
setFile(filePath: string, content: string): void
setIssues(issues: EpubInspectError[]): void
focusLine(lineNumber: number): void
```

Keep this API stable unless the caller contract really needs to change.

The adapter currently handles:

- XML/OPF/NCX language support
- HTML/XHTML language support
- CSS language support
- CodeMirror diagnostics from validation issues
- gutter markers
- issue line focusing
- style sample inspired theme and syntax decorations

## 8. Issue Mapping

Inspection results arrive as `EpubInspectError`.

Use:

```ts
IssueMapper.resolveIssueTarget(issue, files)
```

before trying to open a file or focus a line. The mapper normalizes EPUB internal paths and fills safe line/column defaults.

Expected flow:

```text
Issue list click
  -> IssueMapper.resolveIssueTarget
  -> WorkspaceStore.openInternalFile
  -> EditorPane.focusLine
```

## 9. IPC Rule

Renderer code should not call `window.electronAPI` everywhere.

Use this flow:

```text
UI -> WorkspaceStore -> ElectronBridge -> window.electronAPI -> preload -> main
```

This keeps IPC naming centralized and makes future testing/mocking easier.

## 10. Auto Save

`WorkspaceStore.updateActiveContent()` schedules a short debounced save into the backend workspace. Before inspection or export, the store flushes pending saves so EPUBCheck runs against the latest editor content.

Do not bypass this path from UI code. If a new editor command changes content, route it through the same `onChange -> updateActiveContent` path.

## 11. Development Checklist

Before handoff:

```bash
npm run check
```

When changing renderer behavior, manually verify:

- open EPUB by dialog
- open EPUB by drag/drop
- switch between multiple EPUB tabs
- edit an internal file
- run inspection
- click an issue and navigate into the affected file
- export repaired EPUB
