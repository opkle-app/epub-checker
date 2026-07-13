import fsPromise from "fs/promises";

// must fixed package => "@daisy/ace-core": "1.3.7"
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
  public static getAxeRunner = async () => {
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
            _browser = await chromium.launch({
              executablePath,
              headless: true,
              timeout: launchTimeoutMs,
              args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
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
        await page.route("**/*", async (route: Dictionary, request: Dictionary) => {
          const requestUrl = request.url();

          if (requestUrl && /^https?:\/\//.test(requestUrl)) {
            return route.abort();
          }

          if (
            request.resourceType() === "document" &&
            requestUrl &&
            /^file:\//.test(requestUrl) &&
            /\.html?$/.test(requestUrl)
          ) {
            try {
              const filePath = new URL(requestUrl).pathname;
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
        let results: any = undefined;
        try {
          results = await page.evaluate(
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
        } catch (err) {
          if (err && err.toString && err.toString().indexOf("protocolTimeout") >= 0) {
            err = new Error(
              `Timeout :( ${cliOption_MILLISECONDS_TIMEOUT_EXTENSION || MILLISECONDS_TIMEOUT_EXTENSION}ms`,
            );
          }
          try {
            await page.close();
          } catch (_e) {}
          throw err;
        }
        await page.close();
        return results;
      },
    };
  };

  public static getReport = async (epubTargetPath: string): Promise<Dictionary> => {
    const axeRunner = await AceByDaisy.getAxeRunner();
    const epubPath: string = epubTargetPath;
    const outdir: string = process.cwd() + "/temp";
    const epub = new EPUB(epubPath);
    await epub.extract();
    await epub.parse();
    const report = await new Report(epub, outdir, "en").init();
    // ace-core 1.4.x 시그니처: check(epub, report, lang, doNotReportMedia, axeRunner)
    // doNotReportMedia=false 로 두면 media 관련 이슈도 포함해 전부 리포트.
    const final: Dictionary = await check(epub, report, "en", false, axeRunner);
    return final;
  };

  public static getAssertions = async (epubTargetPath: string): Promise<Dictionary[]> => {
    const report = await AceByDaisy.getReport(epubTargetPath);
    try {
      await fsPromise.rm(process.cwd() + "/temp/report.json", { recursive: true, force: true });
    } catch {}
    try {
      await fsPromise.rm(process.cwd() + "/temp/report-html-files", { recursive: true, force: true });
    } catch {}
    try {
      await fsPromise.rm(process.cwd() + "/temp/data", { recursive: true, force: true });
    } catch {}
    try {
      await fsPromise.rm(process.cwd() + "/temp/report.html", { recursive: true, force: true });
    } catch {}
    return report._builder._json.assertions as Dictionary[];
  };
}

export { AceByDaisy };
