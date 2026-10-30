// 타이틀 템플릿 썸네일: 실제 출력과 같은 renderTitle로 그린다. 평소에는 다 나타난 모습, 마우스를 올리면 등장을 반복 재생
import { useEffect, useMemo, useRef } from "react";
import { instantiateTitle, renderTitle, titleExtent, titleTiming } from "../core/titles";
import type { TitleTemplate } from "../library/titleTemplates";

const W = 232;
const H = 132;

export function TitleThumb({ def }: { def: TitleTemplate }) {
  const title = useMemo(() => instantiateTitle(def), [def]);
  const ref = useRef<HTMLCanvasElement>(null);
  const off = useRef<HTMLCanvasElement>(undefined);
  const raf = useRef(0);
  const D = def.duration ?? 4;
  const { inEnd } = titleTiming(title, D);

  const draw = (T: number) => {
    const ext = titleExtent(title);
    const k = Math.min((W - 16) / ext.w, (H - 16) / ext.h);
    off.current ??= document.createElement("canvas");
    const img = renderTitle(title, T, D, 1080 * k, off.current);
    const ctx = ref.current!.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, (W - img.width) / 2, (H - img.height) / 2);
  };

  useEffect(() => {
    draw(inEnd);
    return () => cancelAnimationFrame(raf.current);
  }, [title]);

  const play = () => {
    const t0 = performance.now();
    const loop = (now: number) => {
      draw(((now - t0) / 1000) % (inEnd + 0.8));
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  };
  const stop = () => {
    cancelAnimationFrame(raf.current);
    draw(inEnd);
  };
  return <canvas ref={ref} width={W} height={H} className="title-thumb" onMouseEnter={play} onMouseLeave={stop} />;
}
