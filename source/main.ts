import { app, session, BrowserWindow, nativeImage, ipcMain, Notification, dialog, shell } from "electron";
import { App } from "electron/main";
import path from "path";
import { pathToFileURL } from "url";
import os from "os";
import { existsSync } from "fs";
import fsPromise from "fs/promises";
import process from "process";
import { Mother } from "./apps/mother.js";
import { LauncherRuntime, LauncherRuntimeInfo } from "./apps/launcherRuntime.js";
import { EpubMaker } from "./apps/epubMaker/epubMaker.js";
import { EpubWorkspaceManager } from "./apps/epubWorkspace.js";
import type { EpubInspectResult } from "./apps/classStorage/epubType.js";
import log from "electron-log";

const aboutComputerInfo = async () => {
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : "Unknown";
  const cpuCores = cpus.length;
  const cpuArch = os.arch();

  return {
    os: `${os.type()} ${os.release()}`,
    cpu: `${cpuModel} (${cpuCores} cores, ${cpuArch})`,
    memory: `${(os.totalmem() / 1024 ** 3).toFixed(1)} GB`,
    homeDir: os.homedir(),
  };
};

log.transports.file.resolvePathFn = () => path.join(app.getPath("logs"), "main.log");
log.transports.file.level = "info";
log.transports.console.level = "debug";
log.initialize();
Object.assign(console, log.functions);

interface EpubSelectFileResult {
  canceled: boolean;
  filePath: string | null;
  fileName: string | null;
}

interface EpubInspectPayload {
  filePath: string;
  includeAce?: boolean;
}

interface EpubInspectResponse {
  runtime: LauncherRuntimeInfo;
  result: EpubInspectResult;
}

interface EpubWorkspaceOpenPayload {
  filePath: string;
}

interface EpubWorkspaceFilePayload {
  workspaceId: string;
  filePath: string;
}

interface EpubWorkspaceUpdatePayload extends EpubWorkspaceFilePayload {
  content: string;
}

interface EpubWorkspaceInspectPayload {
  workspaceId: string;
  includeAce?: boolean;
}

class EpubChecker {
  private recentNotifications: Set<string> = new Set();

  public iconBaseDir: string;
  public preloadScript: string;
  public targetUrl: string;
  public iconBaseName: string;
  public mainApp: App;
  public iconPath: string;
  public mainWindow: BrowserWindow | null;
  private launcherRuntime: LauncherRuntimeInfo | null = null;
  private workspaceManager: EpubWorkspaceManager = new EpubWorkspaceManager();
  // Guards the window "close" interception below: closeAfterFlush marks that
  // the flush already ran (let this specific close through); closeFlushInFlight
  // stops a second close attempt (Cmd+Q right after clicking ×) from firing a
  // second overlapping flush-before-close round-trip.
  private closeAfterFlush: boolean = false;
  private closeFlushInFlight: boolean = false;

  private reportRuntimeStatus = (message: string): void => {
    console.log(`[LauncherRuntime] ${message}`);
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("epub:runtime-status", message);
    }
  };

  constructor() {
    this.iconBaseDir = path.join(Mother.assetPath, "./designSource");
    this.preloadScript = path.join(Mother.scriptPath, "./preload.js");
    this.targetUrl = pathToFileURL(path.join(Mother.assetPath, "index.html")).href;
    this.iconBaseName = "icon";
    this.iconPath = "";
    this.mainWindow = null;
    this.mainApp = app;
  }

  public setIconPath = () => {
    switch (process.platform) {
      case "win32":
        this.iconPath = path.join(this.iconBaseDir, `${this.iconBaseName}.ico`);
        break;
      case "darwin":
        this.iconPath = path.join(this.iconBaseDir, `${this.iconBaseName}.icns`);
        if (process.env.NODE_ENV === "development") {
          this.iconPath = path.join(this.iconBaseDir, `${this.iconBaseName}.png`);
        }
        break;
      default:
        this.iconPath = path.join(this.iconBaseDir, `${this.iconBaseName}.png`);
        break;
    }
  };

  public createWindow = (): BrowserWindow => {
    const instance = this;
    if (this.iconPath && existsSync(this.iconPath)) {
      const iconImage = nativeImage.createFromPath(this.iconPath);
      if (this.mainApp.dock) {
        this.mainApp.dock.setIcon(iconImage);
      }
    }

    this.mainWindow = new BrowserWindow({
      width: 1920,
      height: 1080,
      icon: this.iconPath,
      webPreferences: {
        webgl: true,
        preload: this.preloadScript,
        contextIsolation: true,
        nodeIntegration: false,
        enableBlinkFeatures: [
          "Canvas2dImageChromium",
          "AcceleratedSmallCanvases",
          "Canvas2DLayers",
          "OffscreenCanvasGetContextAttributes",
          "WebGLImageChromium",
          "CompositedSelectionUpdate",
          "SharedArrayBuffer",
          "WebGLOnWebGPU",
          "WebGPUCompatibilityMode",
          "WebGPUExperimentalFeatures",
        ].join(","),
      },
      frame: false,
      hasShadow: false,
    });

    if (this.mainWindow !== null) {
      const win = this.mainWindow;
      this.attachNavigationGuards(win.webContents);
      win.maximize();
      win.on("closed", () => {
        if (this.mainWindow === win) {
          this.mainWindow = null;
        }
      });
      this.closeAfterFlush = false;
      this.closeFlushInFlight = false;
      // Unifies every way the window can close (titlebar ×'s window:close IPC,
      // Cmd+Q, OS shutdown, window-manager close) through one interception
      // point, since they all end up calling BrowserWindow#close() and firing
      // this same event. Without this, a pending debounced edit could be
      // lost on quit exactly like tab-close could before that was fixed.
      win.on("close", (event) => {
        if (this.closeAfterFlush) {
          return;
        }
        event.preventDefault();
        if (this.closeFlushInFlight) {
          return;
        }
        this.closeFlushInFlight = true;
        this.flushRendererBeforeClose(win);
      });

      setTimeout(() => {
        if (instance.mainWindow !== null && !instance.mainWindow.isDestroyed()) {
          instance.mainWindow.loadURL(instance.targetUrl).catch((err) => {
            console.error(`loadURL failed: ${err.message}`);
          });

          if (process.env.NODE_ENV === "development") {
            instance.mainWindow.webContents.once("did-finish-load", () => {
              if (instance.mainWindow && !instance.mainWindow.isDestroyed()) {
                instance.mainWindow.webContents.openDevTools();
              }
            });
          }
          instance.mainWindow.webContents.once("did-finish-load", () => {
            const runtime = LauncherRuntime.resolve();
            instance.reportRuntimeStatus(
              runtime.missing.includes("chromium")
                ? "접근성 검사용 Chromium을 백그라운드에서 준비하는 중입니다."
                : "접근성 검사 런타임이 준비되었습니다.",
            );
          });
        }
      }, 300);
    }

    return this.mainWindow;
  };

  public setAppEvents = () => {
    const instance = this;

    this.mainApp.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        instance.createWindow();
      }
    });

    this.mainApp.on("window-all-closed", () => {
      if (process.platform !== "darwin") {
        instance.mainApp.quit();
      }
    });
  };

  public setIpcHandlers = () => {
    /*
     * IPC is the public backend contract for the renderer.
     *
     * Keep filesystem access, child processes, EPUB zip mutation, and runtime
     * resolution in the main process. The renderer should only receive explicit
     * data objects through preload.
     */
    ipcMain.on("window:minimize", () => {
      this.mainWindow?.minimize();
    });

    ipcMain.on("window:maximize", () => {
      if (this.mainWindow?.isMaximized()) {
        this.mainWindow.unmaximize();
      } else {
        this.mainWindow?.maximize();
      }
    });

    ipcMain.on("window:close", () => {
      this.mainWindow?.close();
    });

    ipcMain.handle("window:isMaximized", () => {
      return this.mainWindow?.isMaximized() ?? false;
    });

    ipcMain.handle("aboutComputer", async () => {
      return await aboutComputerInfo();
    });

    ipcMain.handle("screen:capture", async (_, options?: { format?: "png" | "jpeg"; quality?: number }) => {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        throw new Error("No active window");
      }

      const image = await this.captureWindowScreenshot();
      const format = options?.format ?? "png";
      let buffer: Buffer;

      if (format === "jpeg") {
        const quality = options?.quality ?? 85;
        buffer = image.toJPEG(quality);
      } else {
        buffer = image.toPNG();
      }

      // Save destination always comes from the native dialog, never from a
      // renderer-supplied path — this channel used to accept an arbitrary
      // `filePath` and write to it unvalidated, which is an arbitrary file
      // write if anything in the renderer (a compromised dependency, an
      // injected script) called it directly.
      const result = await dialog.showSaveDialog(this.mainWindow, {
        title: "Save Screenshot",
        defaultPath: `screenshot-${Date.now()}.${format}`,
        filters: [{ name: "Images", extensions: [format === "jpeg" ? "jpg" : "png"] }],
      });
      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      await fsPromise.writeFile(result.filePath, buffer);
      return { saved: true, filePath: result.filePath, size: buffer.length };
    });

    ipcMain.handle("epub:runtime-info", async () => {
      this.launcherRuntime = LauncherRuntime.applyToEnvironment();
      return this.launcherRuntime;
    });

    ipcMain.handle("epub:select-file", async (): Promise<EpubSelectFileResult> => {
      const win = this.assertMainWindow();
      const result = await dialog.showOpenDialog(win, {
        title: "EPUB 파일 선택",
        properties: ["openFile"],
        filters: [{ name: "EPUB", extensions: ["epub"] }],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return {
          canceled: true,
          filePath: null,
          fileName: null,
        };
      }

      const filePath = result.filePaths[0];
      return {
        canceled: false,
        filePath,
        fileName: path.basename(filePath),
      };
    });

    ipcMain.handle("epub:inspect-file", async (_event, payload: EpubInspectPayload): Promise<EpubInspectResponse> => {
      const filePath = String(payload?.filePath ?? "").trim();
      if (filePath === "") {
        throw new Error("EPUB file path is required");
      }
      if (!/\.epub$/i.test(filePath)) {
        throw new Error("Only .epub files can be inspected");
      }
      if (!existsSync(filePath)) {
        throw new Error("EPUB file does not exist");
      }

      this.launcherRuntime = LauncherRuntime.applyToEnvironment();
      let includeAce = payload?.includeAce ?? true;
      let aceUnavailableReason: string | undefined;
      // Do not make EPUBCheck wait for a potentially large first-run browser
      // download. Keep the shared background install running and perform the
      // standards check now; a later re-check will include Ace once ready.
      if (includeAce && this.launcherRuntime.missing.includes("chromium")) {
        includeAce = false;
        aceUnavailableReason = "Chromium is being prepared in the background";
        void LauncherRuntime.ensureChromium((message) => this.reportRuntimeStatus(message)).catch((err) => {
          this.reportRuntimeStatus(`Chromium 다운로드 실패: ${(err as Error)?.message ?? err}`);
        });
      }
      // EPUBCheck needs Java and the jar. Ace additionally needs Chromium.
      // Checking here gives the renderer a clear actionable error before a
      // long validation process starts.
      const missingRequired = this.launcherRuntime.missing.filter((name) => {
        return name === "java" || name === "epubcheck" || (includeAce && name === "chromium");
      });
      if (missingRequired.length > 0) {
        throw new Error(
          [
            `Missing local runtime: ${missingRequired.join(", ")}`,
            `launcherRoot=${this.launcherRuntime.launcherRoot}`,
            `java=${this.launcherRuntime.javaCommand}`,
            `epubcheck=${this.launcherRuntime.epubcheckJarPath}`,
            `chromium=${this.launcherRuntime.chromiumExecutablePath}`,
          ].join("\n"),
        );
      }
      const maker = new EpubMaker({
        includeAce,
        javaCommand: this.launcherRuntime.javaCommand,
        epubcheckJarPath: this.launcherRuntime.epubcheckJarPath,
      });
      const result = await maker.inspectEpub(filePath, {
        includeAce,
        deleteMode: false,
      });

      return {
        runtime: this.launcherRuntime,
        result: aceUnavailableReason
          ? { ...result, logs: result.logs.concat(`Ace skipped: ${aceUnavailableReason}`) }
          : result,
      };
    });

    ipcMain.handle("workspace:open", async (_event, payload: EpubWorkspaceOpenPayload) => {
      const filePath = String(payload?.filePath ?? "").trim();
      if (filePath === "") {
        throw new Error("EPUB file path is required");
      }
      if (!existsSync(filePath)) {
        throw new Error("EPUB file does not exist");
      }
      return await this.workspaceManager.open(filePath);
    });

    ipcMain.handle("workspace:get-file", async (_event, payload: EpubWorkspaceFilePayload) => {
      return await this.workspaceManager.getFile(payload.workspaceId, payload.filePath);
    });

    ipcMain.handle("workspace:close", async (_event, payload: { workspaceId: string }) => {
      this.workspaceManager.close(payload.workspaceId);
      return { closed: true };
    });

    ipcMain.handle("workspace:update-file", async (_event, payload: EpubWorkspaceUpdatePayload) => {
      return await this.workspaceManager.updateFile(payload.workspaceId, payload.filePath, payload.content);
    });

    ipcMain.handle("workspace:export", async (_event, payload: { workspaceId: string }) => {
      // No renderer-supplied output path here: this channel always exports to
      // the manager's own internal temp location. Saving to an
      // arbitrary/user-chosen filesystem path is "workspace:export-as" below,
      // whose path always comes from a native save dialog, never from
      // renderer-controlled input — writing straight to a caller-supplied
      // path would be an arbitrary file write.
      return await this.workspaceManager.export(payload.workspaceId);
    });

    ipcMain.handle("workspace:export-as", async (_event, payload: { workspaceId: string; defaultName?: string }) => {
      const win = this.assertMainWindow();
      const result = await dialog.showSaveDialog(win, {
        title: "수정된 EPUB 저장",
        defaultPath: payload?.defaultName ?? `repaired-${Date.now()}.epub`,
        filters: [{ name: "EPUB", extensions: ["epub"] }],
      });
      if (result.canceled || !result.filePath) {
        return {
          canceled: true,
          filePath: null,
        };
      }
      const exported = await this.workspaceManager.export(payload.workspaceId, result.filePath);
      const files = this.workspaceManager.markExported(payload.workspaceId, exported.revision);
      return {
        canceled: false,
        filePath: exported.filePath,
        files,
        revision: exported.revision,
      };
    });

    ipcMain.handle("workspace:inspect", async (_event, payload: EpubWorkspaceInspectPayload) => {
      this.launcherRuntime = LauncherRuntime.applyToEnvironment();
      const requestedAce = payload?.includeAce ?? true;
      let includeAce = requestedAce;
      let aceUnavailableReason: string | undefined;
      if (includeAce && this.launcherRuntime.missing.includes("chromium")) {
        includeAce = false;
        aceUnavailableReason = "Chromium is being prepared in the background";
        void LauncherRuntime.ensureChromium((message) => this.reportRuntimeStatus(message)).catch((err) => {
          this.reportRuntimeStatus(`Chromium 다운로드 실패: ${(err as Error)?.message ?? err}`);
        });
      }
      // Workspace inspection always validates an exported temporary EPUB, not
      // the original source file. Renderer auto-save is flushed before this IPC
      // call so the exported zip contains the latest editor content.
      const missingRequired = this.launcherRuntime.missing.filter((name) => {
        return name === "java" || name === "epubcheck" || (includeAce && name === "chromium");
      });
      if (missingRequired.length > 0) {
        throw new Error(
          [
            `Missing local runtime: ${missingRequired.join(", ")}`,
            `launcherRoot=${this.launcherRuntime.launcherRoot}`,
            `java=${this.launcherRuntime.javaCommand}`,
            `epubcheck=${this.launcherRuntime.epubcheckJarPath}`,
            `chromium=${this.launcherRuntime.chromiumExecutablePath}`,
          ].join("\n"),
        );
      }
      const maker = new EpubMaker({
        includeAce,
        javaCommand: this.launcherRuntime.javaCommand,
        epubcheckJarPath: this.launcherRuntime.epubcheckJarPath,
      });
      const response = await this.workspaceManager.inspect(payload.workspaceId, maker, includeAce);
      return {
        ...response,
        ...(requestedAce && !includeAce ? { aceUnavailableReason } : {}),
      };
    });

    ipcMain.on("app:notify", (_, { title, body }) => {
      // 제목과 내용을 합쳐서 고유 식별 키로 사용 (SSE에서 고유 ID를 넘겨준다면 그걸 써도 됩니다)
      const notifyKey = `${title}::${body}`;

      // 이미 1초 내에 동일한 알림이 띄워졌다면 무시
      if (this.recentNotifications.has(notifyKey)) {
        return;
      }

      this.recentNotifications.add(notifyKey);
      setTimeout(() => {
        this.recentNotifications.delete(notifyKey);
      }, 1000);

      // 정상적으로 알림 객체 생성
      const notification = new Notification({
        title,
        body,
        icon: this.iconPath,
      });

      notification.on("click", () => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          if (this.mainWindow.isMinimized()) {
            this.mainWindow.restore();
          }
          this.mainWindow.focus();
        }
      });

      notification.show();
    });
  };

  /* ═══════════════════════════════════════════════════════
     네비게이션 / 권한 가드
     로컬 전용 앱이므로 렌더러는 항상 targetUrl(로컬 index.html)에만
     머물러야 한다. 그 외 모든 http(s) 링크는 시스템 기본 브라우저로 연다.
     ═══════════════════════════════════════════════════════ */

  private assertMainWindow(): BrowserWindow {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      throw new Error("No active window");
    }
    return this.mainWindow;
  }

  /** Asks the renderer to flush pending autosaves, then actually closes —
   * bounded by a timeout so a hung/crashed renderer can't make the app
   * unclosable. */
  private flushRendererBeforeClose(win: BrowserWindow): void {
    // Renderer autosave has its own 10-second failure deadline. Give it time
    // to reject and cancel the close instead of force-closing first.
    const FLUSH_TIMEOUT_MS = 15000;
    let finished = false;
    let initialTimeout: ReturnType<typeof setTimeout> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let handleFlushComplete: ((event: Electron.IpcMainEvent, payload?: { canClose?: boolean }) => void) | null = null;
    const handleConfirming = () => {
      if (initialTimeout) {
        clearTimeout(initialTimeout);
        initialTimeout = null;
      }
    };
    const handleFlushStarted = () => {
      handleConfirming();
      timeout = setTimeout(finish, FLUSH_TIMEOUT_MS);
    };
    const cleanupListeners = () => {
      ipcMain.removeListener("app:close-confirming", handleConfirming);
      ipcMain.removeListener("app:flush-started", handleFlushStarted);
      if (handleFlushComplete) {
        ipcMain.removeListener("app:flush-complete", handleFlushComplete);
      }
    };
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      cleanupListeners();
      this.closeAfterFlush = true;
      this.closeFlushInFlight = false;
      if (!win.isDestroyed()) {
        win.close();
      }
    };
    // Only guards a renderer that never responds at all. The renderer sends
    // close-confirming before showing the user dialog, which cancels this
    // watchdog so deliberation time is unlimited.
    initialTimeout = setTimeout(finish, 5000);
    ipcMain.once("app:close-confirming", handleConfirming);
    ipcMain.once("app:flush-started", handleFlushStarted);
    handleFlushComplete = (_event, payload?: { canClose?: boolean }) => {
      cleanupListeners();
      if (initialTimeout) {
        clearTimeout(initialTimeout);
      }
      if (timeout) {
        clearTimeout(timeout);
      }
      if (payload?.canClose === true) {
        finish();
      } else {
        finished = true;
        this.closeFlushInFlight = false;
      }
    };
    ipcMain.once("app:flush-complete", handleFlushComplete);
    if (win.webContents.isDestroyed()) {
      finish();
      return;
    }
    win.webContents.send("app:flush-before-close");
  }

  /** 새 창 열기 시도는 모두 차단하고, http(s) 링크만 시스템 브라우저로 위임 */
  private attachNavigationGuards = (webContents: Electron.WebContents) => {
    webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) {
        shell.openExternal(url).catch((err) => console.warn(`openExternal failed: ${(err as Error).message}`));
      }
      return { action: "deny" };
    });

    webContents.on("will-navigate", (event, url) => {
      if (url === this.targetUrl || url === "about:blank") {
        return;
      }
      event.preventDefault();
      if (/^https?:/i.test(url)) {
        shell.openExternal(url).catch((err) => console.warn(`openExternal failed: ${(err as Error).message}`));
      }
    });
  };

  /** 현재 창을 캡처 */
  private async captureWindowScreenshot(): Promise<Electron.NativeImage> {
    const mainWindow = this.assertMainWindow();
    const [w, h] = mainWindow.getContentSize();
    return await mainWindow.webContents.capturePage({ x: 0, y: 0, width: w, height: h });
  }

  public main = async () => {
    const instance = this;
    const currentArch: string = os.arch();

    // Two instances would share Mother.userDataPath/tempFolder with no
    // coordination (e.g. concurrent Date.now()-keyed temp/export filenames
    // could collide). Bounce the second launch to the first instance's window.
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }
    app.on("second-instance", () => {
      if (this.mainWindow) {
        if (this.mainWindow.isMinimized()) {
          this.mainWindow.restore();
        }
        this.mainWindow.focus();
      }
    });

    app.commandLine.appendSwitch("force-gpu-rasterization");
    app.commandLine.appendSwitch("ignore-gpu-blocklist");
    app.commandLine.appendSwitch("enable-gpu-rasterization");
    app.commandLine.appendSwitch("enable-zero-copy");
    app.commandLine.appendSwitch("num-raster-threads", "4");
    app.commandLine.appendSwitch("enable-webgl");
    app.commandLine.appendSwitch("enable-webgl-image-chromium");
    app.commandLine.appendSwitch("enable-accelerated-2d-canvas");
    app.commandLine.appendSwitch("enable-oop-rasterization");
    app.commandLine.appendSwitch("disable-software-rasterizer");
    app.commandLine.appendSwitch("enable-webgl2-compute-context");
    app.commandLine.appendSwitch("enable-features", "CanvasOopRasterization");
    app.commandLine.appendSwitch("enable-native-gpu-memory-buffers");
    if (/arm64/g.test(currentArch)) {
      app.commandLine.appendSwitch("use-angle", "metal");
    }
    app.commandLine.appendSwitch("renderer-process-limit", "4");
    app.commandLine.appendSwitch("max-active-webgl-contexts", "16");
    app.commandLine.appendSwitch("enable-unsafe-webgpu");
    app.commandLine.appendSwitch("enable-smooth-scrolling");

    this.setIconPath();
    await this.mainApp.whenReady();

    // 로컬 전용 앱: 원격 권한 요청(카메라/마이크/알림 등)은 모두 거부
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    // setPermissionRequestHandler alone only gates the async request path;
    // the synchronous check-handler (used by some navigator.permissions.query()
    // style checks) defaults to allow if left unset even though the actual
    // request would still be denied above — set both for consistency.
    session.defaultSession.setPermissionCheckHandler(() => false);

    this.launcherRuntime = LauncherRuntime.applyToEnvironment();
    // mac doesn't bundle Chromium (Apple notarization rejects Playwright's Chrome for
    // Testing bundle layout) — download it into userData in the background so it's
    // likely ready by the time the user first runs an accessibility check.
    this.reportRuntimeStatus("접근성 검사용 Chromium을 확인하는 중입니다.");
    LauncherRuntime.ensureChromium((message) => this.reportRuntimeStatus(message))
      .then((runtime) => {
        this.launcherRuntime = LauncherRuntime.applyToEnvironment();
        const ready = !runtime.missing.includes("chromium");
        this.reportRuntimeStatus(
          ready ? "접근성 검사 런타임이 준비되었습니다." : "Chromium 런타임을 준비하지 못했습니다.",
        );
        console.log(
          ready
            ? `[LauncherRuntime] startup Chromium check OK: ${runtime.chromiumExecutablePath}`
            : `[LauncherRuntime] startup Chromium check incomplete; missing=${runtime.missing.join(", ")}`,
        );
      })
      .catch((err) => {
        this.reportRuntimeStatus(`Chromium 다운로드 실패: ${(err as Error)?.message ?? err}`);
        console.error("[LauncherRuntime] background Chromium download failed:", err);
      });

    this.createWindow();
    this.setAppEvents();
    this.setIpcHandlers();
  };
}

const epubApp: EpubChecker = new EpubChecker();
epubApp.main().catch((err) => console.log(err));

export { EpubChecker };
