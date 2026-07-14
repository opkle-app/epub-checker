import { existsSync, readdirSync, mkdirSync, rmSync, cpSync } from "fs";
import { spawn } from "child_process";
import { createRequire } from "module";
import path from "path";
import process from "process";
import { Mother } from "./mother.js";

interface LauncherRuntimeInfo {
  launcherRoot: string;
  platformRoot: string;
  platformKey: string;
  javaCommand: string;
  epubcheckJarPath: string;
  chromiumExecutablePath: string;
  playwrightBrowsersPath: string;
  missing: string[];
}

class LauncherRuntime {
  public static launcherFolderName: string = "launcher";

  /**
   * Local runtime layout expected by EpubChecker.
   *
   * In development, files live under the repo root's "launcher" folder
   * (process.cwd() while running via `npm run dev`/`electron .`).
   * In a packaged app, the same folder must be shipped as an electron-builder
   * extraResources entry so it lands under Mother.resourcePath ("launcher").
   * The folder is intentionally gitignored because JRE and Chromium are large binaries.
   *
   * mac does NOT bundle Chromium this way — Apple notarization rejects Playwright's
   * "Chrome for Testing" bundle structure (Versions/X/Libraries and Helpers aren't
   * recognized framework subdirectories, and re-signing it broke in ways that risked
   * the app's own signature). Instead Chromium is downloaded on demand into
   * Mother.userDataPath, outside the signed/notarized .app entirely. See
   * ensureChromium() below and getUserDataChromiumRoot().
   *
   * Recommended layout:
   *
   * launcher/
   *   darwin-arm64/
   *     jre/bin/java
   *     epubcheck/epubcheck.jar
   *   darwin-x64/
   *     jre/bin/java
   *     epubcheck/epubcheck.jar
   *   win32-x64/
   *     jre/bin/java.exe
   *     epubcheck/epubcheck.jar
   *     chromium/chrome-win/chrome.exe
   *   linux-x64/
   *     jre/bin/java
   *     epubcheck/epubcheck.jar
   *     chromium/chrome-linux/chrome
   *
   * A common/ folder is also checked as a fallback for shared assets:
   *
   * launcher/common/epubcheck/epubcheck.jar
   */
  public static getLauncherRoot = (): string => {
    // Packaged builds must resolve this via extraResources (Mother.resourcePath),
    // not process.cwd(), which is unreliable once Electron is packaged.
    return path.join(Mother.resourcePath, LauncherRuntime.launcherFolderName);
  };

  public static getPlatformKey = (): string => {
    return `${process.platform}-${process.arch}`;
  };

  public static getUserDataChromiumRoot = (): string => {
    return path.join(Mother.userDataPath, "chromium-runtime");
  };

  private static firstExisting = (candidates: string[], fallback: string): string => {
    return candidates.find((candidate) => existsSync(candidate)) ?? fallback;
  };

  // Playwright has renamed its Chromium folder over time
  // (chrome-mac, chrome-mac-x64, chrome-mac-arm64, chrome-win, chrome-linux).
  // Generates every known variant under a given "chromium/" root so the same
  // candidate list can check the bundled launcher root, the common/ fallback,
  // and the userData download location.
  private static chromiumCandidatesUnder = (chromiumRoot: string): string[] => {
    return [
      path.join(chromiumRoot, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      path.join(chromiumRoot, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
      path.join(chromiumRoot, "chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      path.join(chromiumRoot, "chrome-mac-x64", "Chromium.app", "Contents", "MacOS", "Chromium"),
      path.join(chromiumRoot, "chrome-mac", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      path.join(chromiumRoot, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
      path.join(chromiumRoot, "Chromium.app", "Contents", "MacOS", "Chromium"),
      // Windows
      path.join(chromiumRoot, "chrome-win-x64", "chrome.exe"),
      path.join(chromiumRoot, "chrome-win", "chrome.exe"),
      // Linux
      path.join(chromiumRoot, "chrome-linux-x64", "chrome"),
      path.join(chromiumRoot, "chrome-linux", "chrome"),
      path.join(chromiumRoot, "chromium"),
    ];
  };

  public static resolve = (): LauncherRuntimeInfo => {
    const launcherRoot = LauncherRuntime.getLauncherRoot();
    const platformKey = LauncherRuntime.getPlatformKey();
    const platformRoot = path.join(launcherRoot, platformKey);
    const commonRoot = path.join(launcherRoot, "common");
    const userDataChromiumRoot = path.join(LauncherRuntime.getUserDataChromiumRoot(), "chromium");

    // Runtime archives differ slightly by OS and vendor version. The resolver
    // accepts both the flat jre/bin/java layout produced by setup-launcher and
    // the macOS Contents/Home layout users may create manually.
    const javaName = process.platform === "win32" ? "java.exe" : "java";
    const javaCommand = LauncherRuntime.firstExisting(
      [
        path.join(platformRoot, "jre", "Contents", "Home", "bin", javaName),
        path.join(platformRoot, "jre", "bin", javaName),
        path.join(platformRoot, "java", "bin", javaName),
        path.join(commonRoot, "jre", "bin", javaName),
      ],
      path.join(platformRoot, "jre", "bin", javaName),
    );

    const epubcheckJarPath = LauncherRuntime.firstExisting(
      [
        path.join(platformRoot, "epubcheck", "epubcheck.jar"),
        path.join(platformRoot, "epubcheck.jar"),
        path.join(commonRoot, "epubcheck", "epubcheck.jar"),
        path.join(commonRoot, "epubcheck.jar"),
      ],
      path.join(platformRoot, "epubcheck", "epubcheck.jar"),
    );

    // Checked in this order: a previously downloaded userData copy (mac's only
    // source, but harmless to check everywhere), then the bundled launcher root
    // (win/linux still ship Chromium this way), then the shared common/ fallback.
    const chromiumExecutablePath = LauncherRuntime.firstExisting(
      [
        ...LauncherRuntime.chromiumCandidatesUnder(userDataChromiumRoot),
        ...LauncherRuntime.chromiumCandidatesUnder(path.join(platformRoot, "chromium")),
        ...LauncherRuntime.chromiumCandidatesUnder(path.join(commonRoot, "chromium")),
      ],
      path.join(platformRoot, "chromium"),
    );

    const playwrightBrowsersPath = LauncherRuntime.firstExisting(
      [
        userDataChromiumRoot,
        path.join(platformRoot, "playwright"),
        path.join(platformRoot, "chromium"),
        path.join(commonRoot, "playwright"),
        path.join(commonRoot, "chromium"),
      ],
      path.join(platformRoot, "chromium"),
    );

    const missing: string[] = [];
    if (!existsSync(javaCommand)) {
      missing.push("java");
    }
    if (!existsSync(epubcheckJarPath)) {
      missing.push("epubcheck");
    }
    if (!existsSync(chromiumExecutablePath)) {
      missing.push("chromium");
    }

    return {
      launcherRoot,
      platformRoot,
      platformKey,
      javaCommand,
      epubcheckJarPath,
      chromiumExecutablePath,
      playwrightBrowsersPath,
      missing,
    };
  };

  public static applyToEnvironment = (): LauncherRuntimeInfo => {
    const runtime = LauncherRuntime.resolve();
    const javaBinFolder = path.dirname(runtime.javaCommand);
    const javaHome = path.dirname(javaBinFolder);
    const delimiter = process.platform === "win32" ? ";" : ":";

    process.env.JAVA_HOME = javaHome;
    process.env.JAVA_BIN = runtime.javaCommand;
    process.env.EPUBCHECK_JAR = runtime.epubcheckJarPath;
    process.env.PLAYWRIGHT_BROWSERS_PATH = runtime.playwrightBrowsersPath;
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = runtime.chromiumExecutablePath;
    process.env.ACE_CHROMIUM_EXECUTABLE_PATH = runtime.chromiumExecutablePath;
    process.env.PATH = `${javaBinFolder}${delimiter}${process.env.PATH ?? ""}`;

    return runtime;
  };

  private static installPlaywrightChromium = async (browsersPath: string): Promise<void> => {
    const require = createRequire(import.meta.url);
    const cliPath = require.resolve("playwright/cli.js");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [cliPath, "install", "chromium"], {
        // process.execPath is the Electron binary in a packaged app; ELECTRON_RUN_AS_NODE
        // makes it behave as a plain Node runtime for this one child process instead of
        // trying to launch another Electron GUI instance.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PLAYWRIGHT_BROWSERS_PATH: browsersPath },
        stdio: "inherit",
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`playwright install chromium exited with code ${code}`));
      });
    });
  };

  /**
   * Downloads Chromium into Mother.userDataPath on demand (mac has no bundled
   * copy — see the class doc comment above). No-op if Chromium already resolves.
   * Safe to call on every platform: win/linux just short-circuit since their
   * bundled copy already satisfies resolve().
   */
  // Guards against concurrent callers (background startup download + a user
  // triggering an Ace check before that finishes) both spawning their own
  // `playwright install chromium` into the same destination directory at once.
  private static ensureChromiumInFlight: Promise<LauncherRuntimeInfo> | null = null;

  public static ensureChromium = async (onProgress?: (message: string) => void): Promise<LauncherRuntimeInfo> => {
    const current = LauncherRuntime.resolve();
    if (!current.missing.includes("chromium")) {
      return current;
    }

    if (LauncherRuntime.ensureChromiumInFlight) {
      return LauncherRuntime.ensureChromiumInFlight;
    }

    const task = LauncherRuntime.downloadChromium(onProgress).finally(() => {
      LauncherRuntime.ensureChromiumInFlight = null;
    });
    LauncherRuntime.ensureChromiumInFlight = task;
    return task;
  };

  private static downloadChromium = async (onProgress?: (message: string) => void): Promise<LauncherRuntimeInfo> => {
    const userDataRoot = LauncherRuntime.getUserDataChromiumRoot();
    const downloadCacheDir = path.join(userDataRoot, "_download-cache");
    mkdirSync(downloadCacheDir, { recursive: true });

    onProgress?.("Downloading local Chromium runtime for accessibility checks...");
    await LauncherRuntime.installPlaywrightChromium(downloadCacheDir);

    const versionDirs = readdirSync(downloadCacheDir).filter(
      (name) => name.startsWith("chromium-") && !name.includes("headless_shell"),
    );
    if (versionDirs.length === 0) {
      throw new Error(`playwright install produced no chromium-* folder under ${downloadCacheDir}`);
    }
    const versionDir = path.join(downloadCacheDir, versionDirs.sort().at(-1) as string);

    const platformPrefix =
      process.platform === "darwin" ? "chrome-mac" : process.platform === "win32" ? "chrome-win" : "chrome-linux";
    const matching = readdirSync(versionDir).filter((name) => name.startsWith(platformPrefix));
    if (matching.length === 0) {
      throw new Error(`no ${platformPrefix}* folder found under ${versionDir}`);
    }
    const archSpecific = `${platformPrefix}-${process.arch}`;
    const chosen = matching.includes(archSpecific) ? archSpecific : matching.sort((a, b) => b.length - a.length)[0];

    const destRoot = path.join(userDataRoot, "chromium");
    const destDir = path.join(destRoot, chosen);
    rmSync(destDir, { recursive: true, force: true });
    mkdirSync(destRoot, { recursive: true });
    cpSync(path.join(versionDir, chosen), destDir, { recursive: true });
    rmSync(downloadCacheDir, { recursive: true, force: true });

    onProgress?.("Chromium runtime ready.");
    return LauncherRuntime.resolve();
  };
}

export { LauncherRuntime, LauncherRuntimeInfo };
