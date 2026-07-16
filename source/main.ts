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

    ipcMain.handle(
      "screen:capture",
      async (_, options?: { filePath?: string; format?: "png" | "jpeg"; quality?: number }) => {
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

        let savePath = options?.filePath;
        if (!savePath) {
          const result = await dialog.showSaveDialog(this.mainWindow, {
            title: "Save Screenshot",
            defaultPath: `screenshot-${Date.now()}.${format}`,
            filters: [{ name: "Images", extensions: [format === "jpeg" ? "jpg" : "png"] }],
          });
          if (result.canceled || !result.filePath) {
            return { canceled: true };
          }
          savePath = result.filePath;
        }

        await fsPromise.writeFile(savePath, buffer);
        return { saved: true, filePath: savePath, size: buffer.length };
      },
    );

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
      const includeAce = payload?.includeAce ?? true;
      // mac downloads Chromium into userData in the background at startup; wait
      // for it here if the user ran an Ace check before that finished.
      if (includeAce && this.launcherRuntime.missing.includes("chromium")) {
        try {
          this.launcherRuntime = await LauncherRuntime.ensureChromium((message) =>
            console.log(`[LauncherRuntime] ${message}`),
          );
        } catch (err) {
          console.log("[LauncherRuntime] on-demand Chromium download failed:", err);
        }
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
        result,
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

    ipcMain.handle("workspace:update-file", async (_event, payload: EpubWorkspaceUpdatePayload) => {
      return await this.workspaceManager.updateFile(payload.workspaceId, payload.filePath, payload.content);
    });

    ipcMain.handle("workspace:export", async (_event, payload: { workspaceId: string; outputPath?: string }) => {
      return await this.workspaceManager.export(payload.workspaceId, payload.outputPath);
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
      return {
        canceled: false,
        filePath: exported.filePath,
      };
    });

    ipcMain.handle("workspace:inspect", async (_event, payload: EpubWorkspaceInspectPayload) => {
      this.launcherRuntime = LauncherRuntime.applyToEnvironment();
      const includeAce = payload?.includeAce ?? true;
      if (includeAce && this.launcherRuntime.missing.includes("chromium")) {
        try {
          this.launcherRuntime = await LauncherRuntime.ensureChromium((message) =>
            console.log(`[LauncherRuntime] ${message}`),
          );
        } catch (err) {
          console.log("[LauncherRuntime] on-demand Chromium download failed:", err);
        }
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
      return await this.workspaceManager.inspect(payload.workspaceId, maker, includeAce);
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

    this.launcherRuntime = LauncherRuntime.applyToEnvironment();
    // mac doesn't bundle Chromium (Apple notarization rejects Playwright's Chrome for
    // Testing bundle layout) — download it into userData in the background so it's
    // likely ready by the time the user first runs an accessibility check.
    console.log("[LauncherRuntime] checking Chromium runtime at startup...");
    LauncherRuntime.ensureChromium((message) => console.log(`[LauncherRuntime] ${message}`))
      .then((runtime) => {
        const ready = !runtime.missing.includes("chromium");
        console.log(
          ready
            ? `[LauncherRuntime] startup Chromium check OK: ${runtime.chromiumExecutablePath}`
            : `[LauncherRuntime] startup Chromium check incomplete; missing=${runtime.missing.join(", ")}`,
        );
      })
      .catch((err) => console.error("[LauncherRuntime] background Chromium download failed:", err));

    this.createWindow();
    this.setAppEvents();
    this.setIpcHandlers();
  };
}

const epubApp: EpubChecker = new EpubChecker();
epubApp.main().catch((err) => console.log(err));

export { EpubChecker };
