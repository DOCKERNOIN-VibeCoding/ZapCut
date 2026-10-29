# 짭컷 (ZapCut)

오프라인 Windows 데스크톱 동영상 편집기. 한국어 UI가 기본이며, 프로그램 화면에는 ZapCut으로 표시됩니다.
CapCut 데스크톱의 **관찰 가능한 동작**(화면 배치, 단축키, 편집 규칙)을 참고해 독립적으로 구현했습니다.
CapCut의 코드와 에셋은 사용하지 않습니다. 자세한 내용은 [docs/cleanroom/SPEC.ko.md](docs/cleanroom/SPEC.ko.md)를 보세요.

## 설치

`release/ZapCut-Setup-Dev-v0.1.exe`를 실행합니다. 서명되지 않은 개발 버전이라 Windows SmartScreen 경고가 나올 수 있습니다(추가 정보 → 실행). FFmpeg가 함께 들어 있어 따로 설치할 필요가 없습니다.

## 지금 되는 기능 (Dev v0.1)

**편집 기본 (1단계)**
- 미디어 가져오기(버튼, 끌어 놓기, 탐색기 "연결 프로그램"), 썸네일, 필름스트립, 파형, HEVC 등은 자동 프록시
- 다중 트랙 타임라인: 메인 트랙 자석, 스냅, 이동/트림/분할(Ctrl+B), Q/W, 복사/붙여넣기, 트랙 잠금·숨김·음소거, 실행취소
- 배속 0.1~10배(음높이 유지), 볼륨 0~200%, 페이드, `.zapcut` 저장/자동 복구

**CapCut식 기능 (2단계)**
- 전환 25종, 효과 31종(효과 트랙), 조정 레이어
- 필터 43종 + 조정 13항목 + 외부 .cube LUT
- 키프레임(위치·크기·회전·불투명도·볼륨, 이징 5종), 등장/퇴장/반복 애니메이션 41종
- 마스크(선형·거울·원·사각), 크로마키 배경 제거, 블렌드 모드 9종, 자르기, 반전, 캔버스 블러
- 정지 화면, 역재생
- 텍스트: 그라데이션·그림자·네온·박스, 타자기 효과, 텍스트 템플릿 31종
- 직접 그린 스티커 56종, FFmpeg로 합성하는 효과음 18종·배경음악 5종
- **영상 템플릿 16종**: 가져온 사진·영상을 슬롯에 넣고 전환·필터·카메라 움직임·텍스트·효과·스티커·음악을 한 번에 적용

**미리보기와 내보내기가 같은 결과**
- 미리보기는 WebGL로 합성하고, 내보내기는 FFmpeg 필터 그래프로 렌더링합니다. 색(3D LUT), 움직임(수식), 마스크(수식)는 같은 데이터를 공유하고, 전환·효과는 실측으로 맞췄습니다.
- 내보내기: MP4/MOV(H.264+AAC), 480p~4K, 24~60fps, GPU 인코딩(NVENC/QSV/AMF) 자동 선택

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
npm run dist:win     # release/ZapCut-Setup-Dev-v0.1.exe 생성 (PATH의 ffmpeg를 번들)
```

- VS Code 확장 같은 일부 환경에는 `ELECTRON_RUN_AS_NODE=1`이 설정되어 있습니다. 이 경우 Electron이 Node로 실행되므로 변수를 해제한 뒤 실행하세요.
- 화면 확인 자동화: `ZAPCUT_SCREENSHOT=out.png`를 지정하면 로드 후 화면을 PNG로 저장하고 종료합니다. 명령줄 인자로 미디어 경로를 주면 자동으로 가져오고, `ZAPCUT_SCREENSHOT_JS`로 캡처 전에 앱을 조작할 수 있습니다(`window.__zapcutStore` 등).

### 브랜치

- `main`: 검증을 마친 버전
- `dev/v0.1`: Dev v0.1 개발 브랜치 (다음 버전은 `dev/v0.2`)

### 구조

| 경로 | 내용 |
| --- | --- |
| `src/core/` | 데이터 모델, 타임라인 연산, 수식 해석기, 모션·색·마스크·효과·전환, FFmpeg 내보내기 계획 |
| `src/preview/` | WebGL 미리보기 합성기와 셰이더, 프레임 빌더 |
| `src/library/` | 스티커·효과음·텍스트 템플릿·영상 템플릿 |
| `src/editor/` | 상태 저장소(실행취소·제스처·키프레임), 비동기 동작(템플릿·스티커·소리·정지 화면·역재생) |
| `src/components/` | 상단바, 리소스 패널, 플레이어, 속성 패널, 타임라인, 내보내기 창 |
| `electron/` | 메인 프로세스(미디어 프로토콜, ffprobe/ffmpeg, 저장, 내보내기), 프리로드 |
| `tests/` | vitest 테스트 |
| `docs/cleanroom/` | 기능 명세서와 단계별 로드맵 |
| `REA/` | 리버스엔지니어링 도구(morluto/rea). 저장소에는 포함하지 않으며 별도로 받습니다 |

## 로드맵

3~4단계(스피드 램핑, 자동 자막, TTS, 노이즈 제거, AI 배경 제거, 자동 업데이트 등)는
[SPEC.ko.md §4](docs/cleanroom/SPEC.ko.md)에 정리되어 있습니다.

## 라이선스

짭컷 소스: MIT. 번들된 FFmpeg: GPL v3 (gyan.dev full build).

CapCut은 해당 소유자의 상표입니다. 짭컷(ZapCut)은 CapCut 및 그 개발사와 관련이 없는 독립 프로젝트입니다.
