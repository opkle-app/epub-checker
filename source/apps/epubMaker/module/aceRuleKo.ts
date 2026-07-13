// ─────────────────────────────────────────────────────────────
// Ace by DAISY(접근성 검사) 규칙 ID → 한글 설명 + 해결법 매핑.
//
// 배경: Ace 는 axe-core 규칙(약 90개) + EPUB 전용 규칙 몇 개를 쓰며, 규칙 ID(=EARL dct:title)는
//   고정된 유한집합이다. 자유 문장이 아니므로 번역 API/AI 대신 사람이 검수한 정적 테이블이 정답:
//   자연스러운 한국어 + 구체적 해결법 + 런타임 비용 0 + 결정적.
//
// 커버 범위: 실제 EPUB 산출물에서 자주 뜨는 규칙 위주. 미등록 code 는
//   resolveAceRuleKo 가 Ace 원문 영어 설명으로 자동 폴백하므로 누락돼도 깨지지 않는다.
//   새 규칙이 관측되면 이 표에 한 줄 추가하면 끝(유지보수는 여기 한 곳).
//
// key 는 반드시 소문자(resolveAceRuleKo 에서 toLowerCase 로 조회).
// ─────────────────────────────────────────────────────────────

interface AceRuleKo {
  label: string; // 무엇이 문제인지 (한국어)
  fix?: string; // 어떻게 고치는지 (한국어)
}

const aceRuleKoMap: Record<string, AceRuleKo> = {
  // ── EPUB 메타데이터 / 패키지(OPF) ──
  "epub-lang": {
    label: "OPF 패키지에 문서 언어가 지정되어 있지 않습니다.",
    fix: 'content.opf 의 <package> 에 xml:lang="ko" 를, <metadata> 에 <dc:language>ko</dc:language> 를 넣으세요.',
  },
  "epub-title": {
    label: "EPUB 제목(dc:title)이 없습니다.",
    fix: "content.opf 의 <metadata> 에 <dc:title>책 제목</dc:title> 을 추가하세요.",
  },
  "epub-type-has-matching-role": {
    label: "epub:type 속성에 대응하는 ARIA role 이 없습니다.",
    fix: 'epub:type 을 쓴 요소에 의미가 맞는 role 속성을 함께 지정하세요(예: epub:type="toc" 에 role="doc-toc").',
  },
  "metadata-accessmode": {
    label: "접근 방식(schema:accessMode) 메타데이터가 없습니다.",
    fix: 'content.opf 에 <meta property="schema:accessMode">textual</meta> 처럼 접근 방식을 명시하세요(textual, visual 등).',
  },
  "metadata-accessmodesufficient": {
    label: "충분한 접근 방식(schema:accessModeSufficient) 메타데이터가 없습니다.",
    fix: 'content.opf 에 <meta property="schema:accessModeSufficient">textual,visual</meta> 를 추가하세요.',
  },
  "metadata-accessibilityfeature": {
    label: "접근성 기능(schema:accessibilityFeature) 메타데이터가 없습니다.",
    fix: 'content.opf 에 <meta property="schema:accessibilityFeature">structuralNavigation</meta> 등 제공 기능을 명시하세요(없으면 none).',
  },
  "metadata-accessibilityhazard": {
    label: "접근성 위험 요소(schema:accessibilityHazard) 메타데이터가 없습니다.",
    fix: 'content.opf 에 <meta property="schema:accessibilityHazard">none</meta> 처럼 위험 요소 유무를 명시하세요(깜빡임 등 없으면 none).',
  },
  "metadata-accessibilitysummary": {
    label: "접근성 요약(schema:accessibilitySummary) 메타데이터가 없습니다.",
    fix: 'content.opf 에 <meta property="schema:accessibilitySummary">이 책의 접근성 특징 설명</meta> 을 추가하세요.',
  },
  "pagebreak-label": {
    label: "페이지 나눔 지점(page break)에 페이지 번호 라벨이 없습니다.",
    fix: "페이지 경계 요소에 aria-label 또는 title 로 페이지 번호를 지정하세요.",
  },
  "epub-pagesource": {
    label: "페이지 목록의 출처(dc:source) 정보가 없습니다.",
    fix: "인쇄본 페이지 번호를 쓴다면 content.opf 에 원본 출처(dc:source)를 명시하세요.",
  },

  // ── 이미지 / 그래픽 대체텍스트 ──
  "image-alt": {
    label: "이미지에 대체 텍스트(alt)가 없습니다.",
    fix: '모든 <img> 에 내용을 설명하는 alt 속성을 넣으세요. 순수 장식용 이미지라면 alt="" 또는 role="presentation" 으로 지정하세요.',
  },
  "svg-img-alt": {
    label: "SVG 이미지에 접근 가능한 이름이 없습니다.",
    fix: 'role="img" 인 <svg> 안에 <title> 요소나 aria-label 로 설명을 넣으세요.',
  },
  "object-alt": {
    label: "<object> 요소에 대체 텍스트가 없습니다.",
    fix: "<object> 에 대체 콘텐츠나 aria-label 을 제공하세요.",
  },
  "area-alt": {
    label: "이미지 맵의 <area> 에 대체 텍스트가 없습니다.",
    fix: "링크가 걸린 <area> 마다 alt 속성으로 목적지를 설명하세요.",
  },
  "role-img-alt": {
    label: 'role="img" 요소에 접근 가능한 이름이 없습니다.',
    fix: "해당 요소에 aria-label 또는 aria-labelledby 로 설명을 지정하세요.",
  },

  // ── 제목(heading) 구조 ──
  "heading-order": {
    label: "제목(h 태그) 순서가 잘못되었습니다. 단계를 건너뛰지 않고 순서대로 있어야 합니다.",
    fix: "h1 → h2 → h3 순으로 단계를 건너뛰지 말고 사용하세요(예: h1 다음에 h3 로 점프 금지).",
  },
  "empty-heading": {
    label: "내용이 비어 있는 제목(heading)이 있습니다.",
    fix: "h1~h6 태그 안에 실제 제목 텍스트를 넣거나, 제목이 아니라면 다른 태그로 바꾸세요.",
  },
  "page-has-heading-one": {
    label: "문서에 h1(최상위 제목)이 없습니다.",
    fix: "각 콘텐츠 문서(챕터)에 대표 제목으로 h1 을 하나 두세요.",
  },

  // ── 링크 / 내비게이션 ──
  "link-name": {
    label: "링크에 식별 가능한 텍스트가 없습니다.",
    fix: "<a> 안에 목적지를 알 수 있는 텍스트를 넣거나 aria-label 을 지정하세요('여기 클릭' 같은 모호한 문구는 지양).",
  },
  "link-in-text-block": {
    label: "링크가 주변 텍스트와 색상만으로 구분되어 있습니다.",
    fix: "링크에 밑줄 등 색 이외의 시각적 구분을 추가하거나 충분한 대비를 확보하세요.",
  },
  bypass: {
    label: "반복 콘텐츠를 건너뛸 수단(건너뛰기 링크/랜드마크)이 없습니다.",
    fix: "본문으로 바로 가는 건너뛰기 링크나 landmark(main 등)를 제공하세요.",
  },

  // ── 목록(list) 구조 ──
  list: {
    label: "목록(<ul>/<ol>) 구조가 올바르지 않습니다.",
    fix: "<ul>/<ol> 의 직계 자식은 <li>(또는 스크립트/템플릿)만 두세요.",
  },
  listitem: {
    label: "<li> 가 <ul>/<ol> 밖에 있습니다.",
    fix: "모든 <li> 는 <ul> 또는 <ol> 안에 넣으세요.",
  },
  "definition-list": {
    label: "정의 목록(<dl>) 구조가 올바르지 않습니다.",
    fix: "<dl> 안에는 <dt>/<dd>(또는 그룹 <div>)만 순서에 맞게 두세요.",
  },
  dlitem: {
    label: "<dt>/<dd> 가 <dl> 밖에 있습니다.",
    fix: "<dt> 와 <dd> 는 반드시 <dl> 안에 배치하세요.",
  },

  // ── 표(table) ──
  "td-headers-attr": {
    label: "표 셀의 headers 속성이 같은 표의 셀을 올바르게 가리키지 않습니다.",
    fix: "<td>/<th> 의 headers 속성이 같은 표 안 헤더 셀의 id 를 정확히 참조하도록 하세요.",
  },
  "th-has-data-cells": {
    label: "헤더 셀(<th>)에 연결된 데이터 셀이 없습니다.",
    fix: "머리글 <th> 에 대응하는 데이터 셀을 두거나, 데이터 표가 아니면 표 구조를 재검토하세요.",
  },
  "table-duplicate-name": {
    label: "표의 summary 와 캡션(<caption>)이 중복됩니다.",
    fix: "summary 속성과 <caption> 중 하나만 남기거나 서로 다른 내용으로 구분하세요.",
  },
  "empty-table-header": {
    label: "표의 헤더 셀(<th>)이 비어 있습니다.",
    fix: "<th> 안에 머리글 텍스트를 넣으세요.",
  },

  // ── 폼 / 컨트롤 라벨 ──
  label: {
    label: "폼 입력 요소에 연결된 라벨이 없습니다.",
    fix: "<label for> 로 입력과 라벨을 연결하거나 aria-label 을 지정하세요.",
  },
  "form-field-multiple-labels": {
    label: "하나의 폼 필드에 라벨이 여러 개 연결되어 있습니다.",
    fix: "필드당 라벨은 하나만 연결하세요.",
  },

  // ── 언어 ──
  "html-has-lang": {
    label: "문서(<html>)에 언어 속성이 없습니다.",
    fix: '각 xhtml 의 <html> 에 lang="ko" xml:lang="ko" 를 지정하세요.',
  },
  "html-lang-valid": {
    label: "<html> 의 lang 값이 유효한 언어 코드가 아닙니다.",
    fix: "lang 을 유효한 BCP47 코드로 지정하세요(예: ko, en, ja).",
  },
  "html-xml-lang-mismatch": {
    label: "lang 과 xml:lang 값이 서로 다릅니다.",
    fix: "<html> 의 lang 과 xml:lang 을 같은 값으로 맞추세요.",
  },
  "valid-lang": {
    label: "lang 속성 값이 유효하지 않습니다.",
    fix: "lang 속성을 유효한 언어 코드로 수정하세요.",
  },

  // ── 대비 / 시각 ──
  "color-contrast": {
    label: "글자와 배경의 색 대비가 부족합니다.",
    fix: "본문 텍스트는 최소 4.5:1(큰 글자 3:1) 대비를 확보하도록 색을 조정하세요.",
  },
  "meta-viewport": {
    label: "확대/축소를 막는 viewport 설정이 있습니다.",
    fix: "meta viewport 에서 user-scalable=no / maximum-scale 제한을 제거해 확대를 허용하세요.",
  },
  blink: {
    label: "<blink> 요소가 사용되었습니다(사용 금지).",
    fix: "<blink> 를 제거하세요.",
  },
  marquee: {
    label: "<marquee> 요소가 사용되었습니다(사용 금지).",
    fix: "<marquee> 를 제거하고 필요하면 정적 표현으로 바꾸세요.",
  },

  // ── 중복 ID / ARIA ──
  "duplicate-id": {
    label: "같은 문서 안에서 id 값이 중복됩니다.",
    fix: "문서 내 모든 요소의 id 를 고유하게 만드세요.",
  },
  "duplicate-id-aria": {
    label: "ARIA 참조에 쓰인 id 가 중복됩니다.",
    fix: "aria-labelledby/aria-describedby 등이 참조하는 id 를 고유하게 만드세요.",
  },
  "aria-allowed-attr": {
    label: "해당 role 에 허용되지 않는 ARIA 속성이 사용되었습니다.",
    fix: "요소의 role 에 맞는 ARIA 속성만 사용하세요.",
  },
  "aria-required-attr": {
    label: "필수 ARIA 속성이 빠졌습니다.",
    fix: "해당 role 이 요구하는 필수 aria-* 속성을 추가하세요.",
  },
  "aria-roles": {
    label: "유효하지 않은 ARIA role 이 사용되었습니다.",
    fix: "role 값을 유효한 ARIA role 로 수정하세요.",
  },
  "aria-valid-attr-value": {
    label: "ARIA 속성 값이 유효하지 않습니다.",
    fix: "aria-* 속성의 값을 스펙에 맞게 수정하세요.",
  },

  // ── 랜드마크 / 문서 구조 ──
  "landmark-one-main": {
    label: "문서에 main 랜드마크가 없거나 여러 개입니다.",
    fix: '본문 영역을 <main>(또는 role="main") 하나로 감싸세요.',
  },
  region: {
    label: "일부 콘텐츠가 랜드마크 영역 밖에 있습니다.",
    fix: "주요 콘텐츠를 header/nav/main 등 적절한 랜드마크로 감싸세요.",
  },
  "document-title": {
    label: "문서에 <title> 이 없습니다.",
    fix: "각 xhtml 의 <head> 에 <title>페이지 제목</title> 을 넣으세요.",
  },
  "frame-title": {
    label: "<iframe>/<frame> 에 title 이 없습니다.",
    fix: "각 프레임에 내용을 설명하는 title 속성을 지정하세요.",
  },
  tabindex: {
    label: "양수 tabindex 가 사용되어 초점 순서가 왜곡됩니다.",
    fix: "tabindex 는 0 또는 -1 만 사용하고, 양수 값은 제거하세요.",
  },
  "scrollable-region-focusable": {
    label: "스크롤 가능한 영역에 키보드 초점을 줄 수 없습니다.",
    fix: '스크롤 영역에 tabindex="0" 을 주어 키보드로 접근할 수 있게 하세요.',
  },
  "nested-interactive": {
    label: "상호작용 요소 안에 또 다른 상호작용 요소가 중첩되어 있습니다.",
    fix: "버튼/링크 안에 또 다른 버튼·링크 등을 중첩하지 마세요.",
  },
};

/**
 * Ace 규칙 code → 표시용 한글 문자열.
 *   등록된 규칙이면 "설명 + 해결법", 아니면 Ace 원문 영어 설명(fallbackDescription)으로 폴백.
 * @returns matched=true 면 테이블 히트(한글화됨), false 면 폴백(영어 원문).
 */
const resolveAceRuleKo = (code: string, fallbackDescription: string): { error: string; matched: boolean } => {
  const key: string = String(code ?? "")
    .toLowerCase()
    .trim();
  const hit: AceRuleKo | undefined = aceRuleKoMap[key];
  if (hit) {
    let text: string = hit.label.trim();
    if (typeof hit.fix === "string" && hit.fix.trim() !== "") {
      text += ` 해결법: ${hit.fix.trim()}`;
    }
    return { error: text, matched: true };
  }
  return { error: String(fallbackDescription ?? "").trim(), matched: false };
};

export { AceRuleKo, aceRuleKoMap, resolveAceRuleKo };
