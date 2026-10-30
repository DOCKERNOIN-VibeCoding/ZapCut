// 전환 썸네일: 실제 전환과 같은 셰이더(TRANSITION_FS)로 그려 이름과 모양이 어긋나지 않게 한다.
// WebGL 문맥 하나를 모든 썸네일이 함께 쓰고, 결과를 각 썸네일 캔버스로 복사한다.
import { useEffect, useRef } from "react";
import { FULL_VS, TRANSITION_FS } from "../preview/shaders";

const W = 108;
const H = 76;
const LOOP_MS = 1400;

let renderer: ((kind: number, p: number) => HTMLCanvasElement) | null | undefined;

/** 썸네일용 A/B 장면: 색이 다른 그라데이션 위에 큰 글자 */
function scene(from: string, to: string, label: string) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `800 ${H * 0.6}px "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, W / 2, H / 2 + 2);
  return c;
}

function createRenderer() {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, premultipliedAlpha: false });
  if (!gl) return null;
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, FULL_VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, TRANSITION_FS));
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  [scene("#f4a259", "#e8735a", "A"), scene("#4f8fd6", "#2a5ea8", "B")].forEach((img, i) => {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  });
  const u = (n: string) => gl.getUniformLocation(prog, n);
  gl.uniform1i(u("u_a"), 0);
  gl.uniform1i(u("u_b"), 1);
  gl.uniform2f(u("u_res"), W, H);
  gl.uniform4f(u("u_rect"), 0, 0, W, H);
  // 셰이더 좌표는 위가 0이므로 화면에 바로 그릴 때는 뒤집는다
  gl.uniform1f(u("u_flipY"), 1);
  gl.viewport(0, 0, W, H);
  return (kind: number, p: number) => {
    gl.uniform1i(u("u_kind"), kind);
    gl.uniform1f(u("u_p"), p);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return canvas;
  };
}

function draw(target: HTMLCanvasElement, kind: number, p: number) {
  if (renderer === undefined) renderer = createRenderer();
  if (!renderer) return;
  target.getContext("2d")!.drawImage(renderer(kind, p), 0, 0);
}

/** 평소에는 시작 장면, 마우스를 올리면 전환을 반복 재생 */
export function TransitionThumb({ kind }: { kind: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  useEffect(() => {
    draw(ref.current!, kind, 0);
    return () => cancelAnimationFrame(raf.current);
  }, [kind]);
  const play = () => {
    const t0 = performance.now();
    const loop = (now: number) => {
      // 앞뒤로 잠깐 멈춘 뒤 진행
      const phase = ((now - t0) % LOOP_MS) / LOOP_MS;
      draw(ref.current!, kind, Math.min(1, Math.max(0, (phase - 0.15) / 0.7)));
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  };
  const stop = () => {
    cancelAnimationFrame(raf.current);
    draw(ref.current!, kind, 0);
  };
  return <canvas ref={ref} width={W} height={H} className="tr-thumb" onMouseEnter={play} onMouseLeave={stop} />;
}
