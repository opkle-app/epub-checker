import { Unique } from "./classStorage/dictionary.js";
import path from "path";
import os from "os";

const IN_ELECTRON: boolean = typeof (process as any).versions.electron === "string";

const safeElectronApp = (): any | null => {
  if (!IN_ELECTRON) return null;
  try {
    // electron main process에서는 require('electron') 가 실제 app 모듈을 돌려준다.
    // tsx/cjs/esm 모두 호환되도록 createRequire 사용.
    const { createRequire } = require("module") as typeof import("module");
    const localRequire: NodeRequire = createRequire(
      typeof __filename !== "undefined" ? __filename : (import.meta as any).url,
    );
    const electronModule = localRequire("electron");
    return electronModule?.app ?? null;
  } catch {
    return null;
  }
};

const fallbackTemp = (): string => {
  try {
    return os.tmpdir();
  } catch {
    return "/tmp";
  }
};

/**
 * Mother resolves the small set of filesystem paths the Electron main
 * process needs: where the renderer bundle lives, where compiled main/preload
 * scripts live, and where this app's local temp/workspace files should go.
 *
 * Electron-aware when running inside the packaged app, with plain Node
 * fallbacks so the same getters behave sanely outside Electron too.
 */
class Mother {
  // ── electron 의존 값은 lazy getter (Electron 부재 시 Node 안전한 폴백) ──
  public static get isDev(): boolean {
    const a = safeElectronApp();
    if (a) return !a.isPackaged;
    return process.env.NODE_ENV !== "production";
  }

  public static get appPath(): string {
    const a = safeElectronApp();
    if (a) {
      try {
        return a.getAppPath();
      } catch {
        /* fallthrough */
      }
    }
    return process.cwd();
  }

  public static get resourcePath(): string {
    const a = safeElectronApp();
    if (a) {
      try {
        return Mother.isDev ? a.getAppPath() : process.resourcesPath;
      } catch {
        /* fallthrough */
      }
    }
    return process.cwd();
  }

  public static get scriptPath(): string {
    return path.join(Mother.appPath, "dist");
  }

  public static get assetPath(): string {
    return path.join(Mother.resourcePath, "./renderer");
  }

  public static get userDataPath(): string {
    const a = safeElectronApp();
    if (a) {
      try {
        return a.getPath("userData");
      } catch {
        /* fallthrough */
      }
    }
    return path.join(fallbackTemp(), "epubChecker", "userData");
  }

  public static readonly abstractTempFolderName: string = "abstract_cloud_temp_folder";

  public static get tempFolder(): string {
    const a = safeElectronApp();
    if (a) {
      try {
        return path.join(a.getPath("temp"), path.normalize(Mother.abstractTempFolderName + "/temp"));
      } catch {
        /* fallthrough */
      }
    }
    return path.join(fallbackTemp(), "epubChecker", "temp");
  }
}

export { Unique, Mother };
