import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useEditor } from "./editor/store";
import * as actions from "./editor/actions";
import { renderTextAssets } from "./editor/exportAssets";
import { STICKERS } from "./library/stickers";
import { TEMPLATES } from "./library/templates";
import { TEXT_TEMPLATES } from "./library/textTemplates";
import { TITLE_TEMPLATES } from "./library/titleTemplates";
import * as titles from "./core/titles";
import "./styles.css";

// 자동 화면 검증(ZAPCUT_SCREENSHOT_JS)과 디버깅용
Object.assign(window, { __zapcutStore: useEditor, __zapcutActions: actions, __zapcutRenderTexts: renderTextAssets, __zapcutLib: { STICKERS, TEMPLATES, TEXT_TEMPLATES, TITLE_TEMPLATES }, __zapcutTitles: titles });

// 텍스트는 캔버스에 그리므로 번들 글꼴을 먼저 불러 둔다 (늦게 오면 첫 화면이 다른 글꼴로 그려짐)
const BUNDLED = ["400 16px Pretendard", "500 16px Pretendard", "800 16px Pretendard", "900 16px Pretendard", '16px "Bebas Neue"', "16px Pacifico"];
Promise.all(BUNDLED.map((f) => document.fonts.load(f)))
  .catch(() => undefined)
  .then(() => createRoot(document.getElementById("root")!).render(<App />));
