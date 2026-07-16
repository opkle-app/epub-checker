import { AbstractNode } from "../index.js";
import { ElectronBridge } from "../core/electronBridge.js";
import { IssueMapper } from "../core/issueMapper.js";
import { WorkspaceStore } from "../core/workspaceStore.js";
import type { EpubAppState, EpubInspectError, EpubWorkspaceFile, EpubWorkspaceState } from "../core/types.js";
import { EditorPane } from "../editor/editorPane.js";
import { LocaleController, translateMessage } from "../i18n/i18n.js";
import type { AppLocale } from "../i18n/i18n.js";
import { localizeIssue } from "../i18n/issueLocalizer.js";

// Renderer UI is intentionally built with AbstractNode static helpers instead of React/Vue.
// Keep this style when adding panels: const { createDom } = AbstractNode; createDom({...}).
const { createDom } = AbstractNode;

class AppController {
  // AppController owns layout and rendering only. Data transitions belong in WorkspaceStore,
  // and Electron IPC calls must stay behind ElectronBridge.
  private bridge: ElectronBridge = new ElectronBridge();
  private i18n: LocaleController = new LocaleController();
  private store: WorkspaceStore = new WorkspaceStore(this.bridge, () => this.i18n.messages);
  private root: HTMLElement;
  private fileList: HTMLElement | null = null;
  private issueList: HTMLElement | null = null;
  private logPanel: HTMLElement | null = null;
  private statusLabel: HTMLElement | null = null;
  private tabBar: HTMLElement | null = null;
  private inspectingOverlay: HTMLElement | null = null;
  private inspectButton: HTMLElement | null = null;
  private editor: EditorPane;

  constructor(root: HTMLElement) {
    this.root = root;
    this.editor = new EditorPane((content) => this.store.updateActiveContent(content));
  }

  // Builds the DOM once, grabs references to the slots createShell() marked
  // with data-role attributes, mounts the CodeMirror editor into its slot,
  // and subscribes render() to the store so every state change repaints the
  // active workspace.
  public launch = async (): Promise<void> => {
    let preferredLanguages: string[] = [];
    try {
      preferredLanguages = await this.bridge.getPreferredSystemLanguages();
    } catch (error) {
      console.warn("Failed to read preferred system languages; using Chromium preferences.", error);
      preferredLanguages = Array.from(navigator.languages ?? []);
    }
    this.i18n.initialize(preferredLanguages);
    document.documentElement.lang = this.i18n.current;
    this.bridge.setAppLocale(this.i18n.current);
    this.injectStyle();
    this.mountUi();
    this.store.subscribe((state) => this.render(state));
    this.registerGlobalDropZone();
    this.bridge.registerBeforeCloseFlush((startFlush) => this.store.prepareForAppClose(startFlush));
    this.bridge.registerRuntimeStatus((message) => this.store.setRuntimeStatus(message));
  };

  private mountUi = (): void => {
    this.root.innerHTML = "";
    this.root.appendChild(this.createShell());
    this.root.appendChild(this.createInspectingOverlay());
    this.root.appendChild(this.createBrandButton());
    this.fileList = this.root.querySelector("[data-role='file-list']");
    this.issueList = this.root.querySelector("[data-role='issue-list']");
    this.logPanel = this.root.querySelector("[data-role='log-panel']");
    this.statusLabel = this.root.querySelector("[data-role='status']");
    this.tabBar = this.root.querySelector("[data-role='tab-bar']");
    this.inspectingOverlay = this.root.querySelector("[data-role='inspecting-overlay']");
    this.inspectButton = this.root.querySelector("[data-role='inspect-button']");
    const editorSlot = this.root.querySelector("[data-role='editor-slot']");
    editorSlot?.appendChild(this.editor.root);
  };

  private setLocale = (locale: AppLocale): void => {
    if (!this.i18n.setLocale(locale)) {
      return;
    }
    document.documentElement.lang = locale;
    this.bridge.setAppLocale(locale);
    this.mountUi();
    this.render(this.store.state);
  };

  // Lets a .epub be dropped anywhere in the window, not just on .drop-zone.
  // Electron's default drop behavior would otherwise navigate the window to
  // the dropped file, so dragover must be prevented globally too.
  private registerGlobalDropZone = (): void => {
    window.addEventListener("dragover", (event: DragEvent) => {
      event.preventDefault();
    });
    window.addEventListener("drop", (event: DragEvent) => {
      event.preventDefault();
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) {
        this.store.openManyDroppedFiles(files).catch((error) => console.error(error));
      }
    });
  };

  private createShell = (): HTMLElement => {
    const messages = this.i18n.messages;
    return createDom({
      mode: "div",
      class: ["app-shell"],
      children: [
        {
          mode: "header",
          class: ["title-bar"],
          event: {
            dblclick: () => this.bridge.toggleMaximizeWindow(),
          },
          children: [
            { mode: "img", class: ["title-logo"], attribute: { src: "./static/logo_checker.png", alt: "" } },
            { mode: "div", class: ["title-spacer"] },
            {
              mode: "div",
              class: ["locale-switch"],
              attribute: { role: "group", "aria-label": "Language" },
              children: [
                {
                  mode: "button",
                  class: ["locale-button", this.i18n.current === "ko" ? "active" : ""].filter(Boolean),
                  text: "KO",
                  attribute: { type: "button", title: messages.switchToKorean, "aria-label": messages.switchToKorean },
                  event: { click: () => this.setLocale("ko") },
                },
                {
                  mode: "button",
                  class: ["locale-button", this.i18n.current === "en" ? "active" : ""].filter(Boolean),
                  text: "EN",
                  attribute: {
                    type: "button",
                    title: messages.switchToEnglish,
                    "aria-label": messages.switchToEnglish,
                  },
                  event: { click: () => this.setLocale("en") },
                },
              ],
            },
            {
              mode: "button",
              class: ["window-button"],
              text: "×",
              attribute: { type: "button", title: messages.closeWindow, "aria-label": messages.closeWindow },
              event: {
                dblclick: (event: MouseEvent) => event.stopPropagation(),
                click: () => this.bridge.closeWindow(),
              },
            },
          ],
        },
        {
          mode: "div",
          class: ["repair-shell"],
          children: [
            {
              mode: "aside",
              class: ["left-rail"],
              children: [
                {
                  mode: "button",
                  class: ["drop-zone"],
                  attribute: { type: "button" },
                  event: {
                    click: () => this.store.openByDialog(),
                  },
                  children: [
                    { mode: "img", class: ["drop-icon"], attribute: { src: "./static/target/import.png", alt: "" } },
                    { mode: "strong", text: messages.openEpub },
                    { mode: "span", text: messages.dropEpub },
                  ],
                },
                {
                  mode: "div",
                  class: ["action-grid"],
                  children: [
                    {
                      mode: "button",
                      class: ["primary-button"],
                      attribute: { type: "button", "data-role": "inspect-button" },
                      event: { click: () => this.store.inspect() },
                      children: [{ mode: "span", text: messages.inspect }],
                    },
                    {
                      mode: "button",
                      class: ["ghost-button", "export-button"],
                      attribute: { type: "button" },
                      event: { click: () => this.store.export() },
                      children: [{ mode: "span", text: messages.exportEpub }],
                    },
                  ],
                },
                { mode: "div", class: ["nav-label"], text: messages.workspaceLabel },
                {
                  mode: "nav",
                  class: ["workspace-tabs"],
                  attribute: { "data-role": "tab-bar" },
                },
                {
                  mode: "div",
                  class: ["status-pill"],
                  attribute: { "data-role": "status" },
                  text: messages.idle,
                },
                { mode: "div", class: ["nav-label"], text: messages.internalFilesLabel },
                { mode: "div", class: ["file-list"], attribute: { "data-role": "file-list" } },
              ],
            },
            {
              mode: "main",
              class: ["main-workspace"],
              children: [
                {
                  mode: "section",
                  class: ["editor-stage"],
                  children: [
                    {
                      mode: "section",
                      class: ["editor-slot"],
                      attribute: { "data-role": "editor-slot" },
                    },
                  ],
                },
              ],
            },
            {
              mode: "aside",
              class: ["right-panel"],
              children: [
                {
                  mode: "div",
                  class: ["side-tab-stack"],
                  children: [
                    { mode: "div", class: ["side-tab", "active"], text: messages.inspectionTab },
                    { mode: "div", class: ["side-tab"], text: messages.logTab },
                  ],
                },
                {
                  mode: "div",
                  class: ["issue-panel-card"],
                  children: [
                    { mode: "h2", text: messages.inspectionItems },
                    {
                      mode: "div",
                      class: ["issue-list-scroll"],
                      children: [{ mode: "div", class: ["issue-list"], attribute: { "data-role": "issue-list" } }],
                    },
                  ],
                },
                { mode: "pre", class: ["log-panel"], attribute: { "data-role": "log-panel" }, text: "" },
              ],
            },
          ],
        },
      ],
    });
  };

  // Fixed bottom-left brand chip. Stays above the shell layout; click opens
  // opkle.app in the system browser via main-process navigation guards.
  private createBrandButton = (): HTMLElement => {
    return createDom({
      mode: "button",
      class: ["opkle-brand-button"],
      attribute: {
        type: "button",
        title: "Opkle",
        "aria-label": "Open opkle.app",
      },
      event: {
        click: () => {
          window.open("https://opkle.app", "_blank", "noopener,noreferrer");
        },
      },
      children: [
        {
          mode: "img",
          class: ["opkle-brand-logo"],
          attribute: {
            src: "./static/logo_opkle_white.png",
            alt: "Opkle",
          },
        },
      ],
    });
  };

  private createInspectingOverlay = (): HTMLElement => {
    const overlay = createDom({
      mode: "div",
      class: ["inspecting-overlay", "hidden"],
      attribute: { "data-role": "inspecting-overlay" },
      children: [
        {
          mode: "div",
          class: ["inspecting-card"],
          children: [
            { mode: "div", class: ["inspecting-spinner"], attribute: { "data-role": "loading-icon" } },
            { mode: "div", class: ["inspecting-text"], text: this.i18n.messages.inspectingEpub },
          ],
        },
      ],
    });
    const loadingSlot = overlay.querySelector("[data-role='loading-icon']");
    if (loadingSlot) {
      loadingSlot.appendChild(this.createLoadingMark());
    }
    return overlay;
  };

  // Hand-built inline SVG (dot-ring spinner) rather than an image asset, so
  // it can be colored/animated purely with CSS (see .loading-mark below) and
  // ships with zero extra network/file requests.
  private createLoadingMark = (): SVGSVGElement => {
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 566.929 566.929");
    svg.classList.add("loading-mark");
    const dots = [
      [
        "M196.13 552.859c-23.91-7.75-37.01-33.409-29.26-57.31l0 0c7.74-23.9 33.4-37.01 57.31-29.26l0 0c23.9 7.74 37 33.399 29.26 57.31l0 0c-6.24 19.25-24.08 31.49-43.28 31.49l0 0C205.52 555.09 200.79 554.37 196.13 552.859z",
        "#606060",
      ],
      [
        "M313.729 523.569C305.96 499.67 319.04 474 342.939 466.229l0 0c23.891-7.77 49.561 5.301 57.33 29.2l0 0c7.771 23.9-5.3 49.57-29.2 57.34l0 0c-4.67 1.521-9.409 2.24-14.069 2.24l0 0C337.819 555.01 319.979 542.79 313.729 523.569z",
        "#404040",
      ],
      [
        "M54.55 450.109c-14.81-20.3-10.35-48.76 9.96-63.569l0 0c20.3-14.8 48.77-10.34 63.57 9.97l0 0c14.8 20.3 10.34 48.76-9.96 63.56l0 0c-8.09 5.9-17.47 8.74-26.77 8.74l0 0C77.31 468.81 63.45 462.33 54.55 450.109z",
        "#606060",
      ],
      [
        "M449 459.899c-20.33-14.779-24.82-43.239-10.03-63.56l0 0c14.78-20.32 43.23-24.81 63.561-10.03l0 0c20.319 14.78 24.81 43.24 10.029 63.561l0 0c-8.91 12.239-22.779 18.739-36.84 18.739l0 0C466.439 468.609 457.069 465.78 449 459.899z",
        "#404040",
      ],
      [
        "M0.33 283.77C0.3 258.64 20.65 238.25 45.78 238.22l0 0c25.13-0.03 45.52 20.32 45.55 45.45l0 0C91.35 308.8 71 329.189 45.88 329.22l0 0c-0.02 0-0.03 0-0.05 0l0 0C20.72 329.22 0.35 308.88 0.33 283.77z",
        "#606060",
      ],
      [
        "M475.6 283.46L475.6 283.46c0-0.01 0-0.03 0-0.05l0 0c0-0.12 0-0.24 0-0.36l0 0C475.55 257.92 495.87 237.51 521 237.45l0 0c25.13-0.05 45.55 20.28 45.6 45.41l0 0c0 0.12 0 0.24 0 0.36l0 0c0 0.08 0 0.16 0 0.24l0 0c0 25.13-20.37 45.5-45.5 45.5l0 0C495.97 328.96 475.6 308.59 475.6 283.46z",
        "#404040",
      ],
      [
        "M64.29 180.85c-20.34-14.76-24.86-43.21-10.1-63.55l0 0C68.95 96.96 97.41 92.44 117.74 107.2l0 0c20.34 14.76 24.86 43.22 10.1 63.55l0 0c-8.9 12.27-22.78 18.78-36.86 18.78l0 0C81.71 189.53 72.36 186.71 64.29 180.85z",
        "#606060",
      ],
      [
        "M438.729 170.26c-14.83-20.29-10.399-48.76 9.891-63.59l0 0c20.29-14.82 48.76-10.39 63.58 9.9l0 0 0 0 0 0c14.83 20.29 10.399 48.75-9.891 63.58l0 0c-8.1 5.92-17.5 8.77-26.81 8.77l0 0C461.47 188.92 447.64 182.45 438.729 170.26z",
        "#606060",
      ],
      [
        "M166.43 71.62C158.63 47.73 171.67 22.05 195.57 14.25l0 0c23.89-7.8 49.57 5.25 57.37 29.14l0 0c7.79 23.89-5.26 49.57-29.14 57.37l0 0c-4.69 1.53-9.45 2.26-14.13 2.26l0 0C190.52 103.02 172.69 90.82 166.43 71.62z",
        "#606060",
      ],
      [
        "M342.56 100.57h-0.01c-23.91-7.72-37.04-33.36-29.32-57.27l0 0C320.95 19.38 346.6 6.25 370.51 13.98l0 0 0 0 0 0C394.42 21.69 407.55 47.34 399.83 71.25l0 0c-6.221 19.27-24.07 31.54-43.29 31.54l0 0C351.91 102.79 347.2 102.07 342.56 100.57z",
        "#606060",
      ],
    ];
    for (const [d, fill] of dots) {
      const path = document.createElementNS(svgNs, "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", fill);
      svg.appendChild(path);
    }
    return svg;
  };

  private render = (appState: EpubAppState): void => {
    // Render always uses the active workspace. Non-active EPUB tabs keep their own
    // state in WorkspaceStore and are restored when the user switches tabs.
    const state = appState.activeWorkspace;
    const messages = this.i18n.messages;
    const localizedIssues = state.issues.map((issue) => localizeIssue(issue, this.i18n.current));
    this.editor.setUiMessages({
      noFileSelected: messages.editorNoFileSelected,
      noDocumentIssues: messages.editorNoDocumentIssues,
    });
    this.renderTabs(appState);
    if (this.statusLabel) {
      this.statusLabel.textContent = `${messages.stageLabel(state.stage)} · ${state.fileName || messages.noEpub}`;
    }
    if (this.inspectButton) {
      const label = this.inspectButton.querySelector("span");
      if (label) {
        label.textContent = appState.tabs.length > 0 ? messages.reinspect : messages.inspect;
      } else {
        this.inspectButton.textContent = appState.tabs.length > 0 ? messages.reinspect : messages.inspect;
      }
    }
    if (this.inspectingOverlay) {
      if (state.stage === "inspecting") {
        this.inspectingOverlay.classList.remove("hidden");
      } else {
        this.inspectingOverlay.classList.add("hidden");
      }
    }
    if (this.logPanel) {
      this.logPanel.textContent = [
        translateMessage(messages, state.message),
        translateMessage(messages, appState.runtimeMessage),
        state.sourcePath ? `source: ${state.sourcePath}` : "",
        state.exportPath ? `export: ${state.exportPath}` : "",
        state.logs.length > 0 ? `\n${state.logs.join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
    this.renderFiles(state);
    this.renderIssues(localizedIssues, state.files);
    const activeIssues = localizedIssues.filter((issue) => {
      const target = IssueMapper.resolveIssueTarget(issue, state.files);
      return target?.filePath === state.activeFilePath;
    });
    this.editor.setFile(state.activeFilePath, state.activeContent);
    this.editor.setIssues(activeIssues);
  };

  private renderTabs = (appState: EpubAppState): void => {
    if (!this.tabBar) {
      return;
    }
    this.tabBar.innerHTML = "";
    if (appState.tabs.length === 0) {
      this.tabBar.appendChild(
        createDom({
          mode: "div",
          class: ["empty-tab"],
          text: this.i18n.messages.noOpenEpub,
        }),
      );
      return;
    }

    for (const tab of appState.tabs) {
      this.tabBar.appendChild(this.createWorkspaceTab(tab, appState.activeWorkspaceId));
    }
  };

  private createWorkspaceTab = (tab: EpubWorkspaceState, activeWorkspaceId: string): HTMLElement => {
    // One tab = one open EPUB workspace. Closing a tab removes it from renderer
    // state; WorkspaceStore also releases the matching backend session.
    const issueCount = tab.issues.length;
    const dirtyCount = tab.files.filter((file) => file.dirty).length;
    return createDom({
      mode: "button",
      class: ["workspace-tab", tab.workspaceId === activeWorkspaceId ? "active" : ""].filter(Boolean),
      attribute: { type: "button", title: tab.sourcePath },
      event: { click: () => this.store.switchTab(tab.workspaceId) },
      children: [
        { mode: "span", class: ["workspace-tab-name"], text: tab.fileName },
        {
          mode: "span",
          class: ["workspace-tab-meta"],
          text: this.i18n.messages.workspaceMeta({ stage: tab.stage, issueCount, dirtyCount }),
        },
        {
          mode: "span",
          class: ["workspace-tab-close"],
          text: "×",
          event: {
            click: (event: MouseEvent) => {
              event.stopPropagation();
              this.store.closeTab(tab.workspaceId);
            },
          },
        },
      ],
    });
  };

  private renderFiles = (state: EpubWorkspaceState): void => {
    if (!this.fileList) {
      return;
    }
    this.fileList.innerHTML = "";
    for (const file of state.files) {
      this.fileList.appendChild(this.createFileButton(file, state.activeFilePath));
    }
  };

  private createFileButton = (file: EpubWorkspaceFile, activeFilePath: string): HTMLElement => {
    return createDom({
      mode: "button",
      class: ["file-button", file.path === activeFilePath ? "active" : "", file.dirty ? "dirty" : ""].filter(Boolean),
      attribute: { type: "button", title: file.path },
      event: { click: () => this.store.openInternalFile(file.path) },
      children: [
        { mode: "img", class: ["file-kind-icon"], attribute: { src: this.getFileIcon(file), alt: "" } },
        { mode: "span", class: ["file-name"], text: file.path.split("/").pop() ?? file.path },
        { mode: "span", class: ["file-kind"], text: file.kind },
      ],
    });
  };

  private getFileIcon = (file: EpubWorkspaceFile): string => {
    if (file.kind === "css") {
      return "./static/target/css.png";
    }
    if (file.kind === "txt") {
      return "./static/target/txt.png";
    }
    if (file.kind === "opf" || file.kind === "ncx" || file.kind === "xml") {
      return "./static/target/config.png";
    }
    return "./static/target/html.png";
  };

  private renderIssues = (issues: EpubInspectError[], files: EpubWorkspaceFile[]): void => {
    if (!this.issueList) {
      return;
    }
    this.issueList.innerHTML = "";
    if (issues.length === 0) {
      this.issueList.appendChild(
        createDom({
          mode: "div",
          class: ["empty-box"],
          text: this.i18n.messages.noInspectionResults,
        }),
      );
      return;
    }

    for (const issue of issues) {
      this.issueList.appendChild(this.createIssueButton(issue, files));
    }
  };

  private createIssueButton = (issue: EpubInspectError, files: EpubWorkspaceFile[]): HTMLElement => {
    // IssueMapper is the single place that translates checker paths into EPUB internal paths.
    // Keep future CM6 diagnostic navigation aligned with this mapping.
    const target = IssueMapper.resolveIssueTarget(issue, files);
    return createDom({
      mode: "button",
      class: ["issue-button"],
      attribute: { type: "button", title: issue.error },
      event: {
        click: () => {
          if (target) {
            this.store.openInternalFile(target.filePath).then(() => this.editor.focusLine(target.lineNumber));
          }
        },
      },
      children: [
        { mode: "span", class: ["issue-source"], text: String(issue.source ?? "issue") },
        { mode: "span", class: ["issue-text"], text: issue.error },
        {
          mode: "span",
          class: ["issue-meta"],
          text: target ? `${target.filePath}:${target.lineNumber}` : issue.fileName,
        },
      ],
    });
  };

  /**
   * designSource/font/* 의 모든 .woff2 파일을 @font-face 로 등록.
   * 패밀리 추가/가중치 변경은 이 함수 데이터만 수정하면 자동 반영.
   */
  private static getFontFaceCss = (): string => {
    const families: Array<{ family: string; weights: Array<{ weight: number; file: string }> }> = [
      {
        family: "Pretendard",
        weights: [
          { weight: 100, file: "pretendard/Pretendard-ExtraLight.woff2" },
          { weight: 200, file: "pretendard/Pretendard-Thin.woff2" },
          { weight: 300, file: "pretendard/Pretendard-Light.woff2" },
          { weight: 400, file: "pretendard/Pretendard-Regular.woff2" },
          { weight: 500, file: "pretendard/Pretendard-Medium.woff2" },
          { weight: 600, file: "pretendard/Pretendard-SemiBold.woff2" },
          { weight: 700, file: "pretendard/Pretendard-Bold.woff2" },
          { weight: 800, file: "pretendard/Pretendard-ExtraBold.woff2" },
          { weight: 900, file: "pretendard/Pretendard-Black.woff2" },
        ],
      },
      {
        family: "RedditMono",
        weights: [
          { weight: 100, file: "redditmono/RedditMono-ExtraLight.woff2" },
          { weight: 300, file: "redditmono/RedditMono-Light.woff2" },
          { weight: 400, file: "redditmono/RedditMono-Regular.woff2" },
          { weight: 500, file: "redditmono/RedditMono-Medium.woff2" },
          { weight: 600, file: "redditmono/RedditMono-SemiBold.woff2" },
          { weight: 700, file: "redditmono/RedditMono-Bold.woff2" },
          { weight: 800, file: "redditmono/RedditMono-ExtraBold.woff2" },
          { weight: 900, file: "redditmono/RedditMono-Black.woff2" },
        ],
      },
    ];

    const blocks: string[] = [];
    for (const fam of families) {
      for (const w of fam.weights) {
        blocks.push(
          '@font-face {\n  font-family: "' +
            fam.family +
            '";\n  font-weight: ' +
            String(w.weight) +
            ';\n  font-style: normal;\n  src: url("./designSource/font/' +
            w.file +
            '") format("woff2");\n  font-display: swap;\n}',
        );
      }
    }
    return blocks.join("\n");
  };

  private injectStyle = (): void => {
    const fontFaceStyle = document.createElement("style");
    fontFaceStyle.textContent = AppController.getFontFaceCss();
    document.head.appendChild(fontFaceStyle);

    const style = document.createElement("style");
    style.textContent = `
      * { box-sizing: border-box; }
      html, body, #app { width: 100%; height: 100%; margin: 0; }
      * {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      *::-webkit-scrollbar {
        display: none;
        width: 0;
        height: 0;
      }

      .empty-tab {
        color: var(--muted);
        font-size: 13px;
      }

      .editor-cm-host {
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }

      .editor-cm-host .cm-scroller {
        overflow-x: auto;
        overflow-y: scroll;
        font-family: inherit;
        line-height: inherit;
      }

      .editor-cm-host .cm-focused {
        outline: none;
      }

      .editor-cm-host .cm-lintRange-error {
        background-image: linear-gradient(45deg, transparent 65%, var(--danger) 80%, transparent 90%);
        background-position: left bottom;
        background-repeat: repeat-x;
        background-size: 8px 3px;
      }

      .issue-button {
        cursor: pointer;
      }

      .log-panel {
        display: none;
        overflow: auto;
        margin: 0;
        padding: 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #18202b;
        color: #d7e1ef;
        font-family: "RedditMono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
      }

      .opkle-brand-button {
        position: fixed;
        left: 16px;
        bottom: 16px;
        z-index: 500;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 28px;
        padding: 0 16px;
        border: 0;
        border-radius: 8px;
        background: var(--accent);
        box-shadow: 0 5px 14px rgba(98, 168, 233, 0.35);
        cursor: pointer;
      }

      .opkle-brand-button:hover {
        background: var(--accent-dark);
      }

      .opkle-brand-logo {
        display: block;
        height: 10px;
        width: auto;
        object-fit: contain;
        pointer-events: none;
      }

      /* 검사 진행 중 로딩 오버레이 */
      .inspecting-overlay {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        z-index: 100;
      }
      .inspecting-overlay.hidden {
        display: none;
      }
      @keyframes inspecting-spin {
        to { transform: rotate(360deg); }
      }

      :root {
        color-scheme: light;
        --bg: #f2f2f2;
        --canvas: #ffffff;
        --panel: #ffffff;
        --panel-soft: #f7f7f7;
        --panel-blue: #adc9e3;
        --panel-blue-soft: rgb(225, 235, 245);
        --text: #404040;
        --text-strong: #303030;
        --muted: #808080;
        --line: #e4e4e4;
        --line-strong: #dddddd;
        --accent: #62a8e9;
        --accent-dark: #5794db;
        --accent-deep: #006bd2;
        --danger: #b32737;
        --ok: #2fa678;
      }

      body {
        overflow: hidden;
        background: var(--bg);
        color: var(--text);
        font-family: "Pretendard", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", sans-serif;
      }

      button {
        font: inherit;
        border: 0;
        letter-spacing: 0;
        color: inherit;
      }

      .app-shell {
        display: grid;
        grid-template-rows: 31px minmax(0, 1fr);
        width: 100%;
        height: 100vh;
        overflow: hidden;
        background:
          radial-gradient(circle at 50% 42%, rgba(255,255,255,0.7), rgba(255,255,255,0) 34%),
          var(--bg);
      }

      .title-bar {
        -webkit-app-region: drag;
        display: grid;
        grid-template-columns: 14.5px minmax(0, 1fr) auto 16px;
        align-items: center;
        height: 31px;
        padding: 0 14px;
        border-top: 1px solid var(--line-strong);
        border-bottom: 1px solid var(--line-strong);
        background: linear-gradient(180deg, rgba(221,221,221,0.2), rgba(221,221,221,0.5));
        box-sizing: border-box;
        user-select: none;
      }

      .title-logo {
        width: 14.5px;
        height: 10.5px;
        object-fit: contain;
        opacity: 0.92;
        cursor: pointer;
      }

      .title-spacer {
        min-width: 0;
      }

      .locale-switch {
        -webkit-app-region: no-drag;
        display: inline-flex;
        align-items: center;
        gap: 1px;
        margin-right: 10px;
        padding: 1px;
        border: 1px solid rgba(128, 128, 128, 0.25);
        border-radius: 5px;
        background: rgba(255, 255, 255, 0.42);
      }

      .locale-button {
        min-width: 28px;
        height: 20px;
        padding: 0 5px;
        border-radius: 3px;
        background: transparent;
        color: var(--muted);
        font-family: "RedditMono", "SFMono-Regular", Consolas, monospace;
        font-size: 10px;
        font-weight: 600;
        cursor: pointer;
      }

      .locale-button:hover {
        color: var(--text-strong);
        background: rgba(255, 255, 255, 0.65);
      }

      .locale-button.active {
        color: #ffffff;
        background: var(--accent-deep);
      }

      .window-button {
        -webkit-app-region: no-drag;
        display: grid;
        place-items: center;
        width: 16px;
        height: 100%;
        border-radius: 0;
        background: transparent;
        color: #a4a4a4;
        cursor: pointer;
        font-family: "Pretendard", sans-serif;
        font-size: 11.5px;
        font-weight: 400;
        line-height: 1;
        transform: scale(1.5);
        transform-origin: 50% 50%;
      }

      .window-button:hover {
        background: transparent;
        color: var(--text-strong);
      }

      .repair-shell {
        display: grid;
        grid-template-columns: 240px minmax(700px, 1fr) 268px;
        gap: 0;
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }

      .left-rail {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 240px;
        min-width: 0;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        padding: 18px 16px 0px;
        border-right: 1px solid var(--line);
        background: rgba(255,255,255,0.92);
      }

      .drop-zone {
        display: grid;
        grid-template-columns: 48px minmax(0, 1fr);
        grid-template-rows: auto auto;
        column-gap: 10px;
        align-items: center;
        min-height: 64px;
        padding: 8px;
        border: 0;
        border-radius: 14px;
        background: #f2f2f2;
        box-shadow: inset 0 0 0 1px rgba(221,221,221,0.55);
        color: var(--text);
        cursor: pointer;
        text-align: left;
      }

      .drop-zone:hover {
        background: #e7f3fb;
      }

      .drop-icon {
        grid-row: 1 / 3;
        width: 48px;
        height: 48px;
        object-fit: contain;
      }

      .drop-zone strong {
        overflow: hidden;
        font-size: 13px;
        font-weight: 700;
        text-overflow: ellipsis;
        white-space: nowrap;
        position: relative;
        top: 2px;
      }

      .drop-zone span {
        overflow: hidden;
        color: var(--muted);
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
        position: relative;
        top: -4px;
      }

      .action-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 4px;
      }

      .primary-button,
      .ghost-button {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 34px;
        border: 0;
        border-radius: 10px;
        cursor: pointer;
        font-size: 12.5px;
        font-weight: 600;
        padding-bottom: 1px;
      }

      .primary-button {
        grid-column: auto;
        background: var(--accent);
        color: white;
      }

      .ghost-button {
        background: #eeeeee;
        color: var(--text);
      }

      .export-button {
        grid-column: auto;
      }

      .nav-label {
        margin-top: 5px;
        color: var(--text);
        font-family: "Pretendard", sans-serif;
        font-size: 13px;
        font-weight: 500;
      }

      .workspace-tabs {
        display: grid;
        flex: none;
        align-items: center;
        gap: 5px;
        min-width: 0;
        min-height: auto;
        max-height: 132px;
        padding: 0;
        overflow-x: hidden;
        overflow-y: auto;
        border: 0;
        background: transparent;
      }

      .workspace-tab {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 18px;
        grid-template-rows: auto auto;
        column-gap: 4px;
        align-items: center;
        flex: none;
        width: 100%;
        min-width: 0;
        min-height: 34px;
        padding: 6px 7px 6px 9px;
        border: 0;
        border-radius: 8px;
        background: #eeeeee;
        box-shadow: none;
        color: var(--text);
        cursor: pointer;
        text-align: left;
      }

      .workspace-tab.active {
        background: var(--accent);
        color: #ffffff;
      }

      .workspace-tab-name {
        overflow: hidden;
        font-size: 12px;
        font-weight: 700;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .workspace-tab-meta {
        grid-column: 1 / 2;
        overflow: hidden;
        color: inherit;
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: 0.76;
      }

      .workspace-tab-close {
        grid-column: 2 / 3;
        grid-row: 1 / 3;
        display: grid;
        place-items: center;
        width: 18px;
        height: 18px;
        border-radius: 7px;
        color: white;
        font-size: 15px;
        font-weight: 500;
        position: relative;
        top: -3px;
      }

      .workspace-tab-close:hover {
        background: #dde6f2;
        color: var(--text);
      }

      .status-pill {
        display: none;
        overflow: hidden;
        min-height: 30px;
        padding: 8px 9px;
        border: 0;
        border-radius: 8px;
        background: #f2f2f2;
        color: var(--muted);
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 700;
      }

      .file-list {
        display: grid;
        align-content: start;
        gap: 5px;
        min-height: 0;
        overflow-x: hidden;
        overflow-y: auto;
      }

      .file-button {
        display: grid;
        grid-template-columns: 24px minmax(0, 1fr) auto;
        gap: 6px;
        align-items: center;
        min-height: 34px;
        padding: 5px 8px;
        border: 0;
        border-radius: 8px;
        background: #f1f1f1;
        color: var(--text);
        text-align: left;
        cursor: pointer;
      }

      .file-button.active {
        background: var(--accent);
        color: white;
      }

      .file-button.dirty .file-name::after {
        content: " *";
        color: var(--danger);
      }

      .file-kind-icon {
        width: 23px;
        height: 23px;
        object-fit: contain;
        border-radius: 6px;
      }

      .file-kind {
        color: inherit;
        font-size: 9px;
        font-weight: 700;
        opacity: 0.72;
      }

      .file-name {
        overflow: hidden;
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 500;
      }

      .main-workspace {
        display: block;
        min-width: 0;
        min-height: 0;
        height: 100%;
        overflow: hidden;
        padding: 0px 22px 0px;
        background: transparent;
      }

      .editor-stage {
        display: grid;
        place-items: center;
        width: 100%;
        height: 100%;
        min-height: 0;
      }

      .editor-slot {
        width: min(100%, 1094px);
        height: calc(100vh - 82px);
        min-width: 0;
        min-height: 0;
        padding: 0;
        overflow: visible;
      }

      .editor-pane {
        display: grid;
        grid-template-rows: 42px 38px minmax(0, 1fr);
        width: 100%;
        height: 100%;
        min-height: 0;
        border: 0;
        border-radius: 16px;
        background: var(--canvas);
        box-shadow:
          0 24px 60px rgba(64,64,64,0.08),
          0 0 0 1px rgba(221,221,221,0.35);
        overflow: hidden;
      }

      .editor-title {
        display: flex;
        align-items: center;
        min-width: 0;
        padding-top: 22px;
        padding-left: 22px;
        padding-right: 22px;
        padding-bottom: 6px;
        border-bottom: 0;
        color: var(--muted);
        font-family: "Pretendard", sans-serif;
        font-size: 13.5px;
        font-weight: 400;
      }

      .editor-issue-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        overflow: auto;
        margin-top: 0px;
        margin-left: 22px;
        margin-right: 22px;
        margin-bottom: 0px;
        padding: 0;
        padding-bottom: 4px;
        border-bottom: 1px solid #eeeeee;
        color: #aaaaaa;
        font-size: 12px;
      }

      .issue-chip {
        flex: 0 0 auto;
        min-height: 24px;
        border: 0;
        padding: 0 9px;
        border-radius: 8px;
        background: #f2f2f2;
        color: var(--accent-dark);
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
      }

      .editor-cm-host .cm-editor {
        width: 100%;
        height: 100%;
        background: white;
        color: #303030;
        font-family: "RedditMono", "SFMono-Regular", Consolas, Menlo, monospace;
        font-size: 13px;
        line-height: 1.6;
      }

      .editor-cm-host .cm-content {
        min-height: 100%;
        padding: 38px 22px 0 0px;
        caret-color: var(--accent);
      }

      .editor-cm-host .cm-line {
        padding: 0 56px 0 14px;
      }

      .editor-cm-host .cm-gutters {
        padding-left: 22px;
        border-right: 0;
        background: white;
        color: #cccccc;
      }

      .editor-cm-host .cm-activeLine,
      .editor-cm-host .cm-activeLineGutter {
        background: #f7f7f7;
      }

      .right-panel {
        position: relative;
        display: grid;
        grid-template-rows: 1fr;
        gap: 8px;
        min-width: 0;
        min-height: 0;
        height: 100%;
        overflow: hidden;
        padding: 25px;
        padding-right: 20px;
        padding-left: 0;
        background: transparent;
      }

      .side-tab-stack {
        display: none !important;
        position: absolute;
        top: 16px;
        left: -22px;
        z-index: 2;
        display: grid;
        gap: 2px;
      }

      .side-tab {
        writing-mode: vertical-rl;
        display: grid;
        place-items: center;
        width: 24px;
        min-height: 88px;
        border-radius: 10px 0 0 10px;
        background: #dddddd;
        color: #808080;
        font-size: 12px;
        font-weight: 900;
      }

      .side-tab.active {
        background: #cccccc;
        color: white;
      }

      .issue-panel-card {
        display: grid;
        grid-template-rows: 34px minmax(0, 1fr);
        min-width: 0;
        min-height: 0;
        padding: 8px;
        border-radius: 14px;
        background: #e8e8e8;
      }

      .issue-panel-card h2 {
        display: flex;
        align-items: center;
        margin: 0;
        padding: 0 8px;
        color: var(--text);
        font-size: 13px;
        font-weight: 700;
      }

      .issue-list-scroll {
        min-width: 0;
        min-height: 0;
        overflow-x: hidden;
        overflow-y: auto;
        border-radius: 8px;
        background: white;
      }

      .issue-list {
        display: grid;
        align-content: start;
        min-width: 0;
        gap: 5px;
        padding: 8px;
      }

      .issue-button,
      .empty-box {
        display: grid;
        min-width: 0;
        gap: 6px;
        width: 100%;
        padding: 12px;
        border: 0;
        border-radius: 10px;
        background: #f5f5f5;
        text-align: left;
      }

      .issue-source {
        color: var(--accent-dark);
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
      }

      .issue-text {
        display: -webkit-box;
        overflow: hidden;
        color: var(--text);
        font-size: 12px;
        font-weight: 400;
        line-height: 1.7;
        -webkit-line-clamp: 5;
        -webkit-box-orient: vertical;
      }

      .issue-meta,
      .empty-box {
        color: #808080;
        font-size: 11px;
        font-weight: 600;
      }

      .issue-meta {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .inspecting-overlay {
        background: rgba(242,242,242,0.78);
        backdrop-filter: blur(5px);
      }

      .inspecting-card {
        display: grid;
        place-items: center;
        gap: 6px;
        min-width: 140px;
        min-height: 130px;
        padding: 22px;
        border-radius: 18px;
        background: rgba(255,255,255,0.7);
        box-shadow: 0 24px 70px -10px rgba(64,64,64,0.12);
      }

      .inspecting-spinner {
        width: 48px;
        height: 48px;
        border: 0;
        border-radius: 0;
        animation: inspecting-spin 3s linear infinite;
      }

      .loading-mark {
        width: 48px;
        height: 48px;
        display: block;
      }

      .inspecting-text {
        margin: 0;
        color: var(--text);
        font-size: 13.5px;
        font-weight: 500;
      }
    `;
    document.head.appendChild(style);
  };
}

export { AppController };
