// electron-builder "afterPack" hook.
//
// launcher/{platform}/jre is signed by Eclipse Foundation with a valid Developer ID
// and a secure timestamp already (verified via `codesign -dv --verbose=4`) — leave it alone.
//
// launcher/{platform}/chromium (Playwright's "Chrome for Testing") ships adhoc-signed
// only (`flags=adhoc,linker-signed`, no TeamIdentifier). Apple notarization rejects
// adhoc signatures on nested executables, so it must be re-signed with our own
// Developer ID before electron-builder signs/notarizes the outer app. This is safe
// here because AceByDaisy already launches Chromium with --no-sandbox
// (source/apps/epubMaker/module/aceByDaisy.ts), so we don't depend on Chromium's own
// baked-in sandbox entitlements surviving the re-sign.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, access } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

async function findAppBundles(root) {
  const found = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    if (entry.name.endsWith(".app")) {
      found.push(full);
      continue;
    }
    found.push(...(await findAppBundles(full)));
  }
  return found;
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const identity = process.env.CSC_NAME;
  if (!identity) {
    console.warn(
      '[afterPackSignChromium] CSC_NAME not set - skipping re-sign of the bundled Chromium runtime. ' +
        "Fine for local unsigned dev packaging, but a real release build will fail notarization " +
        "because launcher/*/chromium ships adhoc-signed only. Set CSC_NAME to the same identity " +
        "used for CSC_LINK (e.g. \"Developer ID Application: Opkle (TEAMID)\"), already present in " +
        "an unlocked keychain on the build machine.",
    );
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const chromiumRoot = path.join(context.appOutDir, appName, "Contents", "Resources", "launcher");
  try {
    await access(chromiumRoot);
  } catch {
    console.warn(`[afterPackSignChromium] ${chromiumRoot} not found - nothing to sign.`);
    return;
  }

  const bundles = (await findAppBundles(chromiumRoot)).filter((p) => p.includes(`${path.sep}chromium${path.sep}`));
  if (bundles.length === 0) {
    console.warn(`[afterPackSignChromium] no Chromium .app bundle found under ${chromiumRoot}.`);
    return;
  }

  const entitlements = path.resolve("build/entitlements.mac.plist");
  for (const bundlePath of bundles) {
    console.log(`[afterPackSignChromium] re-signing ${bundlePath} as "${identity}"`);
    await execFileAsync("codesign", [
      "--deep",
      "--force",
      "--options",
      "runtime",
      "--timestamp",
      "--entitlements",
      entitlements,
      "--sign",
      identity,
      bundlePath,
    ]);
  }
}
