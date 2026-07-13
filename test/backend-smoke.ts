/**
 * EpubChecker 백엔드 스모크 테스트.
 *
 * Electron IPC 없이 Node에서 직접 EpubMaker / LauncherRuntime / EpubWorkspaceManager를 호출해
 * "epub 파일 → 검사 → 구조화된 결과" 흐름이 끝까지 동작하는지 검증.
 *
 * 실행: npx tsx test/backend-smoke.ts
 */
import fsPromise from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import JSZip from "jszip";
import { LauncherRuntime } from "../source/apps/launcherRuntime.js";
import { EpubMaker } from "../source/apps/epubMaker/epubMaker.js";
import { EpubWorkspaceManager } from "../source/apps/epubWorkspace.js";

interface TestCase {
  name: string;
  build: () => Promise<JSZip>;
}

const TEST_DIR = path.join(process.cwd(), "temp", "backend-smoke");
await fsPromise.mkdir(TEST_DIR, { recursive: true });

const buildCleanEpub = async (): Promise<JSZip> => {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="ko">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:550e8400-e29b-41d4-a716-446655440000</dc:identifier>
    <dc:title>테스트 도서</dc:title>
    <dc:language>ko</dc:language>
    <dc:creator>테스터</dc:creator>
    <meta property="dcterms:modified">2026-07-05T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="styles/main.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>`);
  zip.file("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ko">
<head><title>목차</title></head>
<body>
  <nav epub:type="toc"><h1>목차</h1><ol><li><a href="Text/chapter1.xhtml">1장 시작</a></li></ol></nav>
</body>
</html>`);
  zip.file("OEBPS/Text/chapter1.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ko">
<head><title>1장</title><link rel="stylesheet" href="../styles/main.css"/></head>
<body><h1>1장 시작</h1><p>안녕하세요. 이것은 깨끗한 테스트 EPUB입니다.</p></body>
</html>`);
  zip.file("OEBPS/styles/main.css", `body { font-family: serif; line-height: 1.6; }`);
  return zip;
};

const buildBrokenEpub = async (): Promise<JSZip> => {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  // 일부러 META-INF/container.xml 을 비워서 EPUBCheck가 OPF/네비게이션 관련 오류를 잡도록 함
  zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/missing.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>깨진 도서</dc:title>
  </metadata>
  <manifest>
    <item id="ghost" href="Text/missing.xhtml" media-type="application/xhtml+xml"/>
    <item id="bad" href="Text/chapter-bad.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="bad"/>
  </spine>
</package>`);
  zip.file("OEBPS/Text/chapter-bad.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body><p>닫히지 않은 태그입니다</body></html>`);
  return zip;
};

const writeZip = async (zip: JSZip, fileName: string): Promise<string> => {
  const target = path.join(TEST_DIR, fileName);
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  await fsPromise.writeFile(target, buf);
  return target;
};

const fmtError = (e: any): string => {
  const sev = (e.severity ?? "?").toString().padEnd(6);
  const code = String(e.code ?? "-").padEnd(10);
  return `[${ sev }][${ code }] ${ e.fileName }:${ e.line || "-" } :: ${ e.error }`;
};

const cases: TestCase[] = [
  { name: "clean.epub", build: buildCleanEpub },
  { name: "broken.epub", build: buildBrokenEpub },
];

const main = async (): Promise<void> => {
  console.log("===========================================");
  console.log(" EpubChecker 백엔드 스모크 테스트");
  console.log("===========================================");
  console.log("테스트 디렉토리:", TEST_DIR);
  console.log("");

  // 1. 런타임 점검
  console.log("▶ LauncherRuntime.resolve()");
  const runtime = LauncherRuntime.applyToEnvironment();
  console.log("  launcherRoot         :", runtime.launcherRoot);
  console.log("  platformKey          :", runtime.platformKey);
  console.log("  javaCommand          :", runtime.javaCommand, exists(runtime.javaCommand));
  console.log("  epubcheckJarPath     :", runtime.epubcheckJarPath, exists(runtime.epubcheckJarPath));
  console.log("  chromiumExecutable   :", runtime.chromiumExecutablePath, exists(runtime.chromiumExecutablePath));
  console.log("  missing              :", JSON.stringify(runtime.missing));
  console.log("");

  if (runtime.missing.some((n) => n === "java" || n === "epubcheck")) {
    console.log("✘ 필수 런타임 누락. launcher/ 폴더 세팅을 확인하세요.");
    process.exit(1);
  }

  const maker = new EpubMaker({
    includeAce: false,
    javaCommand: runtime.javaCommand,
    epubcheckJarPath: runtime.epubcheckJarPath,
  });

  // 2. 직접 inspectEpub 흐름 (epub:inspect-file 분기)
  console.log("▶ EpubMaker.inspectEpub (각 EPUBs)");
  console.log("");
  for (const c of cases) {
    console.log(`──── ${c.name} ────`);
    const target = await writeZip(await c.build(), c.name);
    console.log(`  size : ${ (await fsPromise.stat(target)).size } bytes`);
    try {
      const result = await maker.inspectEpub(target, { includeAce: false, deleteMode: false });
      console.log(`  status : ${ result.status }`);
      console.log(`  errors : ${ result.errors.length }개`);
      for (const e of result.errors.slice(0, 8)) {
        console.log("   ", fmtError(e));
      }
      if (result.errors.length > 8) {
        console.log(`    ... +${ result.errors.length - 8 }개 더`);
      }
    } catch (err) {
      console.log(`  ✘ 예외:`, (err as Error).message);
    }
    console.log("");
  }

  // 3. 워크스페이스 inspect 흐름 (workspace:open → workspace:inspect → workspace:export)
  console.log("▶ EpubWorkspaceManager 흐름 (open → inspect → export)");
  console.log("");
  const wsCleanPath = await writeZip(await buildCleanEpub(), "clean-ws.epub");
  const mgr = new EpubWorkspaceManager();
  const opened = await mgr.open(wsCleanPath);
  console.log(`  workspaceId : ${ opened.workspaceId }`);
  console.log(`  sourcePath  : ${ opened.sourcePath }`);
  console.log(`  files       : ${ opened.files.length }개`);
  for (const f of opened.files) {
    console.log(`    - [${ f.kind.padEnd(6) }] ${ f.path } (${ f.size } bytes)`);
  }
  console.log("");

  console.log("  --- 편집 시뮬레이션 ---");
  const chapter = opened.files.find((f) => f.path.includes("chapter1.xhtml"));
  if (chapter) {
    const before = await mgr.getFile(opened.workspaceId, chapter.path);
    console.log(`  before (first 60): ${ before.content.slice(0, 60).replace(/\s+/g, " ") }…`);
    const edited = before.content
      .replace("안녕하세요", "반갑습니다")
      .replace("깨끗한", "수정한");
    const updated = await mgr.updateFile(opened.workspaceId, chapter.path, edited);
    const dirtied = updated.files.find((f) => f.path === chapter.path);
    console.log(`  updated dirty    : ${ dirtied?.dirty }`);
    console.log(`  updated path     : ${ dirtied?.path }`);
  }
  console.log("");

  console.log("  --- 워크스페이스 inspect (modify된 EPUB으로 export 후 검사) ---");
  const insp = await mgr.inspect(opened.workspaceId, maker, false);
  console.log(`  exportPath : ${ insp.exportPath }`);
  console.log(`  result.errors : ${ insp.result.errors.length }개`);
  for (const e of insp.result.errors.slice(0, 5)) {
    console.log("   ", fmtError(e));
  }
  console.log("");

  console.log("  --- 직접 export (저장 경로 지정) ---");
  const finalOut = path.join(TEST_DIR, "clean-ws-repaired.epub");
  const exported = await mgr.export(opened.workspaceId, finalOut);
  const outStat = await fsPromise.stat(exported.filePath);
  console.log(`  exported filePath : ${ exported.filePath }`);
  console.log(`  exported size     : ${ outStat.size } bytes`);
  console.log("");

  console.log("===========================================");
  console.log(" 통과 — 백엔드 5단계 흐름 (open → inspect → export → re-inspect → 저장) 모두 동작");
  console.log("===========================================");
};

function exists(p: string): string {
  return existsSync(p) ? "✓" : "✗";
}

main().catch((err) => {
  console.error("✘ 치명적 오류:", err);
  process.exit(1);
});
