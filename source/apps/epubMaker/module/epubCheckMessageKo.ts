// ─────────────────────────────────────────────────────────────
// W3C EPUBCheck 메시지 ID → 한글 설명 + 해결법 매핑.
//
// 배경: epubcheck 의 ko 로케일 번역은 문장이 부자연스럽다(예: '파일 "Duplicate ID..."를(을)
//   파싱하는 동안 오류가 발생했습니다.'). 그래서 epubcheck 는 영어 로케일로 뽑고(파라미터가
//   그대로 채워진 안정적 원문), 메시지 ID(RSC-005, OPF-015 …)로 사람이 검수한 한글 설명+해결법을
//   입힌다. Ace 방식과 동일. ID 는 고정 유한집합이라 번역 API/AI 불필요.
//
// ⚠️ epubcheck 메시지는 동적 파라미터(%1$s)를 품는다. 특히 RSC-005/016(파싱 오류)은 코드 자체가
//   포괄적이고 진짜 알맹이(예: 'Duplicate ID "aaaaa"')가 파라미터에 있다. 이런 항목은 keepDetail=true
//   로 두어 영문 원문 상세를 "(상세: …)" 로 덧붙여 정보 손실을 막는다.
//
// 미등록 ID 는 resolveEpubCheckKo 가 영문 원문으로 폴백 → 누락돼도 안 깨진다. 새 ID 관측 시 여기 한 줄 추가.
// key 는 대문자-하이픈 형식(예: "RSC-005"). 조회 시 대문자로 정규화.
// ─────────────────────────────────────────────────────────────

interface EpubCheckMessageKo {
  label: string; // 무엇이 문제인지 (한국어)
  fix?: string; // 어떻게 고치는지 (한국어)
  keepDetail?: boolean; // true 면 영문 원문 상세를 "(상세: …)" 로 덧붙임(파라미터 정보 보존)
}

const epubCheckMessageKoMap: Record<string, EpubCheckMessageKo> = {
  // ── RSC: 리소스/파싱 ──
  "RSC-001": {
    label: "참조된 파일을 EPUB 안에서 찾을 수 없습니다.",
    fix: "상세에 표시된 파일이 실제로 존재하고 경로/철자가 맞는지 확인하세요.",
    keepDetail: true,
  },
  "RSC-002": {
    label: "필수 파일 META-INF/container.xml 을 찾을 수 없습니다.",
    fix: "EPUB 루트의 META-INF 폴더에 container.xml 이 있는지 확인하세요.",
  },
  "RSC-003": {
    label: "container.xml 에 OPF를 가리키는 rootfile 선언이 없습니다.",
    fix: 'container.xml 의 rootfile 요소에 media-type="application/oebps-package+xml" 와 full-path 를 올바로 지정하세요.',
  },
  "RSC-005": {
    label: "리소스를 파싱하는 중 문법/스키마 오류가 발견되었습니다.",
    fix: "상세 내용을 보고 해당 파일의 마크업을 고치세요. 흔한 원인: 중복 id, 닫히지 않은 태그, 필수 요소 누락, 잘못된 속성 값.",
    keepDetail: true,
  },
  "RSC-006": {
    label: "이 위치에서는 원격 리소스 참조가 허용되지 않습니다.",
    fix: "해당 리소스를 EPUB 컨테이너 안에 포함시키고 상대 경로로 참조하세요.",
    keepDetail: true,
  },
  "RSC-007": {
    label: "참조된 리소스를 EPUB 안에서 찾을 수 없습니다.",
    fix: "상세의 리소스를 EPUB에 포함하거나, 참조 경로를 실제 파일 위치에 맞게 수정하세요.",
    keepDetail: true,
  },
  "RSC-008": {
    label: "참조된 리소스가 OPF 매니페스트에 선언되어 있지 않습니다.",
    fix: "content.opf 의 <manifest> 에 해당 파일을 <item> 으로 추가하세요.",
    keepDetail: true,
  },
  "RSC-009": {
    label: "SVG가 아닌 이미지에 프래그먼트(#) 식별자를 쓸 수 없습니다.",
    fix: "이미지 참조에서 '#...' 프래그먼트를 제거하세요.",
  },
  "RSC-011": {
    label: "스파인(읽기 순서)에 없는 리소스를 참조하고 있습니다.",
    fix: "해당 문서를 content.opf 의 <spine> 에 <itemref> 로 추가하거나, 참조를 스파인 항목으로 바꾸세요.",
  },
  "RSC-012": {
    label: "참조한 프래그먼트(#id) 대상이 문서에 정의되어 있지 않습니다.",
    fix: "링크의 '#id' 가 실제로 존재하는 요소 id 를 가리키도록 맞추세요.",
  },
  "RSC-016": {
    label: "파일 파싱 중 치명적 오류가 발생했습니다(문서가 손상되었거나 심각한 문법 오류).",
    fix: "상세를 보고 해당 파일의 XML/XHTML 문법을 수정하세요. 파일 인코딩(UTF-8)과 최상위 태그 구조도 확인하세요.",
    keepDetail: true,
  },
  "RSC-020": { label: "유효하지 않은 URL 입니다.", fix: "상세의 URL 형식을 올바르게 수정하세요.", keepDetail: true },
  "RSC-026": {
    label: "URL이 EPUB 컨테이너 바깥을 가리킵니다.",
    fix: "컨테이너 내부를 가리키는 유효한 상대 경로로 수정하세요.",
    keepDetail: true,
  },
  "RSC-028": {
    label: "XML 문서가 UTF-8이 아닌 인코딩으로 되어 있습니다.",
    fix: "해당 파일을 UTF-8로 저장하세요.",
    keepDetail: true,
  },
  "RSC-030": {
    label: "EPUB에서는 file:// URL을 쓸 수 없습니다.",
    fix: "file:// 참조를 컨테이너 내부 상대 경로로 바꾸세요.",
    keepDetail: true,
  },
  "RSC-032": {
    label: "외부(비표준) 리소스에 대한 대체(fallback)가 없습니다.",
    fix: "해당 리소스에 표준 코어 미디어 타입 대체본을 제공하세요.",
    keepDetail: true,
  },
  "RSC-033": {
    label: "상대 URL에 쿼리(?...) 문자열을 쓸 수 없습니다.",
    fix: "URL에서 쿼리 부분을 제거하세요.",
    keepDetail: true,
  },

  // ── OPF: 패키지 문서 ──
  "OPF-002": {
    label: "OPF 파일을 EPUB 안에서 찾을 수 없습니다.",
    fix: "container.xml 의 full-path 가 실제 content.opf 위치와 일치하는지 확인하세요.",
    keepDetail: true,
  },
  "OPF-003": {
    label: "EPUB 안에 있지만 OPF 매니페스트에 선언되지 않은 파일이 있습니다.",
    fix: "해당 파일을 content.opf 의 <manifest> 에 <item> 으로 추가하거나, 쓰지 않으면 삭제하세요.",
    keepDetail: true,
  },
  "OPF-010": {
    label: "참조를 해석하는 중 오류가 발생했습니다.",
    fix: "상세의 참조 경로가 유효한지 확인하세요.",
    keepDetail: true,
  },
  "OPF-012": {
    label: "해당 미디어 타입에는 허용되지 않는 item 속성(property)입니다.",
    fix: "매니페스트 item 의 properties 값을 미디어 타입에 맞게 수정하세요.",
    keepDetail: true,
  },
  "OPF-013": {
    label: "선언된 MIME 타입이 실제 콘텐츠의 타입과 일치하지 않습니다.",
    fix: "content.opf 의 media-type 을 실제 파일 형식에 맞게 수정하세요.",
    keepDetail: true,
  },
  "OPF-014": {
    label: "이 속성(property)은 OPF에 선언되어야 하는데 빠져 있습니다.",
    fix: "해당 매니페스트 item 의 properties 에 필요한 값을 추가하세요(예: nav, cover-image, scripted).",
    keepDetail: true,
  },
  "OPF-015": {
    label: "이 속성(property)은 OPF에 선언하면 안 되는데 선언되어 있습니다.",
    fix: "해당 item 의 properties 에서 불필요한 값을 제거하세요(예: 실제 스크립트가 없으면 scripted 제거).",
    keepDetail: true,
  },
  "OPF-016": {
    label: "rootfile 요소에 필수 속성 full-path 가 없습니다.",
    fix: "container.xml 의 <rootfile> 에 full-path 속성을 추가하세요.",
  },
  "OPF-017": {
    label: "rootfile 의 full-path 속성이 비어 있습니다.",
    fix: "full-path 에 content.opf 의 실제 경로를 넣으세요.",
  },
  "OPF-025": {
    label: "속성 값은 하나만 지정해야 하는데 여러 개가 들어 있습니다.",
    fix: "해당 속성에 값을 하나만 남기세요.",
    keepDetail: true,
  },
  "OPF-027": {
    label: "정의되지 않은 속성(property)입니다.",
    fix: "오타를 확인하거나 필요한 prefix 를 선언하세요.",
    keepDetail: true,
  },
  "OPF-028": {
    label: "선언되지 않은 prefix 를 사용했습니다.",
    fix: "<package> 의 prefix 속성에 해당 prefix 의 URI 를 선언하세요.",
    keepDetail: true,
  },
  "OPF-030": {
    label: "unique-identifier 가 가리키는 식별자를 찾을 수 없습니다.",
    fix: '<package unique-identifier="..."> 값이 실제 <dc:identifier> 의 id 와 일치하는지 확인하세요.',
    keepDetail: true,
  },
  "OPF-031": {
    label: "guide 의 reference가 매니페스트에 없는 파일을 가리킵니다.",
    fix: "해당 파일을 매니페스트에 추가하거나 guide 참조를 수정하세요.",
    keepDetail: true,
  },
  "OPF-033": {
    label: "스파인에 linear 리소스가 하나도 없습니다.",
    fix: '<spine> 에 linear="no" 가 아닌 본문 항목이 최소 하나 있도록 하세요.',
  },
  "OPF-034": {
    label: "스파인이 같은 매니페스트 항목을 중복 참조합니다.",
    fix: "<spine> 에서 중복된 <itemref idref> 를 제거하세요.",
    keepDetail: true,
  },
  "OPF-040": {
    label: "지정한 대체(fallback) 항목을 찾을 수 없습니다.",
    fix: "fallback 속성이 가리키는 id 가 매니페스트에 존재하는지 확인하세요.",
    keepDetail: true,
  },
  "OPF-042": {
    label: "스파인에 쓸 수 없는 미디어 타입입니다.",
    fix: "스파인 항목은 XHTML 콘텐츠 문서이거나 fallback 을 제공해야 합니다.",
    keepDetail: true,
  },
  "OPF-043": {
    label: "비표준 미디어 타입 스파인 항목에 fallback 이 없습니다.",
    fix: "해당 항목에 fallback 을 지정하세요.",
    keepDetail: true,
  },
  "OPF-044": {
    label: "비표준 미디어 타입 스파인 항목에 XHTML 대체본이 없습니다.",
    fix: "EPUB 콘텐츠 문서(XHTML) fallback 을 제공하세요.",
    keepDetail: true,
  },
  "OPF-048": {
    label: "package 태그에 필수 unique-identifier 속성이 없습니다.",
    fix: "<package> 에 unique-identifier 속성을 추가하고 <dc:identifier> 의 id 와 연결하세요.",
  },
  "OPF-049": {
    label: "매니페스트에서 해당 item id 를 찾을 수 없습니다.",
    fix: "참조하는 id 가 매니페스트에 실제로 존재하는지 확인하세요.",
    keepDetail: true,
  },
  "OPF-050": {
    label: "TOC 속성이 NCX가 아닌 파일을 가리킵니다.",
    fix: '<spine toc="..."> 가 application/x-dtbncx+xml 타입의 .ncx 항목을 가리키게 하세요.',
  },
  "OPF-060": {
    label: "ZIP 안에 중복된 파일 항목이 있습니다.",
    fix: "유니코드 정규화·대소문자 무시 기준으로도 파일명이 겹치지 않게 하세요.",
    keepDetail: true,
  },
  "OPF-073": {
    label: "문서 타입 선언에 외부 식별자를 쓸 수 없습니다.",
    fix: "DOCTYPE 에서 외부 식별자(PUBLIC/SYSTEM)를 제거하세요.",
  },
  "OPF-074": {
    label: "같은 리소스가 매니페스트에 여러 번 선언되어 있습니다.",
    fix: "중복된 <item> 선언을 하나만 남기세요.",
    keepDetail: true,
  },
  "OPF-096": {
    label: "non-linear 콘텐츠에 도달할 수 있는 하이퍼링크가 없습니다.",
    fix: 'linear="no" 문서로 이동하는 링크를 본문 어딘가에 두세요.',
    keepDetail: true,
  },
  "OPF-097": {
    label: "매니페스트에 있지만 어떤 문서에서도 참조되지 않는 리소스가 있습니다.",
    fix: "해당 리소스를 어딘가에서 참조하거나, 쓰지 않으면 매니페스트/파일에서 제거하세요.",
    keepDetail: true,
  },
  "OPF-098": {
    label: "href 는 리소스를 가리켜야 하는데 패키지 문서 내부 요소를 가리킵니다.",
    fix: "해당 URL 을 실제 리소스 파일 경로로 수정하세요.",
    keepDetail: true,
  },
  "OPF-099": {
    label: "매니페스트에 패키지 문서(content.opf) 자신을 넣을 수 없습니다.",
    fix: "매니페스트에서 content.opf 자체 항목을 제거하세요.",
  },

  // ── PKG: 컨테이너/ZIP ──
  "PKG-003": {
    label: "EPUB 파일 헤더를 읽을 수 없습니다(파일 손상 가능성).",
    fix: "EPUB을 다시 압축(생성)하세요. mimetype 을 무압축으로 맨 앞에 두어야 합니다.",
  },
  "PKG-004": { label: "EPUB ZIP 헤더가 손상되었습니다.", fix: "EPUB을 다시 생성하세요." },
  "PKG-006": {
    label: "mimetype 파일이 없거나 아카이브의 첫 번째 항목이 아닙니다.",
    fix: "ZIP을 만들 때 mimetype 을 가장 먼저, 무압축(store)으로 넣으세요.",
  },
  "PKG-007": {
    label: "mimetype 파일 내용이 잘못되었거나 압축되어 있습니다.",
    fix: "mimetype 파일에는 정확히 'application/epub+zip' 만 담고 압축하지 마세요.",
  },
  "PKG-008": {
    label: "파일을 읽을 수 없습니다.",
    fix: "상세의 파일이 손상되지 않았는지, 접근 가능한지 확인하세요.",
    keepDetail: true,
  },
  "PKG-009": {
    label: "OCF 파일명에 허용되지 않는 문자가 있습니다.",
    fix: "상세에 표시된 금지 문자를 파일명에서 제거하세요.",
    keepDetail: true,
  },
  "PKG-012": {
    label: "파일명에 비ASCII 문자가 있어 일부 리더에서 호환 문제가 생길 수 있습니다.",
    fix: "파일명을 영문/숫자 위주의 ASCII 로 바꾸는 것을 권장합니다.",
    keepDetail: true,
  },
  "PKG-025": {
    label: "출판 리소스는 META-INF 폴더 안에 두면 안 됩니다.",
    fix: "해당 리소스를 META-INF 밖(OEBPS 등)으로 옮기세요.",
  },
  "PKG-026": {
    label: "난독화(obfuscated) 리소스는 폰트 코어 미디어 타입이어야 합니다.",
    fix: "난독화 대상이 폰트인지, media-type 이 올바른지 확인하세요.",
    keepDetail: true,
  },

  // ── HTM: XHTML ──
  "HTM-001": {
    label: "XML 기반 문서가 유효한 XML 1.0 이 아닙니다.",
    fix: "문서를 유효한 XML 1.0 으로 작성하세요.",
    keepDetail: true,
  },
  "HTM-003": {
    label: "EPUB3 문서에서는 외부 엔티티를 쓸 수 없습니다.",
    fix: "외부 엔티티 선언을 제거하세요.",
    keepDetail: true,
  },
  "HTM-004": { label: "DOCTYPE 이 비정상입니다.", fix: "XHTML 은 '<!DOCTYPE html>' 을 사용하세요.", keepDetail: true },
  "HTM-046": {
    label: "고정 레이아웃 문서에 viewport meta 요소가 없습니다.",
    fix: '<head> 에 <meta name="viewport" content="width=..., height=..."> 를 추가하세요.',
  },
  "HTM-048": {
    label: "SVG 고정 레이아웃 문서에 viewBox 속성이 없습니다.",
    fix: "최상위 <svg> 에 viewBox 속성을 추가하세요.",
  },
  "HTM-058": {
    label: "HTML 문서가 UTF-8이 아니라 UTF-16 으로 인코딩되어 있습니다.",
    fix: "문서를 UTF-8로 저장하세요.",
  },

  // ── CSS ──
  "CSS-001": {
    label: "EPUB 스타일시트에 포함하면 안 되는 CSS 속성입니다.",
    fix: "상세의 속성을 스타일시트에서 제거하세요.",
    keepDetail: true,
  },
  "CSS-004": {
    label: "CSS 문서가 UTF-8이 아닌 인코딩으로 되어 있습니다.",
    fix: "CSS 파일을 UTF-8로 저장하세요.",
    keepDetail: true,
  },
  "CSS-008": {
    label: "CSS를 파싱하는 중 오류가 발생했습니다.",
    fix: "상세를 보고 해당 CSS의 문법 오류(닫히지 않은 중괄호, 잘못된 값 등)를 수정하세요.",
    keepDetail: true,
  },

  // ── MED: 미디어/미디어 오버레이 ──
  "MED-003": {
    label: "picture 의 img 는 코어 미디어 타입 리소스를 참조해야 합니다.",
    fix: "표준 이미지 형식(png/jpeg/gif/webp/svg)을 참조하거나 적절한 fallback 을 제공하세요.",
    keepDetail: true,
  },
  "MED-007": {
    label: "외부 리소스를 참조하는 picture source 에 type 속성이 필요합니다.",
    fix: "<source> 에 type 속성을 지정하세요.",
    keepDetail: true,
  },
  "MED-010": {
    label: "미디어 오버레이가 참조하는 콘텐츠 문서에 media-overlay 속성이 없습니다.",
    fix: "해당 XHTML의 매니페스트 item 에 media-overlay 속성을 지정하세요.",
  },
  "MED-014": {
    label: "미디어 오버레이 오디오 URL 에 프래그먼트(#)를 쓸 수 없습니다.",
    fix: "오디오 참조에서 '#...' 부분을 제거하세요.",
    keepDetail: true,
  },

  // ── NCX / NAV: 목차 ──
  "NCX-001": {
    label: "NCX 식별자가 OPF 식별자와 일치하지 않습니다.",
    fix: "toc.ncx 의 dtb:uid 값을 content.opf 의 dc:identifier 와 동일하게 맞추세요.",
    keepDetail: true,
  },
  "NAV-003": {
    label: "본문에 페이지 나눔이 있는데 내비게이션 문서에 페이지 목록이 없습니다.",
    fix: 'nav 문서에 epub:type="page-list" 목록을 추가하세요.',
  },
  "NAV-010": {
    label: "내비게이션이 원격 리소스로 링크하면 안 됩니다.",
    fix: "nav 링크가 EPUB 내부 파일을 가리키도록 수정하세요.",
    keepDetail: true,
  },
  "NAV-011": {
    label: "내비게이션 링크가 읽기 순서(reading order)와 어긋납니다.",
    fix: "nav 의 링크 순서를 스파인/문서 순서와 일치시키세요.",
    keepDetail: true,
  },

  // ── ACC: 접근성(FATAL/ERROR 로 뜨는 경우) ──
  "ACC-004": {
    label: "링크(a 요소)에 텍스트가 없습니다.",
    fix: "<a> 안에 목적지를 알 수 있는 텍스트를 넣거나 aria-label 을 지정하세요.",
  },
};

/**
 * epubcheck 메시지 ID(code) → 표시용 한글 문자열.
 *   등록 ID: "설명 + 해결법" (+ keepDetail 이면 영문 원문 상세 덧붙임). 미등록: 영문 원문 폴백.
 * @param code 예 "RSC-005"
 * @param rawEnglishMessage 영어 로케일로 뽑은 원문 메시지(파라미터 채워짐)
 * @returns matched=true 면 테이블 히트(한글화됨)
 */
const resolveEpubCheckKo = (code: string, rawEnglishMessage: string): { error: string; matched: boolean } => {
  const key: string = String(code ?? "")
    .toUpperCase()
    .trim();
  const raw: string = String(rawEnglishMessage ?? "").trim();
  const hit: EpubCheckMessageKo | undefined = epubCheckMessageKoMap[key];
  if (!hit) {
    return { error: raw, matched: false };
  }
  let text: string = hit.label.trim();
  if (typeof hit.fix === "string" && hit.fix.trim() !== "") {
    text += ` 해결법: ${hit.fix.trim()}`;
  }
  if (hit.keepDetail && raw !== "") {
    text += ` (상세: ${raw})`;
  }
  return { error: text, matched: true };
};

export { EpubCheckMessageKo, epubCheckMessageKoMap, resolveEpubCheckKo };
