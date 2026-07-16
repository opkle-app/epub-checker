type EpubInspectSeverity = "fatal" | "error" | "warning" | "usage" | "info";

interface EpubInspectError {
  fileName: string; // 사람이 읽는 한글 파일 라벨 (예: "3장 본문", "설정 파일(OPF)")
  line: string; // 사람이 읽는 줄 라벨 (예: "12번째 줄", 위치 없으면 "")
  error: string; // 최종 설명 문자열 (ko 로케일 메시지 + 제안/추가안내)
  severity?: EpubInspectSeverity; // 심각도 (epubcheck 원본 severity 소문자화)
  code?: string; // 에러 ID/규칙명 (예: "RSC-005", ace 규칙명)
  lineNumber?: number; // 숫자 줄번호 (없으면 -1) — 정렬/필터용
  column?: number; // 열번호 (없으면 -1)
  rawMessage?: string; // epubcheck/ace 원문 메시지 (로케일 반영)
  filePath?: string; // EPUB 내부 원본 경로 (예: OEBPS/Text/chapter1.xhtml)
  source?: "epubcheck" | "ace"; // 검사 출처
}

interface EpubInspectResult {
  status: "success" | "error";
  errors: EpubInspectError[];
  logs: string[];
}

export { EpubInspectError, EpubInspectSeverity, EpubInspectResult };
