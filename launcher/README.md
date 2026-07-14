# Launcher Runtime Binaries

`launcher/` contains portable runtime binaries used to validate EPUB files locally.

- JRE: runs W3C EPUBCheck.
- EPUBCheck: validates EPUB structure and packaging.
- Chromium: used by Ace by DAISY through Playwright.

The folder is intentionally gitignored because these files are large and platform-specific. Only this README should be committed.

## Automatic Setup

Install runtime files for the current machine:

```bash
npm run launcher:setup
```

Force reinstall:

```bash
npm run launcher:setup:rebuild
```

Explicit platform targets:

```bash
npm run launcher:setup:mac:x64
npm run launcher:setup:mac:arm64
npm run launcher:setup:win:x64
```

The setup script writes into:

```text
launcher/{platform}/
```

Examples:

```text
launcher/darwin-x64/
launcher/darwin-arm64/
launcher/win32-x64/
```

## What The Script Downloads

| Runtime | Source | Destination |
|---|---|---|
| Eclipse Temurin JRE 17 | Adoptium API | `launcher/{platform}/jre/` |
| W3C EPUBCheck latest stable | GitHub releases | `launcher/{platform}/epubcheck/epubcheck.jar` |
| Playwright Chromium | `playwright install chromium` | `launcher/{platform}/chromium/` |

Environment flags:

```bash
SKIP_JRE=1 npm run launcher:setup
SKIP_CHROMIUM=1 npm run launcher:setup
JRE_VERSION=21 npm run launcher:setup
```

`FORCE=1` is wrapped by `npm run launcher:setup:rebuild`.

## Platform Note

Playwright downloads Chromium for the OS that is currently running the setup script. That means Windows Chromium should be prepared on Windows, and Apple Silicon Chromium should be prepared on Apple Silicon.

If you are preparing Java and EPUBCheck for another platform from your current machine, skip Chromium:

```bash
SKIP_CHROMIUM=1 npm run launcher:setup:mac:arm64
```

Then run the normal setup command again on the target OS to install Chromium.

## Expected Layout

```text
launcher/
  darwin-arm64/
    jre/bin/java
    epubcheck/
      epubcheck.jar
      lib/
    chromium/
      chrome-mac-arm64/
        Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing

  darwin-x64/
    jre/bin/java
    epubcheck/
      epubcheck.jar
      lib/
    chromium/
      chrome-mac-x64/
        Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing

  win32-x64/
    jre/bin/java.exe
    epubcheck/
      epubcheck.jar
      lib/
    chromium/
      chrome-win/
        chrome.exe

  linux-x64/
    jre/bin/java
    epubcheck/
      epubcheck.jar
      lib/
    chromium/
      chrome-linux/
        chrome
```

`LauncherRuntime.resolve()` also accepts older macOS Chromium names such as `chrome-mac` and older Java layouts such as `jre/Contents/Home/bin/java`.

## Manual Setup

Use this only in offline or restricted environments.

1. Download a Temurin JRE from Adoptium.
2. Place its contents under `launcher/{platform}/jre/`.
3. Download a stable EPUBCheck release zip from `w3c/epubcheck`.
4. Copy the main jar to `launcher/{platform}/epubcheck/epubcheck.jar`.
5. Copy EPUBCheck `lib/` dependencies when present.
6. Run `npx playwright install chromium`.
7. Copy the matching `chrome-*` folder from the Playwright cache into `launcher/{platform}/chromium/`.

Default Playwright cache locations:

- macOS: `~/Library/Caches/ms-playwright/`
- Windows: `%LOCALAPPDATA%\ms-playwright\`
- Linux: `~/.cache/ms-playwright/`

## Verification

Examples:

```bash
launcher/darwin-x64/jre/bin/java -version
java -jar launcher/darwin-x64/epubcheck/epubcheck.jar --version
launcher/darwin-x64/chromium/chrome-mac-x64/Google\ Chrome\ for\ Testing.app/Contents/MacOS/Google\ Chrome\ for\ Testing --version
```

For the app build:

```bash
npm run check
```

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| `Missing local runtime: java` | JRE missing or wrong layout | Confirm `jre/bin/java` or `jre/Contents/Home/bin/java` exists |
| `Missing local runtime: epubcheck` | EPUBCheck jar missing | Confirm `epubcheck/epubcheck.jar` exists |
| `Missing local runtime: chromium` | Chromium missing | On mac, wait for the background download into userData to finish, or check network access; on other platforms, run setup on the target OS, or inspect with Ace disabled |
| `ClassNotFoundException` from EPUBCheck | `lib/` dependencies missing | Copy the full EPUBCheck `lib/` folder |
| macOS quarantine warning | Downloaded unsigned binary | Remove quarantine with `xattr -dr com.apple.quarantine launcher/darwin-*` |

## Packaging Note

For an end-user release, bundle the appropriate runtime files with Electron using `electron-builder` resources such as `extraResources` or `asarUnpack`. During development, this setup script keeps large platform binaries out of git while still making validation reproducible.

**mac is the exception**: Chromium is never bundled into the mac app. Apple's notarization
scan rejects Playwright's "Chrome for Testing" bundle as shipped — `Versions/<ver>/Libraries`
and `Versions/<ver>/Helpers` aren't recognized framework subdirectories, and re-signing them
still fails with `codesign: unsealed contents present in the root directory of an embedded
framework`. Instead, `LauncherRuntime.ensureChromium()` (`source/apps/launcherRuntime.ts`)
downloads Chromium into `app.getPath('userData')` outside the signed `.app` entirely, in the
background at startup and on demand before the first Ace check. The bundled JRE is unaffected
— it's validly signed by Eclipse Foundation already (`codesign -dv --verbose=4` confirms a
Developer ID signature with a secure timestamp) and ships inside the app as before. Windows
and Linux builds are unaffected too and continue to bundle Chromium via `extraResources`.
