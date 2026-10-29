import { motionAt } from "../core/motion";
import { renderText } from "../core/textRender";
import type { Project } from "../core/types";

export type RenderedTexts = Record<string, { w: number; h: number; frames: { png: string; from: number; to: number }[] }>;

/** 텍스트 클립을 출력 해상도의 PNG로 렌더링 (미리보기와 같은 renderText). 타자기 효과는 글자 수가 바뀔 때마다 한 장씩 */
export function renderTextAssets(p: Project, H: number, fps: number) {
  const out: RenderedTexts = {};
  for (const t of p.tracks)
    for (const c of t.clips) {
      if (c.kind !== "text" || !c.text || t.hidden) continue;
      const typing = c.animIn?.id === "typewriter" || c.animOut?.id === "typewriter";
      if (!typing) {
        const canvas = renderText(c.text, H);
        out[c.id] = { w: canvas.width, h: canvas.height, frames: [{ png: canvas.toDataURL("image/png"), from: 0, to: c.duration }] };
        continue;
      }
      const total = [...c.text.content.replace(/\n/g, "")].length;
      const frames: { png: string; from: number; to: number }[] = [];
      let prev = -1;
      let w = 0;
      let h = 0;
      const steps = Math.max(1, Math.ceil(c.duration * fps));
      for (let i = 0; i <= steps; i++) {
        const T = Math.min(c.duration, i / fps);
        const count = Math.floor(total * motionAt(c, T).typing + 1e-6);
        if (count === prev && i < steps) continue;
        if (frames.length) frames[frames.length - 1].to = T;
        if (i === steps && count === prev) break;
        const canvas = renderText(c.text, H, total ? count / total : 1);
        w = canvas.width;
        h = canvas.height;
        frames.push({ png: canvas.toDataURL("image/png"), from: T, to: c.duration });
        prev = count;
      }
      out[c.id] = { w, h, frames: frames.filter((f) => f.to - f.from > 1e-4) };
    }
  return out;
}
