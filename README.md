# ZapCut

오프라인 Windows 데스크톱 동영상 편집기. 한국어 UI가 기본입니다.
CapCut 데스크톱의 **관찰 가능한 동작**(화면 배치, 단축키, 편집 규칙)을 참고해 독립적으로 구현했습니다.
CapCut의 코드와 에셋은 사용하지 않습니다. 자세한 내용은 [docs/cleanroom/SPEC.ko.md](docs/cleanroom/SPEC.ko.md)를 보세요.

## 설치

`release/ZapCut-Setup-<버전>.exe`를 실행합니다. FFmpeg가 함께 들어 있어 따로 설치할 필요가 없습니다.

## 지금 되는 기능 (0.1.0, 1단계)

- 미디어 가져오기(버튼, 끌어 놓기, 탐색기 "연결 프로그램"), 썸네일, 필름스트립, 오디오 파형
- 다중 트랙 타임라인: **메인 트랙 자석**, 스냅, 이동, 트림, 분할(Ctrl+B), 왼쪽/오른쪽 삭제(Q/W), 복사/붙여넣기, 트랙 잠금/숨김/음소거, 실행취소/다시실행
- 실시간 미리보기 합성(비디오/이미지/텍스트), 화면 위에서 끌어 위치·크기 조절
- 변형(위치/크기/회전/불투명도), 기본 조정(밝기/대비/채도), 필터 프리셋 8종
- 오디오 볼륨(0~200%), 페이드 인/아웃, 배속 0.1~10배(음높이 유지)
- 텍스트(글꼴, 크기, 색, 외곽선, 배경, 정렬)와 스타일 프리셋 6종
- 화면 비율 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9
- 내보내기: MP4/MOV(H.264+AAC), 480p~4K, 24~60fps, **GPU 인코딩(NVENC/QSV/AMF) 자동 선택**(실패하면 CPU로 재시도)
- `.zapcut` 프로젝트 저장/열기, 자동 저장과 비정상 종료 후 복구

미리보기와 내보내기는 같은 기하 계산과 색 계산(CSS filter 행렬과 같은 FFmpeg 필터)을 공유하므로, 미리보기에서 본 결과가 그대로 출력됩니다.

## 단축키

| 키 | 동작 | 키 | 동작 |
| --- | --- | --- | --- |
| Space | 재생/정지 | Ctrl+B | 분할 |
| Delete | 삭제 | Q / W | 왼쪽 / 오른쪽 삭제 |
| ← / → (Shift: 1초) | 1프레임 이동 | ↑ / ↓ | 이전 / 다음 편집점 |
| Ctrl+Z / Ctrl+Shift+Z | 실행취소 / 다시실행 | Ctrl+C / V | 복사 / 붙여넣기 |
| Ctrl+휠, Ctrl+= / - | 타임라인 확대/축소 | N | 스냅 켜기/끄기 |
| Ctrl+I | 미디어 가져오기 | Ctrl+E | 내보내기 |
| Ctrl+S / Ctrl+Shift+S | 저장 / 다른 이름으로 저장 | Ctrl+O | 열기 |

## 개발

```powershell
npm install
npm run dev          # 개발 모드 (Vite + Electron, 핫 리로드)
npm test             # 단위 테스트 + 실제 ffmpeg 내보내기 통합 테스트
npm run typecheck
npm run dist:win     # release/ZapCut-Setup-x.y.z.exe 생성 (PATH의 ffmpeg를 번들)
```

- VS Code 확장 같은 일부 환경에는 `ELECTRON_RUN_AS_NODE=1`이 설정되어 있습니다. 이 경우 Electron이 Node로 실행되므로 변수를 해제한 뒤 실행하세요.
- 화면 확인 자동화: `ZAPCUT_SCREENSHOT=out.png`를 지정하면 로드 후 화면을 PNG로 저장하고 종료합니다. 명령줄 인자로 미디어 경로를 주면 자동으로 가져옵니다.

### 구조

| 경로 | 내용 |
| --- | --- |
| `src/core/` | 데이터 모델, 타임라인 연산(순수 함수), 렌더 계산, FFmpeg 내보내기 계획 |
| `src/editor/store.ts` | 상태 저장소(zustand), 실행취소 기록, 드래그 제스처 |
| `src/components/` | 상단바, 리소스 패널, 플레이어, 속성 패널, 타임라인, 내보내기 창 |
| `electron/` | 메인 프로세스(미디어 프로토콜, ffprobe/ffmpeg, 저장, 내보내기), 프리로드 |
| `tests/` | vitest 테스트 |
| `docs/cleanroom/` | 기능 명세서와 단계별 로드맵 |
| `REA/` | 리버스엔지니어링 도구(REA). 사용법: `REA/USAGE_GUIDE.ko.md` |

## 로드맵

2~4단계(전환 효과, 키프레임, LUT, 크로마키, 마스크, 스피드 램핑, 자동 자막, TTS, AI 배경 제거 등)는
[SPEC.ko.md §4](docs/cleanroom/SPEC.ko.md)에 정리되어 있습니다.

## 라이선스

ZapCut 소스: MIT. 번들된 FFmpeg: GPL v3 (gyan.dev full build).
