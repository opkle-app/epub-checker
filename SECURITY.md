# Security Policy

## Supported Versions

EpubChecker는 아직 초기 오픈소스 공개 단계입니다. 보안 패치는 `main` 브랜치 기준 최신 버전에만 제공됩니다.

## Reporting a Vulnerability

보안 취약점을 발견하셨다면 공개 이슈로 올리지 말고 아래로 직접 연락해주세요.

- **totite2@gmail.com**

제보 시 아래 내용을 포함해주시면 대응이 빨라집니다.

- 취약점 종류 (예: 로컬 파일 시스템 접근 범위 초과, IPC 경계 우회, 악의적인 EPUB 파일을 통한 코드 실행 등)
- 재현 절차
- 영향 범위(어떤 조건에서 발동하는지)
- 가능하다면 PoC

## Scope Notes

EpubChecker는 [local-first 원칙](./README.md#local-first-rule)을 따르는 Electron 데스크톱 앱입니다. 특히 아래 영역의 취약점 제보를 우선적으로 다룹니다.

- renderer가 `window.electronAPI`를 벗어나 Node.js API나 파일 시스템에 직접 접근하는 경로
- 악의적으로 조작된 `.epub` 파일을 열었을 때 발생하는 경로 탈출(path traversal), 임의 코드 실행, 리소스 고갈 등
- `launcher/` 하위의 JRE/EPUBCheck/Chromium 실행 과정에서의 임의 명령 실행

응답 시간은 보장드리기 어렵지만, 제보 확인 후 가능한 빨리 회신드리겠습니다.
