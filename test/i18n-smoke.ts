import assert from "node:assert/strict";
import {
  LOCALE_STORAGE_KEY,
  LocaleController,
  message,
  selectSupportedLocale,
  translateMessage,
} from "../source/apps/abstractNode/src/i18n/i18n.js";
import { localizeIssue } from "../source/apps/abstractNode/src/i18n/issueLocalizer.js";

assert.equal(selectSupportedLocale(["ko-KR", "en-US"]), "ko");
assert.equal(selectSupportedLocale(["ja-JP", "en-GB", "ko-KR"]), "en");
assert.equal(selectSupportedLocale(["fr-FR", "ja-JP"]), "en");

const values = new Map<string, string>([[LOCALE_STORAGE_KEY, "ko"]]);
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
};

const locale = new LocaleController(storage);
assert.equal(locale.initialize(["en-US"]), "ko", "saved user choice must override the operating-system language");
assert.equal(locale.setLocale("en"), true);
assert.equal(values.get(LOCALE_STORAGE_KEY), "en", "explicit language changes must persist");
assert.match(locale.messages.workspaceMeta({ stage: "ready", issueCount: 1, dirtyCount: 1 }), /1 issue · 1 edit/);
assert.match(locale.messages.workspaceMeta({ stage: "ready", issueCount: 2, dirtyCount: 2 }), /2 issues · 2 edits/);
assert.equal(
  translateMessage(locale.messages, message("statusIssuesFound", { count: 1, aceSkipped: false })),
  "1 inspection issue was found.",
);

assert.equal(locale.setLocale("en"), false, "selecting the active language must not trigger a redundant render");

const rawIssue = {
  fileName: "설정 파일(OPF)",
  line: "12번째 줄",
  error: "기존 한국어 표시 문자열",
  severity: "error" as const,
  code: "OPF-002",
  lineNumber: 12,
  column: 3,
  rawMessage: 'The OPF file "OEBPS/missing.opf" was not found in the EPUB.',
  suggestion: "Check the rootfile path.",
  additionalLocations: 1,
  filePath: "OEBPS/content.opf",
  source: "epubcheck" as const,
};
const englishIssue = localizeIssue(rawIssue, "en");
assert.equal(englishIssue.fileName, "Package document (OPF)");
assert.equal(englishIssue.line, "Line 12");
assert.match(englishIssue.error, /The OPF file/);
assert.match(englishIssue.error, /Suggestion: Check the rootfile path/);
assert.match(englishIssue.error, /1 other location/);
assert.match(englishIssue.error, /\[OPF-002\]$/);

const koreanIssue = localizeIssue(rawIssue, "ko");
assert.equal(koreanIssue.fileName, "설정 파일(OPF)");
assert.equal(koreanIssue.line, "12번째 줄");
assert.match(koreanIssue.error, /OPF 파일을 EPUB 안에서 찾을 수 없습니다/);
assert.doesNotMatch(koreanIssue.error, /기존 한국어 표시 문자열/);

const aceIssue = {
  ...rawIssue,
  code: "image-alt",
  rawMessage: "Images must have alternate text.",
  suggestion: "",
  additionalLocations: 0,
  filePath: "OEBPS/Text/chapter1.xhtml",
  source: "ace" as const,
};
assert.match(localizeIssue(aceIssue, "ko").error, /이미지에 대체 텍스트/);
assert.match(localizeIssue(aceIssue, "en").error, /Images must have alternate text/);

const aceFailure = {
  ...aceIssue,
  code: "ace-run-failed",
  rawMessage: "Chromium did not start",
  filePath: "",
};
assert.match(localizeIssue(aceFailure, "ko").error, /접근성 검사를 실행하지 못했습니다/);
assert.match(localizeIssue(aceFailure, "en").error, /Accessibility inspection could not run/);

console.log("Locale selection, persistence, and English pluralization ✓");
