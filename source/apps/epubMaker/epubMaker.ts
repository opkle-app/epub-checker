import fsPromise from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { Mother, Unique } from "../mother.js";
import { resolveAceRuleKo } from "./module/aceRuleKo.js";
import { resolveEpubCheckKo } from "./module/epubCheckMessageKo.js";
import type { EpubInspectError, EpubInspectResult, EpubInspectSeverity } from "../classStorage/epubType.js";

interface Dictionary {
  [key: string]: any;
}

interface EpubMakerOptions {
  tempDir?: string;
  includeAce?: boolean;
  epubcheckCommand?: string;
  javaCommand?: string;
  epubcheckJarPath?: string;
}

interface EpubInspectOptions {
  deleteMode?: boolean;
  includeAce?: boolean;
}

interface EpubCheckRunConfig {
  command: string;
  args: string[];
}

class EpubMaker {
  public tempDir: string;
  public includeAce: boolean;
  public epubcheckCommand: string;
  public javaCommand: string;
  public epubcheckJarPath: string;

  constructor(options: EpubMakerOptions = {}) {
    this.tempDir = options.tempDir ?? path.join(Mother.tempFolder, "epubcheck");
    this.includeAce = options.includeAce ?? true;
    this.epubcheckCommand = options.epubcheckCommand ?? process.env.EPUBCHECK_BIN ?? "epubcheck";
    this.javaCommand = options.javaCommand ?? process.env.JAVA_BIN ?? "java";
    this.epubcheckJarPath = options.epubcheckJarPath ?? process.env.EPUBCHECK_JAR ?? "/usr/share/java/epubcheck.jar";
  }

  public inspectEpub = async (
    targetEpubFilePath: string,
    optionsOrDeleteMode: EpubInspectOptions | boolean = {},
  ): Promise<EpubInspectResult> => {
    const options: EpubInspectOptions =
      typeof optionsOrDeleteMode === "boolean" ? { deleteMode: optionsOrDeleteMode } : optionsOrDeleteMode;
    const deleteMode: boolean = options.deleteMode ?? false;
    const includeAce: boolean = options.includeAce ?? this.includeAce;
    const jsonOutPath: string = path.join(this.tempDir, "epubcheck_" + this.uniqueValue() + ".json");

    await fsPromise.mkdir(this.tempDir, { recursive: true });

    try {
      const stdout: string = await this.runEpubCheck(targetEpubFilePath, jsonOutPath);
      const epubcheckErrors: EpubInspectError[] = await this.readEpubCheckErrors(jsonOutPath, stdout);
      const aceErrors: EpubInspectError[] = includeAce ? await this.secondInspect(targetEpubFilePath) : [];
      const allErrors: EpubInspectError[] = epubcheckErrors.concat(aceErrors);

      console.log(
        `[epubMaker] inspect 완료 - epubcheck 항목=${epubcheckErrors.length} ace=${aceErrors.length} 합계=${allErrors.length}`,
      );
      return {
        status: allErrors.some((item) => item.severity === "fatal" || item.severity === "error") ? "error" : "success",
        errors: allErrors,
        logs: stdout === "" ? [] : stdout.split(/\r?\n/),
      };
    } catch (e) {
      console.log(e);
      throw new Error((e as Error).message);
    } finally {
      try {
        await fsPromise.rm(jsonOutPath, { force: true });
      } catch {}
      // Moved here (from the end of the try block) so a throwing epubcheck/Ace
      // run still cleans up deleteMode's target instead of leaking it — the
      // previous placement only ran on the success path.
      if (deleteMode) {
        try {
          await this.cleanupTarget(targetEpubFilePath);
        } catch {}
      }
    }
  };

  private uniqueValue = (): string => {
    return Unique.hex();
  };

  private resolveEpubCheckRunConfig = (targetPath: string, jsonPath: string): EpubCheckRunConfig => {
    const preferEpubcheckBinary: boolean = process.env.EPUBCHECK_BIN !== undefined;
    if (preferEpubcheckBinary) {
      return {
        command: this.epubcheckCommand,
        args: [targetPath, "--json", jsonPath],
      };
    }

    return {
      command: this.javaCommand,
      args: ["-Duser.language=en", "-Duser.country=US", "-jar", this.epubcheckJarPath, targetPath, "--json", jsonPath],
    };
  };

  private runEpubCheck = (targetPath: string, jsonPath: string): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      const env = {
        ...process.env,
        LC_MESSAGES: "en_US.UTF-8",
        LANG: "en_US.UTF-8",
      };
      const config: EpubCheckRunConfig = this.resolveEpubCheckRunConfig(targetPath, jsonPath);
      const program = spawn(config.command, config.args, { env });
      let out: string = "";

      program.stdout.on("data", (data) => {
        out += String(data);
      });
      program.stderr.on("data", (data) => {
        out += String(data);
      });
      program.on("close", () => {
        resolve(out.trim());
      });
      program.on("error", (error) => {
        reject(new Error(`epubcheck 실행 실패: ${error.message}`));
      });
    });
  };

  private readEpubCheckErrors = async (jsonOutPath: string, stdout: string): Promise<EpubInspectError[]> => {
    try {
      const jsonRaw: string = await fsPromise.readFile(jsonOutPath, "utf8");
      return this.parseEpubCheckJson(jsonRaw);
    } catch (e) {
      console.log("[epubMaker] epubcheck JSON 읽기/파싱 실패 - 텍스트 폴백:", (e as Error)?.message ?? e);
      return this.parseEpubCheckStdout(stdout);
    }
  };

  private cleanupTarget = async (targetEpubFilePath: string): Promise<void> => {
    const normalized: string = path.normalize(targetEpubFilePath.trim());
    const parentDir: string = path.dirname(normalized);
    const parentName: string = path.basename(parentDir);
    const shouldRemoveParent: boolean = /^epubcheck[A-Z0-9]+$/i.test(parentName) && /\.(epub|EPUB)$/.test(normalized);
    const removePath: string = shouldRemoveParent ? parentDir : normalized;
    await fsPromise.rm(removePath, { recursive: true, force: true });
  };

  private normalizeReportedPath = (filePath: string): string => {
    const withoutFragment = String(filePath ?? "")
      .trim()
      .replace(/[?#].*$/, "");
    let pathname = withoutFragment;
    try {
      const parsed = new URL(withoutFragment);
      pathname = parsed.protocol === "file:" ? parsed.pathname : withoutFragment;
    } catch {}
    try {
      pathname = decodeURIComponent(pathname);
    } catch {}
    return pathname.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
  };

  /**
   * EPUB 내부 파일 경로 -> 사람이 읽는 한글 라벨.
   *   OEBPS/Text/chapter3.xhtml -> "3장 본문", content.opf -> "설정 파일(OPF)" 등.
   */
  private buildKoreanFileLabel = (filePath: string): string => {
    const base: string =
      this.normalizeReportedPath(filePath)
        .split("/")
        .map((s) => s.trim())
        .filter((s) => s !== "")
        .at(-1) ?? "";
    if (base === "") {
      return "설정 파일";
    }
    const lower: string = base.toLowerCase();
    const chapMatch = lower.match(/chapter\s*([0-9]+)\.(x?html)$/);
    if (chapMatch) {
      return `${chapMatch[1]}장 본문`;
    }
    if (/^author\./.test(lower)) {
      return "작가 소개";
    }
    if (/^context\./.test(lower)) {
      return "목차 페이지";
    }
    if (/^info\./.test(lower)) {
      return "서지 정보";
    }
    if (/^cover\./.test(lower)) {
      return "표지";
    }
    if (/^back(spacer)?\./.test(lower)) {
      return "뒷표지/여백";
    }
    if (/^spacer\./.test(lower)) {
      return "여백 페이지";
    }
    if (/^nav\./.test(lower)) {
      return "네비게이션";
    }
    if (/\.opf$/.test(lower)) {
      return "설정 파일(OPF)";
    }
    if (/\.ncx$/.test(lower)) {
      return "목차(NCX)";
    }
    if (/\.css$/.test(lower)) {
      return `스타일(${base})`;
    }
    return "설정 파일";
  };

  private buildEpubCheckError = (
    severity: EpubInspectSeverity,
    code: string,
    rawMessage: string,
    suggestion: string,
    filePath: string,
    lineNumber: number,
    column: number,
    extraCount: number,
  ): EpubInspectError => {
    const fileLabel: string = this.buildKoreanFileLabel(filePath);
    const validLine: number = Number.isFinite(lineNumber) && lineNumber > 0 ? lineNumber : -1;
    const validCol: number = Number.isFinite(column) && column > 0 ? column : -1;
    const lineLabel: string = validLine > 0 ? `${validLine}번째 줄` : "";
    const resolved = resolveEpubCheckKo(code, rawMessage);
    let errorText: string = resolved.error;
    if (!resolved.matched && suggestion.trim() !== "") {
      errorText += ` (제안: ${suggestion.trim()})`;
    }
    if (extraCount > 0) {
      errorText += ` (그 외 ${extraCount}개 위치에서 동일 오류)`;
    }
    if (code.trim() !== "") {
      errorText += ` [${code.trim()}]`;
    }
    return {
      fileName: fileLabel,
      line: lineLabel,
      error: errorText,
      severity,
      code: code.trim(),
      lineNumber: validLine,
      column: validCol,
      rawMessage: rawMessage.trim(),
      suggestion: suggestion.trim(),
      additionalLocations: Math.max(0, extraCount),
      filePath: String(filePath ?? "").trim(),
      source: "epubcheck",
    };
  };

  public parseEpubCheckJson = (jsonRaw: string): EpubInspectError[] => {
    const result: EpubInspectError[] = [];
    const parsed: Dictionary = JSON.parse(jsonRaw) as Dictionary;
    const messages: Dictionary[] = Array.isArray(parsed?.messages) ? parsed.messages : [];
    const wanted: Set<string> = new Set(["FATAL", "ERROR", "WARNING", "USAGE", "INFO"]);
    for (const msg of messages) {
      try {
        const sevRaw: string = String(msg?.severity ?? "")
          .toUpperCase()
          .trim();
        if (!wanted.has(sevRaw)) {
          continue;
        }
        const severity: EpubInspectSeverity = sevRaw.toLowerCase() as EpubInspectSeverity;
        const code: string = String(msg?.ID ?? "").trim();
        const rawMessage: string = String(msg?.message ?? "").trim();
        const suggestion: string = typeof msg?.suggestion === "string" ? msg.suggestion.trim() : "";
        const additional: number = Number(msg?.additionalLocations) || 0;
        const locations: Dictionary[] = Array.isArray(msg?.locations) ? msg.locations : [];

        if (locations.length === 0) {
          result.push(this.buildEpubCheckError(severity, code, rawMessage, suggestion, "", -1, -1, additional));
          continue;
        }

        for (let i = 0; i < locations.length; i++) {
          const loc: Dictionary = locations[i] ?? {};
          const p: string = String(loc?.path ?? "").trim();
          const ln: number = Number(loc?.line);
          const col: number = Number(loc?.column);
          result.push(
            this.buildEpubCheckError(
              severity,
              code,
              rawMessage,
              suggestion,
              p,
              Number.isFinite(ln) ? ln : -1,
              Number.isFinite(col) ? col : -1,
              i === 0 ? additional : 0,
            ),
          );
        }
      } catch (e) {
        console.log("[epubMaker] epubcheck 메시지 파싱 스킵:", (e as Error)?.message ?? e);
      }
    }
    return result;
  };

  public parseEpubCheckStdout = (stdout: string): EpubInspectError[] => {
    const result: EpubInspectError[] = [];
    const wanted: Set<string> = new Set(["FATAL", "ERROR", "WARNING", "USAGE", "INFO"]);
    const re: RegExp =
      /^(FATAL|ERROR|WARNING|USAGE|INFO)\s*\(([^)]+)\)\s*:\s*(.+?)\s*(?:\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\))?\s*:\s*(.+)$/i;
    for (const raw of String(stdout ?? "").split("\n")) {
      const line: string = raw.trim();
      if (line === "") {
        continue;
      }
      const m = line.match(re);
      if (!m) {
        continue;
      }
      const sevRaw: string = m[1].toUpperCase();
      if (!wanted.has(sevRaw)) {
        continue;
      }
      const severity: EpubInspectSeverity = sevRaw.toLowerCase() as EpubInspectSeverity;
      const code: string = m[2].trim();
      const filePath: string = m[3].trim().replace(/^[^/]+\.epub\//i, "");
      const ln: number = m[4] !== undefined ? Number(m[4]) : -1;
      const col: number = m[5] !== undefined ? Number(m[5]) : -1;
      const message: string = m[6].trim();
      result.push(this.buildEpubCheckError(severity, code, message, "", filePath, ln, col, 0));
    }
    return result;
  };

  public secondInspect = async (targetEpubFilePath: string): Promise<EpubInspectError[]> => {
    try {
      const { AceByDaisy } = await import("./module/aceByDaisy.js");
      const assertions = await AceByDaisy.getAssertions(targetEpubFilePath);
      const finalResult: EpubInspectError[] = [];
      for (const errorMother of assertions) {
        try {
          if (typeof errorMother["earl:result"] !== "object" || errorMother["earl:result"] === null) {
            throw new Error("ace file earl:result");
          }
          if (typeof errorMother["earl:result"]["earl:outcome"] !== "string") {
            throw new Error("ace file earl:outcome");
          }
          if (typeof errorMother["earl:testSubject"] !== "object" || errorMother["earl:testSubject"] === null) {
            throw new Error("ace file earl:testSubject");
          }
          if (typeof errorMother["earl:testSubject"]["url"] !== "string") {
            throw new Error("ace file earl:url");
          }

          const outcomeStringRaw: string = errorMother["earl:result"]["earl:outcome"].trim();
          if (/pass/.test(outcomeStringRaw) || !Array.isArray(errorMother.assertions)) {
            continue;
          }

          for (const errorObj of errorMother.assertions) {
            if (typeof errorObj["earl:result"]["dct:description"] !== "string") {
              throw new Error("ace file dct:description");
            }
            if (typeof errorObj["earl:test"] !== "object" || errorObj["earl:test"] === null) {
              throw new Error("ace file earl:test");
            }
            if (typeof errorObj["earl:test"]["dct:title"] !== "string") {
              throw new Error("ace file dct:title");
            }
            if (typeof errorObj["earl:test"]["dct:description"] !== "string") {
              throw new Error("ace file dct:description");
            }

            const rawUrl: string = String(errorMother["earl:testSubject"]["url"] ?? "").trim();
            const normalizedUrl: string = this.normalizeReportedPath(rawUrl);
            const ruleCode: string = String(errorObj["earl:test"]["dct:title"] ?? "").trim();
            const descRaw: string = String(errorObj["earl:test"]["dct:description"] ?? "").trim();
            const errorString: string = resolveAceRuleKo(ruleCode, descRaw).error;

            finalResult.push({
              fileName: this.buildKoreanFileLabel(normalizedUrl),
              line: "",
              error: ruleCode !== "" ? `${errorString} [${ruleCode}]` : errorString,
              severity: "error",
              code: ruleCode,
              lineNumber: -1,
              column: -1,
              rawMessage: descRaw,
              filePath: normalizedUrl,
              source: "ace",
            });
          }
        } catch (e) {
          console.log(e);
        }
      }

      return finalResult;
    } catch (e) {
      console.log(e);
      // Returning [] here used to make a failed Ace run (Chromium not
      // launching, a timeout, epub-utils failing to extract the archive)
      // indistinguishable from "Ace ran and found zero accessibility
      // issues" — inspectEpub() would then report status:"success" even
      // though the accessibility check never actually completed. Surfacing
      // this as a visible error entry instead means the user sees that the
      // check didn't run rather than being told the EPUB is clean.
      return [
        {
          fileName: "접근성 검사(Ace)",
          line: "",
          error: `접근성 검사를 실행하지 못했습니다: ${(e as Error)?.message ?? e}`,
          severity: "error",
          code: "ace-run-failed",
          lineNumber: -1,
          column: -1,
          rawMessage: String((e as Error)?.message ?? e),
          source: "ace",
        },
      ];
    }
  };
}

export { EpubMaker };
