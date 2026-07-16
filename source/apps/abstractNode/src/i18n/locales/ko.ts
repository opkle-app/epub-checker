import type { InspectionStage } from "../../core/types.js";
import type { Messages } from "../types.js";

const stageLabels: Record<InspectionStage, string> = {
  idle: "대기",
  opening: "여는 중",
  ready: "준비",
  inspecting: "검사 중",
  editing: "편집 중",
  validated: "검사 완료",
  exported: "내보냄",
  error: "오류",
};

const ko: Messages = {
  closeWindow: "닫기",
  openEpub: "EPUB 열기",
  dropEpub: ".epub 파일을 드롭",
  inspect: "검사",
  reinspect: "재검사",
  exportEpub: "추출하기",
  idle: "대기",
  inspectionTab: "검사",
  logTab: "로그",
  inspectionItems: "검사 항목",
  inspectingEpub: "EPUB 검사 중",
  workspaceLabel: "> 작업 공간",
  internalFilesLabel: "> 내부 파일",
  noOpenEpub: "열린 EPUB 없음",
  noInspectionResults: "검사 결과가 아직 없습니다.",
  switchToKorean: "한국어로 전환",
  switchToEnglish: "영어로 전환",
  noEpub: "EPUB 없음",
  stageLabel: (stage) => stageLabels[stage],
  workspaceMeta: ({ stage, issueCount, dirtyCount }) => {
    const issues = `이슈 ${issueCount}개`;
    const edits = dirtyCount > 0 ? ` · 수정 ${dirtyCount}개` : "";
    return `${stageLabels[stage]} · ${issues}${edits}`;
  },
  statusInitial: "EPUB 파일을 열어 검사를 시작하세요.",
  statusUnsavedTabConfirm: ({ fileName }) =>
    `“${fileName}”의 내보내지 않은 수정 사항이 있습니다. 이 탭을 닫으면 수정 사항이 사라집니다.`,
  statusCloseSaveFailed: ({ detail }) => `자동 저장에 실패하여 탭을 닫지 않았습니다: ${detail}`,
  statusDroppedPathUnavailable: "드롭된 파일 경로를 읽을 수 없습니다.",
  statusOpeningArchive: "EPUB 압축을 열고 내부 문서를 읽는 중입니다.",
  statusOpened: "파일을 열었습니다. 검사하거나 내부 문서를 선택하세요.",
  statusEditingFile: ({ filePath }) => `${filePath} 편집 중`,
  statusAutoSaving: "수정 사항을 자동 저장하는 중입니다.",
  statusAutoSaveFailed: ({ detail }) => `자동 저장 실패: ${detail}`,
  statusSaved: "작업 공간에 반영됨",
  statusAutoSaveTimeout: ({ seconds }) => `자동 저장이 ${seconds}초 내에 끝나지 않았습니다.`,
  statusUnsavedAppConfirm: ({ count }) =>
    `${count}개의 EPUB에 내보내지 않은 수정 사항이 있습니다. 앱을 종료하면 수정 사항이 사라집니다.`,
  statusQuitSaveFailed: ({ detail }) => `자동 저장에 실패하여 앱을 종료하지 않았습니다: ${detail}`,
  statusInspecting: "W3C EPUBCheck와 Ace 접근성 검사를 실행 중입니다.",
  statusInspectionStale: "검사 중 내용이 변경되어 결과가 현재 편집본과 일치하지 않습니다. 다시 검사하세요.",
  statusPassedAceSkipped: "EPUBCheck 검사는 통과했습니다. Chromium을 준비하지 못해 Ace 검사는 건너뛰었습니다.",
  statusPassed: "EPUBCheck와 Ace 검사에서 오류가 없습니다. 수정된 EPUB을 내보낼 수 있습니다.",
  statusIssuesFound: ({ count, aceSkipped }) =>
    `${count}개의 검사 항목이 발견되었습니다.${aceSkipped ? " Ace 검사는 Chromium을 준비하지 못해 건너뛰었습니다." : ""}`,
  statusOperationFailed: ({ detail }) => detail,
  statusExportComplete: ({ filePath }) => `EPUB 생성 완료: ${filePath}`,
  statusExportCompleteWithChanges: ({ filePath }) =>
    `EPUB 생성 완료: ${filePath} (내보내기 중 추가 수정 사항이 생겨 작업 공간은 계속 수정됨 상태입니다.)`,
  runtimeChecking: "접근성 검사용 Chromium을 확인하는 중입니다.",
  runtimePreparing: "접근성 검사용 Chromium을 백그라운드에서 준비하는 중입니다.",
  runtimeDownloading: "접근성 검사에 필요한 로컬 Chromium 런타임을 다운로드하는 중입니다.",
  runtimeReady: "접근성 검사 런타임이 준비되었습니다.",
  runtimeUnavailable: "Chromium 런타임을 준비하지 못했습니다.",
  runtimeDownloadFailed: ({ detail }) => `Chromium 다운로드 실패: ${detail}`,
  editorNoFileSelected: "선택된 파일 없음",
  editorNoDocumentIssues: "이 문서에 연결된 검사 항목이 없습니다.",
};

export { ko };
