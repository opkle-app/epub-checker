#!/usr/bin/env node
/**
 * scripts/setup-launcher.mjs
 *
 * EpubChecker가 사용하는 portable 런타임을 `./launcher/{platform}/`에 배치.
 *
 * 받는 것:
 *   - Eclipse Temurin JRE (LTS, 기본 17) — Adoptium API
 *   - W3C EPUBCheck latest stable jar — GitHub Release API
 *   - Playwright Chromium — `playwright install chromium` 후 캐시에서 복사
 *
 * 한 머신에서 한 번만 실행하면 됨. CI cross-build 시 OS별로 따로 돌리면 됨.
 *
 * 환경변수:
 *   LAUNCHER_PLATFORM=darwin-arm64  설치 타깃 직접 지정 (기본: 현재 OS-CPU)
 *   SKIP_JRE=1        시스템 java 사용 (JRE 다운로드 스킵)
 *   SKIP_CHROMIUM=1   Chromium 다운로드 스킵 (Ace 검사 비활성)
 *   JRE_VERSION=21    다른 LTS 시도 (기본 17)
 *   FORCE=1           launcher/ 안의 기존 바이너리도 강제 교체
 */

import { execFileSync, spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, rmSync, cpSync, readdirSync, chmodSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOST_PLATFORM = process.platform;
const HOST_ARCH = process.arch;
const PLATFORM = process.env.LAUNCHER_PLATFORM ?? `${HOST_PLATFORM}-${HOST_ARCH}`;
const [TARGET_OS, TARGET_ARCH] = parsePlatformKey(PLATFORM);
const ROOT = process.cwd();
const LAUNCHER = path.join(ROOT, "launcher");
const TARGET = path.join(LAUNCHER, PLATFORM);
const TMP = path.join(ROOT, "temp", "launcher-setup", PLATFORM);

const SKIP_JRE = !!process.env.SKIP_JRE;
const SKIP_CHROMIUM = !!process.env.SKIP_CHROMIUM;
const JRE_VERSION = process.env.JRE_VERSION ?? "17";
const FORCE = !!process.env.FORCE;

mkdirSync(TMP, { recursive: true });

const log = (...a) => console.log("[setup-launcher]", ...a);

// ───── 작은 유틸 ────────────────────────────────────────

function parsePlatformKey(platformKey) {
  const [targetOs, targetArch] = platformKey.split("-");
  const supportedOs = new Set(["darwin", "win32", "linux"]);
  const supportedArch = new Set(["x64", "arm64"]);
  if (!supportedOs.has(targetOs) || !supportedArch.has(targetArch)) {
    throw new Error(
      `지원하지 않는 LAUNCHER_PLATFORM=${platformKey}. ` +
        "darwin-x64, darwin-arm64, win32-x64, linux-x64 중 하나를 사용하세요.",
    );
  }
  if (targetOs === "win32" && targetArch !== "x64") {
    throw new Error("Windows 런처는 현재 win32-x64만 지원합니다.");
  }
  if (targetOs === "linux" && targetArch !== "x64") {
    throw new Error("Linux 런처는 현재 linux-x64만 지원합니다.");
  }
  return [targetOs, targetArch];
}

function targetOsName() {
  if (TARGET_OS === "darwin") return "mac";
  if (TARGET_OS === "win32") return "windows";
  return "linux";
}

function targetAdoptiumArch() {
  return TARGET_ARCH === "arm64" ? "aarch64" : "x64";
}

function targetArchiveExt() {
  return TARGET_OS === "win32" ? "zip" : "tar.gz";
}

function javaNameForTarget() {
  return TARGET_OS === "win32" ? "java.exe" : "java";
}

function isTargetHost() {
  return TARGET_OS === HOST_PLATFORM && TARGET_ARCH === HOST_ARCH;
}

function cacheRootForHost() {
  return HOST_PLATFORM === "darwin"
    ? path.join(os.homedir(), "Library", "Caches", "ms-playwright")
    : HOST_PLATFORM === "win32"
      ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "ms-playwright")
      : path.join(os.homedir(), ".cache", "ms-playwright");
}

function chromiumPrefixForTarget() {
  if (TARGET_OS === "darwin") return "chrome-mac";
  if (TARGET_OS === "win32") return "chrome-win";
  return "chrome-linux";
}

function preferredChromiumDirName(dirNames) {
  const archSpecific = `${chromiumPrefixForTarget()}-${TARGET_ARCH}`;
  const exact = dirNames.find((name) => name === archSpecific);
  if (exact) return exact;
  return dirNames.filter((name) => name.startsWith(chromiumPrefixForTarget())).sort((a, b) => b.length - a.length)[0];
}

function firstExisting(candidates) {
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function fetchToFile(url, dest) {
  log("↓", url);
  // GitHub (API 및 release asset redirect 대상 모두)는 User-Agent 없는 요청을
  // 봇으로 간주해 403을 돌려주는 경우가 있음.
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "epub-checker-launcher-setup" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}\n${text.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  log("  →", dest, `(${(buf.length / 1024 / 1024).toFixed(1)} MiB)`);
}

function extractArchive(archivePath, destDir) {
  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  // mac(bsdtar)/modern win(bsdtar)의 `tar`는 libarchive 기반이라 .zip도 풀리지만,
  // 우분투 기본 `tar`는 GNU tar라 .zip을 아예 못 품 → EPUBCheck(.zip)는 unzip으로 처리.
  if (/\.zip$/i.test(archivePath) && HOST_PLATFORM === "linux") {
    const r = spawnSync("unzip", ["-q", "-o", archivePath, "-d", destDir], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`unzip failed: exit ${r.status}`);
    return;
  }
  const r = spawnSync("tar", ["-xf", archivePath, "-C", destDir], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`tar failed: exit ${r.status}`);
}

function findInTree(root, predicate, depth = 0) {
  if (depth > 6) return null;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const p = path.join(root, e.name);
    try {
      if (predicate(p, e)) return p;
    } catch {
      /* ignore */
    }
    if (e.isDirectory()) {
      const r = findInTree(p, predicate, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

// ───── JRE ──────────────────────────────────────────────

async function setupJre() {
  if (SKIP_JRE) {
    log("SKIP_JRE=1 — JRE 다운로드 스킵. 시스템 java 사용.");
    return;
  }

  // 멱등: 이미 java 바이너리가 있으면 FORCE 아니면 스킵
  const destJre = path.join(TARGET, "jre");
  const javaName = javaNameForTarget();
  const expectedJava =
    TARGET_OS === "win32"
      ? path.join(destJre, "bin", "java.exe")
      : (firstExisting([
          path.join(destJre, "bin", javaName),
          path.join(destJre, "Contents", "Home", "bin", javaName),
        ]) ?? path.join(destJre, "bin", javaName));

  if (existsSync(expectedJava) && !FORCE) {
    log(`JRE 이미 설치됨 (${expectedJava}). FORCE=1 이 아니면 skip.`);
    return;
  }

  log(`Adoptium Temurin JRE ${JRE_VERSION} for ${PLATFORM}`);
  const osName = targetOsName();
  const arch = targetAdoptiumArch();
  const ext = targetArchiveExt();
  const url = `https://api.adoptium.net/v3/binary/latest/${JRE_VERSION}/ga/${osName}/${arch}/jre/hotspot/normal/eclipse?project=jdk`;

  const archive = path.join(TMP, `jre-${PLATFORM}.${ext}`);
  await fetchToFile(url, archive);

  const extracted = path.join(TMP, "jre-extracted");
  extractArchive(archive, extracted);

  // Adoptium mac archive: .../jdk-X.Y.Z+7-mac/Contents/Home/bin/java
  // Adoptium linux archive: .../jdk-X.Y.Z+7/bin/java
  // 두 케이스 모두 끝에 "Contents/Home/bin/java" 또는 "bin/java" 가 있는 디렉터리를 찾는다.
  // 그 디렉터리의 "Contents/Home" 또는 그 자체가 JRE 루트.
  const jreRoot = findInTree(extracted, (p) => {
    if (!statSync(p, { throwIfNoEntry: false })?.isDirectory?.()) return false;
    return existsSync(path.join(p, "bin", javaName));
  });
  if (!jreRoot) throw new Error("JRE 안에 java 바이너리를 못 찾았음");

  // mac: jreRoot = .../jdk-X-mac, Contents/Home/bin/java 가 안에 있다.
  // linux: jreRoot = .../jdk-X-linux-x64, bin/java 가 바로 안에 있다.
  // 최종: launcher/{platform}/jre/ 아래에 bin/, lib/, conf/ 가 (linux),
  //       또는 launcher/{platform}/jre/Contents/Home/bin/java 가 (mac) 만들어지면 됨.

  // 가장 단순: 'JRE 루트'를 launcher/{platform}/jre/Contents/Home/ 또는 jre/ 자체로 매핑.
  let sourceForJre;
  const macContentsHome = path.join(jreRoot, "Contents", "Home");
  if (existsSync(macContentsHome)) {
    // mac archive: jreRoot 가 Contents/Home 의 부모 (jdk-X-mac).
    // launcher/darwin-x64/jre/Contents/Home/bin/java 가 되도록 jreRoot/Contents 를
    // launcher/darwin-x64/jre/Contents 에 복사.
    sourceForJre = path.join(jreRoot, "Contents");
  } else {
    // linux/win archive: jreRoot 자체가 JRE 내용물.
    // launcher/{platform}/jre/ 안에 bin/, lib/, conf/ 직접 풀기.
    sourceForJre = jreRoot;
  }

  if (existsSync(destJre)) {
    rmSync(destJre, { recursive: true, force: true });
  }
  mkdirSync(destJre, { recursive: true });
  // copySync로 destJre 안의 bin/lib/... 채우기
  cpSync(sourceForJre, destJre, { recursive: true });

  // exec bit 보장
  const javaExe =
    firstExisting([path.join(destJre, "bin", javaName), path.join(destJre, "Contents", "Home", "bin", javaName)]) ??
    path.join(destJre, "bin", javaName);
  try {
    chmodSync(javaExe, 0o755);
  } catch {
    /* ignore */
  }
  log("  설치됨:", javaExe);
}

// ───── epubcheck ────────────────────────────────────────

async function setupEpubCheck() {
  // 멱등: jar 가 이미 있으면 FORCE 아니면 스킵
  const destEpubCheckJar = path.join(TARGET, "epubcheck", "epubcheck.jar");
  if (existsSync(destEpubCheckJar) && !FORCE) {
    log(`EPUBCheck jar 이미 설치됨 (${destEpubCheckJar}). FORCE=1 이 아니면 skip.`);
    return;
  }

  log("W3C EPUBCheck latest stable jar 받기");
  // 인증 없이 호출하면 시간당 60회 제한이라 CI 러너 공유 IP에서 쉽게 403(rate limit)이 남.
  // GITHUB_TOKEN/GH_TOKEN이 있으면 실어서 시간당 5000회 한도로 호출.
  const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const apiRes = await fetch("https://api.github.com/repos/w3c/epubcheck/releases/latest", {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "epub-checker-launcher-setup",
      ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {}),
    },
  });
  if (!apiRes.ok) throw new Error(`GitHub API HTTP ${apiRes.status}`);
  const release = await apiRes.json();
  if (release.prerelease) log("  경고: 최신 릴리스가 prerelease 표시됨 (그래도 진행)");

  const zipAsset = (release.assets ?? []).find(
    (a) => /\.zip$/i.test(a.name) && !/SNAPSHOT/i.test(a.name) && !/-sources/i.test(a.name),
  );
  if (!zipAsset) throw new Error(`epubcheck 릴리스에서 zip asset 못 찾음 (${release.tag_name})`);
  log("  release:", release.tag_name, "·", zipAsset.name);

  const archive = path.join(TMP, `epubcheck-${PLATFORM}.zip`);
  await fetchToFile(zipAsset.browser_download_url, archive);

  const extracted = path.join(TMP, "epubcheck-extracted");
  extractArchive(archive, extracted);

  // 메인 jar 찾기 (epubcheck-*.jar, sources/javadoc 제외)
  const mainJar = findInTree(extracted, (p) => {
    if (!p.endsWith(".jar")) return false;
    const n = path.basename(p);
    if (/sources/i.test(n) || /javadoc/i.test(n)) return false;
    // 최근 릴리스는 단일 fat jar (epubcheck-X.Y.Z.jar). 만약 그것이 없으면
    // lib/ 안의 모든 jar 를 모은다.
    return /^epubcheck-?\d/i.test(n) || n === "epubcheck.jar";
  });
  if (!mainJar) throw new Error("epubcheck 메인 jar 못 찾음");

  // lib/ 디렉터리도 같이 (있으면)
  const libDir = findInTree(extracted, (p, e) => e.isDirectory() && e.name === "lib" && p.endsWith("/lib"));

  const destDir = path.join(TARGET, "epubcheck");
  if (existsSync(destDir) && FORCE) {
    rmSync(destDir, { recursive: true, force: true });
  }
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

  // 메인 jar 복사 → epubcheck.jar 로 통일
  cpSync(mainJar, path.join(destDir, "epubcheck.jar"));
  if (libDir) {
    cpSync(libDir, path.join(destDir, "lib"), { recursive: true });
    // 중복 제거 (메인 jar 가 lib 안에 들어있다면)
    const libMainDup = path.join(destDir, "lib", "epubcheck.jar");
    if (existsSync(libMainDup)) rmSync(libMainDup);
  }
  log("  설치됨:", path.join(destDir, "epubcheck.jar"));
}

// ───── Chromium ─────────────────────────────────────────

async function setupChromium() {
  if (SKIP_CHROMIUM) {
    log("SKIP_CHROMIUM=1 — Chromium 스킵 (Ace 검사 비활성).");
    return;
  }

  if (!isTargetHost()) {
    // Playwright does not provide a simple supported way to download Chromium
    // for an arbitrary foreign OS from this script. Keep cross-platform setup
    // honest: Java and EPUBCheck can be prepared ahead of time, but Chromium
    // should be copied from a matching host install.
    throw new Error(
      `Chromium은 Playwright가 현재 실행 OS용으로만 내려받습니다. ` +
        `${PLATFORM} 런처의 Chromium은 해당 머신에서 npm run launcher:setup을 실행하세요. ` +
        `다른 OS에서 JRE/EPUBCheck만 준비하려면 SKIP_CHROMIUM=1을 사용하세요.`,
    );
  }

  // 캐시 디렉터리 위치 (있으면 멱등 skip)
  const cacheRoot = cacheRootForHost();

  // Playwright 가 이미 받아둔 것 중 우리 호환 디렉터리가 있는지 먼저 확인.
  // v1228+ 부터 "chrome-mac-x64" 같이 arch suffix 가 붙음 (옛날은 "chrome-mac").
  let existingChromiumRoot = null;
  if (existsSync(cacheRoot)) {
    const chromiumDirs = readdirSync(cacheRoot)
      .filter((d) => d.startsWith("chromium-") && !d.includes("headless_shell"))
      .sort();
    for (const d of chromiumDirs) {
      const root = path.join(cacheRoot, d);
      const candidates = readdirSync(root).filter((x) => x.startsWith("chrome-"));
      if (candidates.length > 0) {
        existingChromiumRoot = root;
        break;
      }
    }
  }

  if (!existsSync(cacheRoot) || !existingChromiumRoot) {
    log("Playwright Chromium");
    // 캐시에 없으면 내려받기
    const r = spawnSync("npx", ["--yes", "playwright", "install", "chromium"], {
      stdio: "inherit",
    });
    if (r.status !== 0) throw new Error(`playwright install failed: exit ${r.status}`);
  } else {
    log("Playwright Chromium (이미 캐시에 있음)");
  }

  // 캐시에서 최신 chromium 디렉터리 선택
  const chromiumDirs = readdirSync(cacheRoot)
    .filter((d) => d.startsWith("chromium-") && !d.includes("headless_shell"))
    .sort();
  const chromiumRoot = path.join(cacheRoot, chromiumDirs.at(-1));

  // 플랫폼 prefix (오래된 chrome-mac / 새 chrome-mac-x64 모두 잡기)
  const platformPrefix = chromiumPrefixForTarget();

  const matchingDirs = readdirSync(chromiumRoot).filter((d) => d.startsWith(platformPrefix));
  if (matchingDirs.length === 0) {
    throw new Error(`${chromiumRoot} 안에 ${platformPrefix}* 디렉터리 없음. Playwright 버전이 다른 구조일 수 있음.`);
  }
  // 더 구체적인 이름 우선 (chrome-mac-x64 > chrome-mac)
  const chromeDirName = preferredChromiumDirName(matchingDirs);

  const srcDir = path.join(chromiumRoot, chromeDirName);

  // macOS: .app 번들 안의 실행파일. Playwright 가 "Google Chrome for Testing.app" 으로 받음.
  //       LauncherRuntime 도 이 이름으로 firstExisting 함.
  let execPath;
  if (TARGET_OS === "darwin") {
    const innerEntries = readdirSync(srcDir);
    const appBundle = innerEntries.find((d) => d.endsWith(".app"));
    if (!appBundle) {
      throw new Error(`${srcDir} 안에 .app 번들 없음 (${innerEntries.join(", ")})`);
    }
    // "Google Chrome for Testing.app" → "Google Chrome for Testing"
    const binaryName = appBundle.replace(/\.app$/, "");
    execPath = path.join(srcDir, appBundle, "Contents", "MacOS", binaryName);
    if (!existsSync(execPath)) {
      // 옛날 fallback: "Chromium.app" → "Chromium"
      const alt = path.join(srcDir, appBundle, "Contents", "MacOS", "Chromium");
      if (existsSync(alt)) {
        execPath = alt;
      } else {
        throw new Error(`Chromium 실행파일 ${execPath} 없음`);
      }
    }
  } else {
    const exeName = TARGET_OS === "win32" ? "chrome.exe" : "chrome";
    execPath = path.join(srcDir, exeName);
    if (!existsSync(execPath)) {
      throw new Error(`Chromium 실행파일 ${execPath} 없음`);
    }
  }

  const destDir = path.join(TARGET, "chromium", chromeDirName);
  const destExecPath = path.join(destDir, path.relative(srcDir, execPath));

  // 멱등: 같은 디렉터리가 이미 채워져 있고 FORCE 가 아니면 스킵
  if (existsSync(destExecPath) && !FORCE) {
    log(`Chromium 이미 설치됨 (${destDir}). FORCE=1 이 아니면 skip.`);
    return;
  }

  if (existsSync(destDir)) {
    rmSync(destDir, { recursive: true, force: true });
  }
  if (!existsSync(path.dirname(destDir))) mkdirSync(path.dirname(destDir), { recursive: true });

  cpSync(srcDir, destDir, { recursive: true });

  try {
    chmodSync(destExecPath, 0o755);
  } catch {
    /* ignore */
  }
  log("  설치됨:", destExecPath);
}

// ───── entry ────────────────────────────────────────────

async function main() {
  log("host     =", `${HOST_PLATFORM}-${HOST_ARCH}`);
  log("platform =", PLATFORM);
  log("target   =", TARGET);
  log("");

  if (!existsSync(TARGET)) mkdirSync(TARGET, { recursive: true });

  await setupJre();
  await setupEpubCheck();
  await setupChromium();

  log("");
  log("완료. 검증 명령:");
  const javaName = javaNameForTarget();
  log(`  ${path.join(TARGET, "jre", "bin", javaName)} -version`);
  if (!SKIP_CHROMIUM) {
    const chromiumGlobHint =
      TARGET_OS === "darwin"
        ? path.join(TARGET, "chromium", "chrome-mac*", "*.app", "Contents", "MacOS", "*")
        : TARGET_OS === "win32"
          ? path.join(TARGET, "chromium", "chrome-win*", "chrome.exe")
          : path.join(TARGET, "chromium", "chrome-linux*", "chrome");
    log(`  ${chromiumGlobHint} --version`);
  }
  log(`  npx tsx test/backend-smoke.ts`);
}

main().catch((err) => {
  console.error("[setup-launcher] 치명적 오류:", err?.message ?? err);
  process.exit(1);
});
