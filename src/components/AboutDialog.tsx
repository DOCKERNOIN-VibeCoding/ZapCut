import { Beer, Copy, Github, RefreshCw, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import type { ControlInfo, Settings } from "../../electron/control";
import pkg from "../../package.json";

const REPO = "https://github.com/DOCKERNOIN-VibeCoding/ZapCut";
const DONATE = "https://buymeacoffee.com/dockernoin";

// 설치본에 들어 있는 오픈 소스. license = 정보 창에서 여는 라이선스 문서 (electron/main.ts LICENSE_FILES)
const CREDITS: { name: string; use: string; license: string; key: string; url: string; source?: string }[] = [
  { name: "FFmpeg", use: "영상 분석·변환·내보내기 (gyan.dev 빌드)", license: "GPL v3", key: "ffmpeg", url: "https://ffmpeg.org", source: "https://www.gyan.dev/ffmpeg/builds/" },
  { name: "Electron", use: "데스크톱 앱 (Chromium 포함)", license: "MIT", key: "electron", url: "https://www.electronjs.org" },
  { name: "Chromium", use: "화면 표시·미리보기", license: "BSD 외", key: "chromium", url: "https://www.chromium.org" },
  { name: "React", use: "화면 구성", license: "MIT", key: "thirdParty", url: "https://react.dev" },
  { name: "zustand", use: "편집 상태 관리", license: "MIT", key: "thirdParty", url: "https://github.com/pmndrs/zustand" },
  { name: "Lucide", use: "아이콘", license: "ISC", key: "thirdParty", url: "https://lucide.dev" },
  { name: "electron-updater", use: "자동 업데이트", license: "MIT", key: "thirdParty", url: "https://www.electron.build/auto-update" },
  { name: "MCP TypeScript SDK", use: "외부 제어(MCP) 서버", license: "MIT", key: "thirdParty", url: "https://github.com/modelcontextprotocol/typescript-sdk" },
  { name: "Zod", use: "외부 제어 명령 검사", license: "MIT", key: "thirdParty", url: "https://zod.dev" },
  { name: "ONNX Runtime Web", use: "얼굴 찾기 모델 실행", license: "MIT", key: "thirdParty", url: "https://onnxruntime.ai" },
  { name: "YuNet", use: "얼굴 찾기 모델 (OpenCV Zoo)", license: "MIT", key: "yunet", url: "https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet" },
  { name: "Pretendard", use: "글꼴", license: "OFL 1.1", key: "pretendard", url: "https://github.com/orioncactus/pretendard" },
  { name: "Bebas Neue", use: "글꼴", license: "OFL 1.1", key: "bebas", url: "https://github.com/dharmatype/Bebas-Neue" },
  { name: "Pacifico", use: "글꼴", license: "OFL 1.1", key: "pacifico", url: "https://github.com/googlefonts/Pacifico" },
];

type Check = Awaited<ReturnType<typeof window.zapcut.checkUpdate>> | { state: "checking" };

function checkText(c: Check) {
  switch (c.state) {
    case "checking":
      return "확인하는 중…";
    case "latest":
      return "최신 버전입니다";
    case "available":
      return `새 버전 v${c.version}을 받고 있습니다. 다 받으면 상단바에 설치 버튼이 나옵니다`;
    case "dev":
      return "개발 모드에서는 업데이트를 확인하지 않습니다";
    case "error":
      return `확인하지 못했습니다: ${c.message}`;
  }
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [check, setCheck] = useState<Check>();
  const [settings, setSettings] = useState<Settings>();
  const [info, setInfo] = useState<ControlInfo>();
  const [copied, setCopied] = useState<string>();
  useEffect(() => {
    window.zapcut.getSettings().then(setSettings);
    window.zapcut.controlInfo().then(setInfo);
  }, []);
  const toggleControl = async (on: boolean) => {
    setSettings(await window.zapcut.setSettings({ control: on }));
    setInfo(await window.zapcut.controlInfo());
  };
  const copy = (what: string, text: string) => navigator.clipboard.writeText(text).then(() => setCopied(what));
  const open = (key: string) =>
    window.zapcut.openLicense(key).then((err) => {
      if (err) alert(`라이선스 문서를 열 수 없습니다: ${err}`);
    });
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal about">
        <div className="modal-head">
          <h3>ZapCut 정보</h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="about-head">
            <Zap size={34} className="brand-icon" />
            <div>
              <div className="about-name">
                ZapCut <span className="version-badge">{pkg.displayVersion}</span>
              </div>
              <div className="muted small">버전 {pkg.version}</div>
              <div className="small">Copyright © 2026 DOCKERNOIN</div>
            </div>
          </div>
          <div className="about-actions">
            <button className="ghost-btn" onClick={() => window.open(REPO)}>
              <Github size={14} /> GitHub
            </button>
            <button
              className="ghost-btn"
              disabled={check?.state === "checking"}
              onClick={() => {
                setCheck({ state: "checking" });
                window.zapcut.checkUpdate().then(setCheck);
              }}
            >
              <RefreshCw size={14} /> 업데이트 확인
            </button>
            <button className="link tiny" onClick={() => open("zapcut")}>
              MIT 라이선스
            </button>
          </div>
          <button className="beer-btn" onClick={() => window.open(DONATE)} title="Buy Me a Coffee 페이지가 브라우저에서 열립니다">
            <Beer size={16} /> 개발자에게 맥주 한 잔 사주기 <span className="muted small">Buy Me a Beer · $3</span>
          </button>
          {check && <p className="muted small">{checkText(check)}</p>}

          <h4 className="about-sub">외부 제어 (MCP)</h4>
          <label className="check">
            <input type="checkbox" checked={!!settings?.control} onChange={(e) => toggleControl(e.target.checked)} /> Claude 같은 외부 프로그램이 이 프로그램을 조종할 수 있게 허용
          </label>
          <p className="muted small">
            {settings?.control
              ? `이 PC 안에서만 연결할 수 있습니다 (포트 ${info?.port ?? "…"}). Claude Code 터미널에서 아래 명령을 한 번 실행해 등록하세요.`
              : "켜면 이 PC 안에서만 연결할 수 있는 통로가 열립니다. Claude가 미디어 가져오기·편집·내보내기를 대신할 수 있습니다."}
          </p>
          {settings?.control && info && (
            <div className="cmd-row">
              <code className="cmd">{info.command}</code>
              <button className="ghost-btn" onClick={() => copy("command", info.command)} title="등록 명령 복사">
                <Copy size={14} /> {copied === "command" ? "복사됨" : "복사"}
              </button>
              <button className="ghost-btn" onClick={() => copy("json", info.json)} title="Claude Desktop 등 설정 파일(JSON)용으로 복사">
                {copied === "json" ? "복사됨" : "JSON"}
              </button>
            </div>
          )}

          <h4 className="about-sub">오픈 소스 크레딧</h4>
          <ul className="credits">
            {CREDITS.map((c) => (
              <li key={c.name}>
                <button className="link" onClick={() => window.open(c.url)}>
                  {c.name}
                </button>
                <span className="muted small">{c.use}</span>
                <span className="credit-links">
                  <button className="link tiny" onClick={() => open(c.key)} title="라이선스 문서 열기">
                    {c.license}
                  </button>
                  {c.source && (
                    <button className="link tiny" onClick={() => window.open(c.source)} title="GPL 소스 받는 곳">
                      소스
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <button className="link tiny" onClick={() => open("thirdParty")}>
            포함된 오픈 소스 라이선스 전체 보기
          </button>
        </div>
      </div>
    </div>
  );
}
