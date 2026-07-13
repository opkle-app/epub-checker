import { existsSync } from "fs";
import path from "path";
import process from "process";

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
   * Put the files under process.cwd() + "/launcher".
   * The folder is intentionally gitignored because JRE and Chromium are large binaries.
   *
   * Recommended layout:
   *
   * launcher/
   *   darwin-arm64/
   *     jre/bin/java
   *     epubcheck/epubcheck.jar
   *     chromium/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
   *   darwin-x64/
   *     jre/bin/java
   *     epubcheck/epubcheck.jar
   *     chromium/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
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
    return path.join(process.cwd(), LauncherRuntime.launcherFolderName);
  };

  public static getPlatformKey = (): string => {
    return `${process.platform}-${process.arch}`;
  };

  private static firstExisting = (candidates: string[], fallback: string): string => {
    return candidates.find((candidate) => existsSync(candidate)) ?? fallback;
  };

  public static resolve = (): LauncherRuntimeInfo => {
    const launcherRoot = LauncherRuntime.getLauncherRoot();
    const platformKey = LauncherRuntime.getPlatformKey();
    const platformRoot = path.join(launcherRoot, platformKey);
    const commonRoot = path.join(launcherRoot, "common");

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

    // Playwright has changed Chromium folder names over time
    // (chrome-mac, chrome-mac-x64, chrome-mac-arm64). Keep candidates broad so
    // older launcher folders and freshly downloaded runtimes both work.
    const chromiumExecutablePath = LauncherRuntime.firstExisting(
      [
        // macOS — v1228+ 부터 chrome-mac-x64/chrome-mac-arm64, 구 버전은 chrome-mac
        path.join(
          platformRoot,
          "chromium",
          "chrome-mac-arm64",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        ),
        path.join(platformRoot, "chromium", "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
        path.join(
          platformRoot,
          "chromium",
          "chrome-mac-x64",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        ),
        path.join(platformRoot, "chromium", "chrome-mac-x64", "Chromium.app", "Contents", "MacOS", "Chromium"),
        path.join(
          platformRoot,
          "chromium",
          "chrome-mac",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        ),
        path.join(platformRoot, "chromium", "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        path.join(platformRoot, "chromium", "Chromium.app", "Contents", "MacOS", "Chromium"),
        // Windows
        path.join(platformRoot, "chromium", "chrome-win-x64", "chrome.exe"),
        path.join(platformRoot, "chromium", "chrome-win", "chrome.exe"),
        // Linux
        path.join(platformRoot, "chromium", "chrome-linux-x64", "chrome"),
        path.join(platformRoot, "chromium", "chrome-linux", "chrome"),
        path.join(platformRoot, "chromium", "chromium"),
        // common/ fallback
        path.join(
          commonRoot,
          "chromium",
          "chrome-mac-arm64",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        ),
        path.join(commonRoot, "chromium", "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
        path.join(
          commonRoot,
          "chromium",
          "chrome-mac-x64",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        ),
        path.join(
          commonRoot,
          "chromium",
          "chrome-mac",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        ),
        path.join(commonRoot, "chromium", "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        path.join(commonRoot, "chromium", "chrome-win-x64", "chrome.exe"),
        path.join(commonRoot, "chromium", "chrome-win", "chrome.exe"),
        path.join(commonRoot, "chromium", "chrome-linux-x64", "chrome"),
        path.join(commonRoot, "chromium", "chrome-linux", "chrome"),
      ],
      path.join(platformRoot, "chromium"),
    );

    const playwrightBrowsersPath = LauncherRuntime.firstExisting(
      [
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
}

export { LauncherRuntime, LauncherRuntimeInfo };
