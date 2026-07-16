# Changelog

## 0.2.0

### Added

- 한국어와 영어를 즉시 전환하는 `KO / EN` 토글
- 저장된 사용자 언어 선택과 운영체제 기본 언어 감지
- 영어 EPUBCheck 및 Ace by DAISY 검사 결과
- 네이티브 파일 열기·저장 대화상자 다국어 지원
- Chromium 런타임 준비·다운로드 상태 다국어 지원
- CodeMirror 상태 및 진단 메시지 다국어 지원

### Changed

- 첫 번째 운영체제 선호 언어가 한국어일 때만 한국어를 기본값으로 사용하고, 그 외에는 영어를 기본값으로 사용
- 검사 결과의 원문, 제안, 추가 발생 위치를 보존해 재검사 없이 언어 전환 가능
- 언어 토글의 활성색과 키보드 포커스 색상을 앱 기본 강조색으로 통일
- EPUB 언어 관련 Ace 해결 안내가 특정 언어를 강제하지 않고 실제 도서의 BCP 47 언어 태그를 안내하도록 개선

### Distribution

- Windows 업데이트는 Microsoft Store에서 제공
- GitHub Release는 macOS Intel, macOS Apple Silicon, Linux 패키지를 제공
