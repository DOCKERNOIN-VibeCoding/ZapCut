import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useEditor } from "./editor/store";
import * as actions from "./editor/actions";
import { renderTextAssets } from "./editor/exportAssets";
import { STICKERS } from "./library/stickers";
import { TEMPLATES } from "./library/templates";
import { TEXT_TEMPLATES } from "./library/textTemplates";
import "./styles.css";

// 자동 화면 검증(ZAPCUT_SCREENSHOT_JS)과 디버깅용
Object.assign(window, { __zapcutStore: useEditor, __zapcutActions: actions, __zapcutRenderTexts: renderTextAssets, __zapcutLib: { STICKERS, TEMPLATES, TEXT_TEMPLATES } });

createRoot(document.getElementById("root")!).render(<App />);
