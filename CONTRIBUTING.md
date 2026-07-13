# Contributing to EpubChecker

EpubChecker에 관심 가져주셔서 감사합니다. 이 문서는 이슈를 올리거나 코드를 기여할 때 참고할 기본 규칙입니다.

## Before You Start

- 큰 변경(아키텍처, IPC 계약, 의존성 추가 등)을 준비 중이라면, PR을 올리기 전에 먼저 issue를 열어 방향을 논의해주세요.
- 이 프로젝트의 핵심 원칙은 [README의 Local-First Rule](./README.md#local-first-rule)입니다. EPUB 콘텐츠가 서버로 나가는 코드 경로는 추가하지 않습니다.

## Development Setup

```bash
npm install
npm run launcher:setup
npm run dev
```

빌드만 검증하려면:

```bash
npm run check
```

PR 올리기 전에 아래를 실행해주세요.

```bash
npm run check
npm run format:check
```

`npm run format:check`가 실패하면 `npm run format`으로 자동 정리한 뒤 diff를 확인해주세요.

## Code Guidelines

- 이 프로젝트는 TypeScript로 작성됩니다. main/preload/renderer 세 레이어의 경계를 지켜주세요 (자세한 내용은 [README Architecture](./README.md#architecture), renderer는 [docs/RENDERER_GUIDE.md](./docs/RENDERER_GUIDE.md) 참고).
- renderer는 Node API를 직접 사용하지 않습니다. main process 기능이 필요하면 `source/preload.ts`에 IPC를 추가하고, renderer에서는 `ElectronBridge`를 통해서만 접근합니다.
- preload API를 늘릴 때는 `source/preload.ts`, 관련 renderer type, `ElectronBridge`를 함께 맞춰주세요.
- 새 파일에는 하드코딩된 시크릿, API 키, 내부 서버 주소를 넣지 마세요.
- Prettier 설정(`.prettierrc.json`)을 따릅니다. 커밋 전 `npm run format`을 실행해주세요.

## Commit / PR

- 커밋 메시지는 무엇을 왜 바꿨는지 알 수 있게 작성해주세요.
- PR 설명에는 변경 배경과 테스트 방법(`npm run check` 결과 등)을 적어주세요.
- `launcher/`의 런타임 바이너리(JRE, EPUBCheck.jar, Chromium)는 커밋하지 않습니다. `dist/`도 커밋하지 않습니다.

## Reporting Bugs

이슈를 올릴 때는 다음을 포함해주시면 도움이 됩니다.

- OS/CPU 아키텍처 (Intel Mac / Apple Silicon / Windows)
- Node.js, Electron 버전
- 재현 절차와 기대 동작 vs 실제 동작
- 가능하다면 문제를 재현하는 최소 EPUB 파일 (개인정보/저작권이 없는 샘플로)

보안 관련 이슈는 이 문서 대신 [SECURITY.md](./SECURITY.md)를 따라 제보해주세요.

## License

기여하신 코드는 이 프로젝트의 라이선스인 [Apache License 2.0](./LICENSE)으로 배포됩니다.
