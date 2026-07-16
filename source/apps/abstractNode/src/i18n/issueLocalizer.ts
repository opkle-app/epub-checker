import type { EpubInspectError } from "../core/types.js";
import { resolveAceRuleKo } from "../../../epubMaker/module/aceRuleKo.js";
import { resolveEpubCheckKo } from "../../../epubMaker/module/epubCheckMessageKo.js";
import type { AppLocale } from "./types.js";

const buildFileLabel = (filePath: string, locale: AppLocale, source?: "epubcheck" | "ace"): string => {
  const normalized = String(filePath ?? "").replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? normalized;
  const lower = base.toLowerCase();
  const labels =
    locale === "ko"
      ? {
          configuration: "설정 파일",
          author: "작가 소개",
          toc: "목차 페이지",
          bibliography: "서지 정보",
          cover: "표지",
          back: "뒷표지/여백",
          spacer: "여백 페이지",
          navigation: "네비게이션",
          opf: "설정 파일(OPF)",
          ncx: "목차(NCX)",
          accessibility: "접근성 검사(Ace)",
        }
      : {
          configuration: "Configuration file",
          author: "Author information",
          toc: "Table of contents",
          bibliography: "Bibliographic information",
          cover: "Cover",
          back: "Back cover / spacer",
          spacer: "Spacer page",
          navigation: "Navigation",
          opf: "Package document (OPF)",
          ncx: "Table of contents (NCX)",
          accessibility: "Accessibility inspection (Ace)",
        };

  if (normalized === "") return source === "ace" ? labels.accessibility : labels.configuration;
  const chapter = lower.match(/^chapter(\d+)\./);
  if (chapter) return locale === "ko" ? `${chapter[1]}장 본문` : `Chapter ${chapter[1]}`;
  if (/^author\./.test(lower)) return labels.author;
  if (/^toc\./.test(lower)) return labels.toc;
  if (/^copyright\./.test(lower)) return labels.bibliography;
  if (/^cover\./.test(lower)) return labels.cover;
  if (/^back(spacer)?\./.test(lower)) return labels.back;
  if (/^spacer\./.test(lower)) return labels.spacer;
  if (/^nav\./.test(lower)) return labels.navigation;
  if (/\.opf$/.test(lower)) return labels.opf;
  if (/\.ncx$/.test(lower)) return labels.ncx;
  if (/\.css$/.test(lower)) return locale === "ko" ? `스타일(${base})` : `Stylesheet (${base})`;
  return base || labels.configuration;
};

const appendCode = (text: string, code: string): string => {
  const cleanCode = code.trim();
  return cleanCode === "" ? text : `${text} [${cleanCode}]`;
};

const localizeIssue = (issue: EpubInspectError, locale: AppLocale): EpubInspectError => {
  const code = String(issue.code ?? "").trim();
  const raw = String(issue.rawMessage ?? "").trim();
  const suggestion = String(issue.suggestion ?? "").trim();
  const additional = Math.max(0, Number(issue.additionalLocations) || 0);
  const lineNumber = Number(issue.lineNumber) > 0 ? Number(issue.lineNumber) : -1;
  let error: string;

  if (code === "ace-run-failed") {
    error =
      locale === "ko"
        ? `접근성 검사를 실행하지 못했습니다: ${raw || "알 수 없는 오류"}`
        : `Accessibility inspection could not run: ${raw || "Unknown error"}`;
  } else if (locale === "ko") {
    const resolved = issue.source === "ace" ? resolveAceRuleKo(code, raw) : resolveEpubCheckKo(code, raw);
    error = resolved.error;
    if (!resolved.matched && suggestion !== "") error += ` (제안: ${suggestion})`;
    if (additional > 0) error += ` (그 외 ${additional}개 위치에서 동일 오류)`;
    error = appendCode(error, code);
  } else {
    error = raw || "Unknown inspection issue.";
    if (suggestion !== "") error += ` Suggestion: ${suggestion}`;
    if (additional > 0) {
      error += ` Also occurred at ${additional} other ${additional === 1 ? "location" : "locations"}.`;
    }
    error = appendCode(error, code);
  }

  return {
    ...issue,
    fileName: buildFileLabel(issue.filePath ?? "", locale, issue.source),
    line: lineNumber > 0 ? (locale === "ko" ? `${lineNumber}번째 줄` : `Line ${lineNumber}`) : "",
    error,
  };
};

export { buildFileLabel, localizeIssue };
