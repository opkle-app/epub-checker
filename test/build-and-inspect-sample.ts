/**
 * temp/sampleEpub-dirty/ 를 .epub 으로 묶어서 EpubMaker 로 검사 → 어떤 룰이 잡혔는지 출력.
 *
 *   npx tsx test/build-and-inspect-sample.ts
 *
 * 빌드 산출물: temp/sampleEpub-dirty.epub (EPUB 3.0 + OPF + 8 chapters + 의도적 오류 9개 심김)
 */
import path from "node:path";
import { LauncherRuntime } from "../source/apps/launcherRuntime.js";
import { EpubMaker } from "../source/apps/epubMaker/epubMaker.js";
import { Mother } from "../source/apps/mother.js";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "temp", "sampleEpub-dirty");
const OUT = path.join(ROOT, "temp", "sampleEpub-dirty.epub");

console.log("===========================================");
console.log(" sampleEpub-dirty → .epub 빌드 + 검사");
console.log("===========================================");
console.log(`source : ${SRC}`);
console.log(`output : ${OUT}`);
console.log("");

console.log("▶ Mother.zipFile() (EPUB 모드 — mimetype 무압축)");
const buf = await Mother.zipFile(SRC, OUT, true);
console.log(`  size : ${(buf.length / 1024).toFixed(1)} KiB`);
console.log("");

console.log("▶ LauncherRuntime");
const runtime = LauncherRuntime.applyToEnvironment();
if (runtime.missing.length > 0) {
  console.log("✘ 런타임 누락:", runtime.missing.join(", "));
  process.exit(1);
}
console.log("  javaCommand        :", runtime.javaCommand);
console.log("  epubcheckJarPath   :", runtime.epubcheckJarPath);
console.log("  chromiumExecutable :", runtime.chromiumExecutablePath);
console.log("");

console.log("▶ EpubMaker.inspectEpub (includeAce: true)");
const maker = new EpubMaker({
  includeAce: true,
  javaCommand: runtime.javaCommand,
  epubcheckJarPath: runtime.epubcheckJarPath,
});

const result = await maker.inspectEpub(OUT, { includeAce: true, deleteMode: false });

console.log(`status : ${result.status}`);
console.log(`errors : ${result.errors.length}개`);
console.log("");

const grouped: Record<string, typeof result.errors> = {};
for (const e of result.errors) {
  const k = `${e.source}::${e.code ?? "?"}`;
  (grouped[k] ||= []).push(e);
}

if (Object.keys(grouped).length === 0) {
  console.log("(오류 없음 — 의도한 오류가 잡히지 않았을 가능성)");
}

for (const [k, list] of Object.entries(grouped).sort()) {
  console.log(`── ${k} (${list.length}개) ──`);
  for (const e of list.slice(0, 4)) {
    const where = `${e.fileName}:${e.line || "-"}`;
    console.log(`  [${e.severity}] ${where}`);
    console.log(`    ${e.error}`);
  }
  if (list.length > 4) console.log(`  ... +${list.length - 4}개 더`);
  console.log("");
}

console.log("===========================================");
console.log(` 총 ${result.errors.length}개 오류 검출`);
console.log("===========================================");
