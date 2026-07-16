import fsPromise from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { Mother } from "../../mother.js";

// version-sensitive dependency, currently pinned to "^1.4.6" in package.json — verify
// the Ace integration below (getAxeRunner/getReport signatures) still matches before bumping.
// @ts-ignore
import { check } from "@daisy/ace-core/lib/checker/checker.js";
// @ts-ignore
import { EPUB } from "@daisy/epub-utils";
// @ts-ignore
import { Report } from "@daisy/ace-report";

interface Dictionary {
  [key: string]: any;
}

type PlaywrightPage = any;
type PlaywrightElementHandle = any;
type PlaywrightBrowser = any;

class AceByDaisy {
  public static getAxeRunner = async (allowedFileRoot?: string) => {
    // @ts-ignore - Playwright is provided with the bundled local Chromium runtime later.
    const { chromium } = await import("playwright");
    const executablePath: string | undefined = process.env.ACE_CHROMIUM_EXECUTABLE_PATH;
    const MILLISECONDS_TIMEOUT_INITIAL: number = 5000;
    const MILLISECONDS_TIMEOUT_EXTENSION: number = 240000;
    const addScripts = async (paths: string[], page: PlaywrightPage): Promise<void> => {
      for (const path of paths) {
        const scriptElemHandle: PlaywrightElementHandle | null = await page.addScriptTag({ path });
        if (scriptElemHandle) {
          await scriptElemHandle.evaluate((scriptElem: Dictionary) => {
            (scriptElem as Dictionary).setAttribute("data-ace", "");
          });
        }
      }
    };
    const addScriptContents = async (contents: string[], page: PlaywrightPage): Promise<void> => {
      for (const content of contents) {
        const scriptElemHandle: PlaywrightElementHandle | null = await page.addScriptTag({ content });
        if (scriptElemHandle) {
          await scriptElemHandle.evaluate((scriptElem: Dictionary) => {
            (scriptElem as Dictionary).setAttribute("data-ace", "");
          });
        }
      }
    };
    let _browser: PlaywrightBrowser | null;
    let cliOption_MILLISECONDS_TIMEOUT_EXTENSION: number;

    _browser = null;
    cliOption_MILLISECONDS_TIMEOUT_EXTENSION = 0;

    return {
      setTimeout: (ms: string) => {
        try {
          cliOption_MILLISECONDS_TIMEOUT_EXTENSION = parseInt(ms, 10);
        } catch {}
      },
      concurrency: 4,
      launch: async () => {
        // 5초는 macOS의 headless Chromium cold start에 너무 짧음. 30초 기본 + 확장 옵션 반영.
        const launchTimeoutMs =
          cliOption_MILLISECONDS_TIMEOUT_EXTENSION > 0 ? cliOption_MILLISECONDS_TIMEOUT_EXTENSION : 30000;
        let lastError: unknown = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            // Deliberately no "--no-sandbox"/"--disable-setuid-sandbox": this Chromium
            // instance renders EPUB-internal XHTML/CSS/JS, which EPUB3 permits to include
            // arbitrary scripted content and must be treated as untrusted. Disabling
            // Chromium's OS-level sandbox here would remove the one containment layer
            // between a malicious EPUB and the host if a renderer-process bug were hit.
            _browser = await chromium.launch({
              executablePath,
              headless: true,
              timeout: launchTimeoutMs,
              args: ["--disable-gpu"],
            });
            return Promise.resolve();
          } catch (err) {
            lastError = err;
            console.log(`[AceByDaisy] Chromium launch attempt ${attempt}/2 failed: ${(err as Error)?.message ?? err}`);
            if (attempt < 2) {
              // 1회 재시도 전 짧은 대기 — 직전 프로세스 / pipe 정리 시간 확보
              await new Promise((r) => setTimeout(r, 2000));
            }
          }
        }
        throw lastError instanceof Error ? lastError : new Error("Chromium launch failed after retries");
      },
      close: async () => {
        await _browser!.close();
        return Promise.resolve();
      },
      run: async (url: string, scripts: string[], scriptContents: string[]) => {
        const page: PlaywrightPage = await _browser!.newPage();
        try {
          await page.route("**/*", async (route: Dictionary, request: Dictionary) => {
            const requestUrl = request.url();

            if (requestUrl && /^https?:\/\//.test(requestUrl)) {
              return route.abort();
            }

            if (requestUrl && /^file:/i.test(requestUrl) && allowedFileRoot) {
              try {
                const requestedPath = path.resolve(fileURLToPath(requestUrl));
                const relative = path.relative(path.resolve(allowedFileRoot), requestedPath);
                if (relative.startsWith("..") || path.isAbsolute(relative)) {
                  return route.abort();
                }
              } catch {
                return route.abort();
              }
            }

            if (
              request.resourceType() === "document" &&
              requestUrl &&
              /^file:\//.test(requestUrl) &&
              /\.html?$/.test(requestUrl)
            ) {
              try {
                const filePath = fileURLToPath(requestUrl);
                const xhtml = await fsPromise.readFile(filePath, "utf8");
                return route.fulfill({
                  status: 200,
                  contentType: "application/xhtml+xml",
                  body: xhtml,
                });
              } catch (ex) {
                console.log(
                  "REQUEST HTML FAIL: ",
                  ex,
                  requestUrl,
                  " ==> ",
                  JSON.stringify(request.headers(), null, 4),
                  request.resourceType(),
                );
              }
            }
            return route.continue();
          });
          await page.goto(url);
          await addScriptContents(scriptContents, page);
          await addScripts(scripts, page);
          const results: any = await page.evaluate(
            () =>
              new Promise((resolve, reject) => {
                try {
                  // @ts-ignore
                  window.tryAceAxe = () => {
                    // @ts-ignore
                    if (
                      // @ts-ignore
                      !window.daisy ||
                      // @ts-ignore
                      !window.daisy.ace ||
                      // @ts-ignore
                      !window.daisy.ace.run ||
                      // @ts-ignore
                      !window.daisy.ace.createReport ||
                      // @ts-ignore
                      !window.axe
                    ) {
                      // @ts-ignore
                      window.tryAceAxeN++;
                      // @ts-ignore
                      if (window.tryAceAxeN < 15) {
                        // @ts-ignore
                        setTimeout(window.tryAceAxe, 400);
                        return;
                      }
                      // @ts-ignore
                      reject("window.tryAceAxe " + window.tryAceAxeN);
                      return;
                    }
                    // @ts-ignore
                    window.daisy.ace.run((err, res) => {
                      if (err) {
                        reject(err);
                        return;
                      }
                      resolve(res);
                    });
                  };
                  // @ts-ignore
                  window.tryAceAxeN = 0;
                  // @ts-ignore
                  window.tryAceAxe();
                } catch (exc) {
                  reject(exc);
                }
              }),
          );
          return results;
        } catch (err) {
          if (err && err.toString && err.toString().indexOf("protocolTimeout") >= 0) {
            err = new Error(
              `Timeout :( ${cliOption_MILLISECONDS_TIMEOUT_EXTENSION || MILLISECONDS_TIMEOUT_EXTENSION}ms`,
            );
          }
          throw err;
        } finally {
          try {
            await page.close();
          } catch (_e) {}
        }
      },
    };
  };

  public static getReport = async (epubTargetPath: string, outdir: string, unzipDir: string): Promise<Dictionary> => {
    const axeRunner = await AceByDaisy.getAxeRunner(unzipDir);
    const epubPath: string = epubTargetPath;
    const epub = new EPUB(epubPath);
    // Passing an explicit unzipDir (EPUB.extract() accepts one) instead of
    // leaving it undefined — undefined makes @daisy/epub-utils create its own
    // directory via the `tmp` package with unsafeCleanup, which is only
    // removed by tmp's process-exit hook, not per call. That leaked a full
    // extracted (potentially malicious) copy of every inspected EPUB for the
    // entire app lifetime. Passing our own dir here lets us clean it up
    // ourselves right after this call, like the report outdir below.
    await epub.extract(unzipDir);
    await epub.parse();
    const report = await new Report(epub, outdir, "en").init();
    // ace-core 1.4.x 시그니처: check(epub, report, lang, doNotReportMedia, axeRunner)
    // doNotReportMedia=false 로 두면 media 관련 이슈도 포함해 전부 리포트.
    const final: Dictionary = await check(epub, report, "en", false, axeRunner);
    return final;
  };

  public static getAssertions = async (epubTargetPath: string): Promise<Dictionary[]> => {
    // Randomized per-call (was a fixed `process.cwd() + "/temp"`) so concurrent
    // Ace runs can't read/write each other's report files, and a local attacker
    // can't pre-create/symlink a predictable shared path. Cleaned up in
    // `finally` so a throwing getReport() no longer leaks this directory too
    // (the old code only attempted cleanup after getReport() had already
    // returned successfully).
    const runId = randomUUID();
    const outdir = path.join(Mother.tempFolder, "ace", runId, "report");
    const unzipDir = path.join(Mother.tempFolder, "ace", runId, "extracted");
    await fsPromise.mkdir(outdir, { recursive: true });
    await fsPromise.mkdir(unzipDir, { recursive: true });
    try {
      const report = await AceByDaisy.getReport(epubTargetPath, outdir, unzipDir);
      return report._builder._json.assertions as Dictionary[];
    } finally {
      try {
        await fsPromise.rm(path.join(Mother.tempFolder, "ace", runId), { recursive: true, force: true });
      } catch {}
    }
  };
}

export { AceByDaisy };
