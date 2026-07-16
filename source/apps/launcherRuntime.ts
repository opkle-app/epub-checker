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

interface ChromiumRuntimeProgress {
  code: "chromium-downloading" | "chromium-ready";
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
      path.join(
        chromiumRoot,
        "chrome-mac-arm64",
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing",
      ),
      path.join(chromiumRoot, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
      path.join(
        chromiumRoot,
        "chrome-mac-x64",
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing",
      ),
      path.join(chromiumRoot, "chrome-mac-x64", "Chromium.app", "Contents", "MacOS", "Chromium"),
      path.join(
        chromiumRoot,
        "chrome-mac",
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing",
      ),
      path.join(chromiumRoot, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
      path.join(chromiumRoot, "Chromium.app", "Contents", "MacOS", "Chromium"),
      // Windows (Playwright's actual folder is "chrome-win64" — no per-arch
      // arm64 build is published, "chrome-win" is only kept for older archives)
      path.join(chromiumRoot, "chrome-win64", "chrome.exe"),
      path.join(chromiumRoot, "chrome-win", "chrome.exe"),
      // Linux (same story: "chrome-linux64" is current, "chrome-linux" legacy)
      path.join(chromiumRoot, "chrome-linux64", "chrome"),
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
    // playwright's package.json "exports" map doesn't expose "./cli.js"
    // directly (only "." and a handful of "./lib/*" subpaths), so resolving
    // it throws ERR_PACKAGE_PATH_NOT_EXPORTED. Resolve the (exported)
    // package.json instead and derive the cli path from its "bin" field.
    const playwrightPkgPath = require.resolve("playwright/package.json");
    const playwrightPkg = require(playwrightPkgPath) as { bin?: Record<string, string> };
    const cliPath = path.join(path.dirname(playwrightPkgPath), playwrightPkg.bin?.playwright ?? "cli.js");
    console.log(`[LauncherRuntime] playwright install chromium starting (browsersPath=${browsersPath})`);
    console.log(
      '[LauncherRuntime] Playwright may print "Downloading Electron binary..." — that is Chromium for Ace, not the Electron app itself.',
    );
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [cliPath, "install", "chromium"], {
        // process.execPath is the Electron binary in a packaged app; ELECTRON_RUN_AS_NODE
        // makes it behave as a plain Node runtime for this one child process instead of
        // trying to launch another Electron GUI instance.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PLAYWRIGHT_BROWSERS_PATH: browsersPath },
        stdio: "inherit",
      });
      const timeout = setTimeout(
        () => {
          child.kill();
          reject(new Error("playwright install chromium timed out after 15 minutes"));
        },
        15 * 60 * 1000,
      );
      child.on("error", (err) => {
        clearTimeout(timeout);
        console.error("[LauncherRuntime] playwright install chromium failed to spawn:", err);
        reject(err);
      });
      child.on("exit", (code, signal) => {
        clearTimeout(timeout);
        if (code === 0) {
          console.log("[LauncherRuntime] playwright install chromium completed successfully (exit 0)");
          resolve();
          return;
        }
        const detail = signal ? `signal ${signal}` : `exit code ${code}`;
        const error = new Error(`playwright install chromium failed (${detail})`);
        console.error(`[LauncherRuntime] ${error.message}`);
        reject(error);
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

  public static ensureChromium = async (
    onProgress?: (status: ChromiumRuntimeProgress) => void,
  ): Promise<LauncherRuntimeInfo> => {
    const current = LauncherRuntime.resolve();
    if (!current.missing.includes("chromium")) {
      console.log(`[LauncherRuntime] Chromium already available: ${current.chromiumExecutablePath}`);
      return current;
    }

    if (LauncherRuntime.ensureChromiumInFlight) {
      console.log("[LauncherRuntime] Chromium download already in progress; waiting for the same task.");
      return LauncherRuntime.ensureChromiumInFlight;
    }

    console.log("[LauncherRuntime] Chromium missing — starting on-demand download.");
    const task = LauncherRuntime.downloadChromium(onProgress)
      .then((runtime) => {
        console.log(`[LauncherRuntime] Chromium download succeeded: ${runtime.chromiumExecutablePath}`);
        return runtime;
      })
      .catch((err) => {
        console.error("[LauncherRuntime] Chromium download failed:", err);
        throw err;
      })
      .finally(() => {
        LauncherRuntime.ensureChromiumInFlight = null;
      });
    LauncherRuntime.ensureChromiumInFlight = task;
    return task;
  };

  private static downloadChromium = async (
    onProgress?: (status: ChromiumRuntimeProgress) => void,
  ): Promise<LauncherRuntimeInfo> => {
    const userDataRoot = LauncherRuntime.getUserDataChromiumRoot();
    const downloadCacheDir = path.join(userDataRoot, "_download-cache");
    mkdirSync(downloadCacheDir, { recursive: true });

    onProgress?.({ code: "chromium-downloading" });
    console.log(`[LauncherRuntime] download cache: ${downloadCacheDir}`);
    try {
      await LauncherRuntime.installPlaywrightChromium(downloadCacheDir);
      console.log("[LauncherRuntime] Playwright download step finished; installing into userData...");

      const versionDirs = readdirSync(downloadCacheDir).filter(
        (name) => name.startsWith("chromium-") && !name.includes("headless_shell"),
      );
      if (versionDirs.length === 0) {
        throw new Error(`playwright install produced no chromium-* folder under ${downloadCacheDir}`);
      }
      const versionDir = path.join(downloadCacheDir, versionDirs.sort().at(-1) as string);
      console.log(`[LauncherRuntime] using Playwright version folder: ${versionDir}`);

      const platformPrefix =
        process.platform === "darwin" ? "chrome-mac" : process.platform === "win32" ? "chrome-win" : "chrome-linux";
      const matching = readdirSync(versionDir).filter((name) => name.startsWith(platformPrefix));
      if (matching.length === 0) {
        throw new Error(`no ${platformPrefix}* folder found under ${versionDir}`);
      }
      // Playwright's actual folder-naming convention differs by OS: mac ships
      // separate per-arch builds ("chrome-mac-arm64" / "chrome-mac-x64"), while
      // win/linux only ever publish one 64-bit build named "chrome-win64" /
      // "chrome-linux64" (no arm64-specific folder, no arch name in the suffix).
      // Falling back to "longest matching name" when the expected name is
      // absent risked silently picking a mismatched-arch build, so this only
      // falls back with an explicit warning rather than trusting sort order.
      const expectedName = process.platform === "darwin" ? `${platformPrefix}-${process.arch}` : `${platformPrefix}64`;
      let chosen: string;
      if (matching.includes(expectedName)) {
        chosen = expectedName;
      } else {
        chosen = matching.sort((a, b) => b.length - a.length)[0] as string;
        console.warn(
          `[LauncherRuntime] expected Chromium folder "${expectedName}" not found under ${versionDir} ` +
            `(found: ${matching.join(", ")}); falling back to "${chosen}" — this may be the wrong architecture.`,
        );
      }

      const destRoot = path.join(userDataRoot, "chromium");
      const destDir = path.join(destRoot, chosen);
      rmSync(destDir, { recursive: true, force: true });
      mkdirSync(destRoot, { recursive: true });
      cpSync(path.join(versionDir, chosen), destDir, { recursive: true });
      rmSync(downloadCacheDir, { recursive: true, force: true });
      console.log(`[LauncherRuntime] Chromium installed to ${destDir}`);

      onProgress?.({ code: "chromium-ready" });
      const resolved = LauncherRuntime.resolve();
      if (resolved.missing.includes("chromium")) {
        throw new Error(
          `Chromium was copied to ${destDir} but still does not resolve (looked for ${resolved.chromiumExecutablePath})`,
        );
      }
      return resolved;
    } catch (error) {
      // A partial browser archive can poison the next startup and consume
      // hundreds of MiB. Playwright can safely start from an empty cache.
      rmSync(downloadCacheDir, { recursive: true, force: true });
      throw error;
    }
  };
}

export { ChromiumRuntimeProgress, LauncherRuntime, LauncherRuntimeInfo };
