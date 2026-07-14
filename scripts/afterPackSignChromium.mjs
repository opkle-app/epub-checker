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
//
// `codesign --deep` fails on Chromium's bundle layout with
// "unsealed contents present in the root directory of an embedded framework" —
// a well-known codesign limitation (CEF issue #2739, sparkle-project/Sparkle#1471,
// Qt frameworks forum threads). Signing bottom-up (loose files, then Helper.app,
// then the outer app) fixed the Helpers, but Framework.framework itself still hits
// the same error — something non-symlink sits directly in its root. Logging the
// framework root listing before signing so the next failure shows exactly what.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, access, stat, lstat } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

function depth(p) {
  return p.split(path.sep).length;
}

async function collectSignTargets(root) {
  const looseFiles = [];
  const bundles = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (/\.(app|framework)$/i.test(entry.name)) {
          bundles.push(full);
        }
        await walk(full);
        continue;
      }
      try {
        const st = await stat(full);
        const isExecutable = (st.mode & 0o111) !== 0;
        if (isExecutable || /\.(dylib|so)$/i.test(entry.name)) {
          looseFiles.push(full);
        }
      } catch {
        /* ignore */
      }
    }
  }

  await walk(root);

  // Deepest paths first so nested content is always signed before its container.
  looseFiles.sort((a, b) => depth(b) - depth(a));
  bundles.sort((a, b) => depth(b) - depth(a));
  return { looseFiles, bundles };
}

async function findTopLevelAppBundles(chromiumDir) {
  const { bundles } = await collectSignTargets(chromiumDir);
  const apps = bundles.filter((p) => p.endsWith(".app"));
  // Drop any bundle that lives inside another bundle in the list (e.g. Helper.app
  // nested under Google Chrome for Testing.app) — we only want real top-level roots.
  return apps.filter((candidate) => !apps.some((other) => other !== candidate && candidate.startsWith(other + path.sep)));
}

async function logFrameworkRoot(frameworkPath) {
  try {
    const entries = await readdir(frameworkPath, { withFileTypes: true });
    console.log(`[afterPackSignChromium] ${frameworkPath} root contents:`);
    for (const entry of entries) {
      const full = path.join(frameworkPath, entry.name);
      const info = await lstat(full);
      const kind = info.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "dir" : "file";
      console.log(`  [${kind}] ${entry.name}`);
    }
  } catch (err) {
    console.log(`[afterPackSignChromium] could not list ${frameworkPath}: ${err}`);
  }
}

async function signPath(target, identity, entitlements) {
  console.log(`[afterPackSignChromium]   codesign ${target}`);
  await execFileAsync("codesign", [
    "--force",
    "--options",
    "runtime",
    "--timestamp",
    "--entitlements",
    entitlements,
    "--sign",
    identity,
    target,
  ]);
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

  const appBundles = await findTopLevelAppBundles(chromiumRoot);
  if (appBundles.length === 0) {
    console.warn(`[afterPackSignChromium] no Chromium .app bundle found under ${chromiumRoot}.`);
    return;
  }

  const entitlements = path.resolve("build/entitlements.mac.plist");

  for (const chromiumAppPath of appBundles) {
    console.log(`[afterPackSignChromium] signing ${chromiumAppPath} (bottom-up, no --deep) as "${identity}"`);
    const { looseFiles, bundles } = await collectSignTargets(chromiumAppPath);

    // 1) every loose Mach-O/dylib anywhere inside, deepest first — this is what
    //    --deep misses in non-standard subfolders like Libraries/.
    for (const file of looseFiles) {
      await signPath(file, identity, entitlements);
    }
    // 2) nested bundles (Helper.app, Framework.framework), deepest first.
    for (const bundle of bundles) {
      if (bundle.endsWith(".framework")) {
        await logFrameworkRoot(bundle);
      }
      await signPath(bundle, identity, entitlements);
    }
    // 3) the Chromium.app bundle itself, last, non-deep — everything inside is
    //    already sealed, so this just signs the main executable and reseals
    //    the bundle's own Resources/Info.plist.
    await signPath(chromiumAppPath, identity, entitlements);
  }
}
