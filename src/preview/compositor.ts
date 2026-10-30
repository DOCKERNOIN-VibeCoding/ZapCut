// WebGL2 미리보기 합성기. 내보내기 그래프와 같은 순서로 그린다:
// 배경 → 메인 트랙(캔버스 배경 + 레이어, 전환) → 위쪽 항목(레이어/블렌드/효과/조정)
import { bakeLut, clipColorFn, type CubeLut } from "../core/color";
import { duoColor, findEffect, defaultParams } from "../core/effects";
import { compile } from "../core/expr";
import { hasMask, maskAt, maskExpr } from "../core/mask";
import { renderText } from "../core/textRender";
import { renderTitle, titleTiming } from "../core/titles";
import { transitionRect } from "../core/transitions";
import type { BlendMode, Clip, Mask } from "../core/types";
import type { Frame, LayerDraw } from "./frame";
import { BLEND_FS, BLUR_FS, COPY_FS, EFFECT_FS, FULL_VS, LAYER_FS, LAYER_VS, TRANSITION_FS } from "./shaders";

export type SourceProvider = (layer: LayerDraw) => TexImageSource | undefined;

interface FBO {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

const BLEND_IDS: Record<BlendMode, number> = { normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5, addition: 6, difference: 7, exclusion: 8 };

export interface LayerBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
}

const titleKeys = new WeakMap<object, string>();
const titleKey = (t: object) => {
  let k = titleKeys.get(t);
  if (!k) titleKeys.set(t, (k = JSON.stringify(t)));
  return k;
};

export class Compositor {
  gl: WebGL2RenderingContext;
  private progs: Record<string, { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> }> = {};
  private quad: WebGLBuffer;
  private fbos: Record<string, FBO> = {};
  private texCache = new Map<string, { tex: WebGLTexture; key: string; w: number; h: number }>();
  private lutCache = new Map<string, { tex: WebGLTexture; n: number }>();
  private maskCache = new Map<string, WebGLTexture>();
  private textCanvas = new Map<string, { canvas: HTMLCanvasElement; key: string }>();
  externalLuts = new Map<string, CubeLut>();
  W = 0;
  H = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error("WebGL2를 사용할 수 없습니다");
    this.gl = gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    this.program("copy", FULL_VS, COPY_FS);
    this.program("layer", LAYER_VS, LAYER_FS);
    this.program("blend", FULL_VS, BLEND_FS);
    this.program("blur", FULL_VS, BLUR_FS);
    this.program("effect", FULL_VS, EFFECT_FS);
    this.program("transition", FULL_VS, TRANSITION_FS);
  }

  private program(name: string, vs: string, fs: string) {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${name} 셰이더 오류: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, "a_pos");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name} 링크 오류: ${gl.getProgramInfoLog(p)}`);
    this.progs[name] = { p, u: new Map() };
  }

  private use(name: string) {
    const pr = this.progs[name];
    this.gl.useProgram(pr.p);
    const loc = (n: string) => {
      if (!pr.u.has(n)) pr.u.set(n, this.gl.getUniformLocation(pr.p, n));
      return pr.u.get(n)!;
    };
    const gl = this.gl;
    return {
      f: (n: string, ...v: number[]) => {
        const l = loc(n);
        if (v.length === 1) gl.uniform1f(l, v[0]);
        else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
        else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
        else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
      },
      i: (n: string, v: number) => gl.uniform1i(loc(n), v),
    };
  }

  private fbo(name: string): FBO {
    const gl = this.gl;
    let f = this.fbos[name];
    if (f && f.w === this.W && f.h === this.H) return f;
    if (f) {
      gl.deleteFramebuffer(f.fb);
      gl.deleteTexture(f.tex);
    }
    const tex = this.newTex();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.W, this.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    f = { fb, tex, w: this.W, h: this.H };
    this.fbos[name] = f;
    return f;
  }

  private newTex() {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private target(f: FBO | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f ? f.fb : null);
    gl.viewport(0, 0, this.W, this.H);
  }

  private bindTex(unit: number, tex: WebGLTexture, target: number = this.gl.TEXTURE_2D) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, tex);
  }

  private drawQuad() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** 전체 화면 패스: src → dst */
  private pass(prog: string, dst: FBO | null, setup: (u: ReturnType<Compositor["use"]>) => void, flipY = false) {
    const gl = this.gl;
    this.target(dst);
    gl.disable(gl.BLEND);
    const u = this.use(prog);
    u.f("u_flipY", flipY ? 1 : 0);
    setup(u);
    this.drawQuad();
  }

  private clear(f: FBO, color: string) {
    const gl = this.gl;
    this.target(f);
    const c = color.startsWith("#") ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255) : [0, 0, 0];
    gl.clearColor(c[0], c[1], c[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private blur(src: FBO, sigma: number, out: string): FBO {
    const tmp = this.fbo(`${out}_tmp`);
    const dst = this.fbo(out);
    this.pass("blur", tmp, (u) => {
      this.bindTex(0, src.tex);
      u.i("u_tex", 0);
      u.f("u_dir", 1 / this.W, 0);
      u.f("u_sigma", sigma);
    });
    this.pass("blur", dst, (u) => {
      this.bindTex(0, tmp.tex);
      u.i("u_tex", 0);
      u.f("u_dir", 0, 1 / this.H);
      u.f("u_sigma", sigma);
    });
    return dst;
  }

  // ── 텍스처 소스 ──
  private sourceTex(layer: LayerDraw, provide: SourceProvider): { tex: WebGLTexture; w: number; h: number } | undefined {
    const gl = this.gl;
    const clip = layer.clip;
    let key: string;
    let src: TexImageSource | undefined;
    let dynamic = false;
    if (clip.kind === "text" && clip.title) {
      // 타이틀: 움직이는 구간에서만 프레임마다(1/60초) 다시 그린다
      const { inEnd, outStart, loop } = titleTiming(clip.title, clip.duration);
      const T = Math.min(clip.duration, Math.max(0, layer.T));
      const frame = loop || T < inEnd || T >= outStart ? Math.round(T * 60) : "S";
      key = `${titleKey(clip.title)}|${this.H}|${clip.duration}|${frame}`;
      let entry = this.textCanvas.get(clip.id);
      if (!entry || entry.key !== key) {
        const canvas = renderTitle(clip.title, frame === "S" ? inEnd : T, clip.duration, this.H, entry?.canvas);
        entry = { canvas, key };
        this.textCanvas.set(clip.id, entry);
      }
      src = entry.canvas;
    } else if (clip.kind === "text" && clip.text) {
      const fraction = layer.m.typing < 1 ? Math.floor(layer.m.typing * 200) / 200 : 1;
      key = `${JSON.stringify(clip.text)}|${this.H}|${fraction}`;
      let entry = this.textCanvas.get(clip.id);
      if (!entry || entry.key !== key) {
        const canvas = renderText(clip.text, this.H, layer.m.typing, entry?.canvas);
        entry = { canvas, key };
        this.textCanvas.set(clip.id, entry);
      }
      src = entry.canvas;
    } else {
      src = provide(layer);
      key = clip.kind === "image" ? `img:${clip.mediaId}` : `vid:${clip.id}`;
      dynamic = clip.kind === "video";
    }
    const id = clip.kind === "image" ? `img:${clip.mediaId}` : clip.id;
    let entry = this.texCache.get(id);
    // 영상이 탐색(seek) 중이라 새 프레임이 없으면 직전 프레임을 그대로 쓴다 (화면이 검게 깜빡이지 않도록)
    if (!src) return entry;
    const w = (src as HTMLVideoElement).videoWidth || (src as HTMLImageElement).naturalWidth || (src as HTMLCanvasElement).width;
    const h = (src as HTMLVideoElement).videoHeight || (src as HTMLImageElement).naturalHeight || (src as HTMLCanvasElement).height;
    if (!w || !h) return undefined;
    if (!entry) {
      entry = { tex: this.newTex(), key: "", w, h };
      this.texCache.set(id, entry);
    }
    if (dynamic || entry.key !== key) {
      this.bindTex(0, entry.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      entry.key = key;
      entry.w = w;
      entry.h = h;
    }
    return entry;
  }

  private lutTex(clip: Clip): { tex: WebGLTexture; n: number } | undefined {
    const ext = clip.lut ? this.externalLuts.get(clip.lut.path) : undefined;
    const key = JSON.stringify([clip.adjust, clip.filter, clip.lut, !!ext]);
    const cached = this.lutCache.get(clip.id + key);
    if (cached) return cached;
    const fn = clipColorFn(clip, ext && clip.lut ? { lut: ext, intensity: clip.lut.intensity } : undefined);
    if (!fn) return undefined;
    const lut = bakeLut(fn);
    const n = lut.size;
    const rgba = new Float32Array(n * n * n * 4);
    for (let i = 0, j = 0; i < lut.data.length; i += 3, j += 4) {
      rgba[j] = lut.data[i];
      rgba[j + 1] = lut.data[i + 1];
      rgba[j + 2] = lut.data[i + 2];
      rgba[j + 3] = 1;
    }
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, n, n, n, 0, gl.RGBA, gl.FLOAT, rgba);
    // 같은 클립의 이전 LUT 정리
    for (const [k, v] of this.lutCache)
      if (k.startsWith(clip.id)) {
        gl.deleteTexture(v.tex);
        this.lutCache.delete(k);
      }
    const entry = { tex, n };
    this.lutCache.set(clip.id + key, entry);
    return entry;
  }

  /** 마스크 수식을 텍스처로 (내보내기 geq와 같은 수식) */
  private maskTex(mask: Mask, aspect: number): WebGLTexture {
    const key = JSON.stringify(mask) + aspect.toFixed(3);
    const cached = this.maskCache.get(key);
    if (cached) return cached;
    const max = 256;
    const w = aspect >= 1 ? max : Math.max(8, Math.round(max * aspect));
    const h = aspect >= 1 ? Math.max(8, Math.round(max / aspect)) : max;
    const f = compile(maskExpr(mask));
    const data = new Uint8Array(w * h);
    const v = { X: 0, Y: 0, W: w, H: h };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        v.X = x + 0.5;
        v.Y = y + 0.5;
        data[y * w + x] = Math.round(255 * Math.min(1, Math.max(0, f(v))));
      }
    const gl = this.gl;
    const tex = this.newTex();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    // 움직이는 마스크는 프레임마다 새로 만들어지므로 오래된 텍스처를 지운다
    if (this.maskCache.size > 64) {
      for (const t of this.maskCache.values()) gl.deleteTexture(t);
      this.maskCache.clear();
    }
    this.maskCache.set(key, tex);
    return tex;
  }

  /** 레이어의 화면상 상자 (캔버스 픽셀) */
  layerBox(layer: LayerDraw, srcW: number, srcH: number): LayerBox {
    const clip = layer.clip;
    let w: number;
    let h: number;
    if (clip.kind === "text") {
      w = srcW * layer.m.scale;
      h = srcH * layer.m.scale;
    } else {
      const cr = clip.crop ?? { l: 0, t: 0, r: 0, b: 0 };
      const sw = srcW * (1 - cr.l - cr.r);
      const sh = srcH * (1 - cr.t - cr.b);
      const fit = Math.min(this.W / sw, this.H / sh);
      w = sw * fit * layer.m.scale;
      h = sh * fit * layer.m.scale;
    }
    return { cx: this.W / 2 + layer.m.x * this.W, cy: this.H / 2 + layer.m.y * this.H, w, h, rot: layer.m.rotation };
  }

  /** 레이어를 dst에 그린다 (일반 알파 합성) */
  private drawLayer(layer: LayerDraw, dst: FBO, provide: SourceProvider, boxes?: Map<string, LayerBox>) {
    const gl = this.gl;
    const src = this.sourceTex(layer, provide);
    if (!src) return;
    const clip = layer.clip;
    const media = layer.media;
    const srcW = clip.kind === "text" ? src.w : media?.width || src.w;
    const srcH = clip.kind === "text" ? src.h : media?.height || src.h;
    const box = this.layerBox(layer, srcW, srcH);
    boxes?.set(clip.id, box);
    this.target(dst);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const u = this.use("layer");
    u.f("u_res", this.W, this.H);
    u.f("u_center", box.cx, box.cy);
    u.f("u_size", box.w, box.h);
    u.f("u_rot", (box.rot * Math.PI) / 180);
    this.bindTex(0, src.tex);
    u.i("u_tex", 0);
    u.f("u_texel", 1 / src.w, 1 / src.h);
    const cr = clip.kind === "text" ? { l: 0, t: 0, r: 0, b: 0 } : (clip.crop ?? { l: 0, t: 0, r: 0, b: 0 });
    u.f("u_crop", cr.l, cr.t, cr.r, cr.b);
    u.f("u_flip", clip.flipH ? 1 : 0, clip.flipV ? 1 : 0);
    u.f("u_opacity", layer.m.opacity);
    const isMedia = clip.kind === "video" || clip.kind === "image";
    u.f("u_sharpen", isMedia ? clip.adjust.sharpen ?? 0 : 0);
    u.f("u_vignette", isMedia ? clip.adjust.vignette ?? 0 : 0);
    u.f("u_srcSize", srcW * (1 - cr.l - cr.r), srcH * (1 - cr.t - cr.b));
    const ch = isMedia && clip.chroma?.enabled ? clip.chroma : undefined;
    u.i("u_chroma", ch ? 1 : 0);
    if (ch) {
      const r = parseInt(ch.color.slice(1, 3), 16), g = parseInt(ch.color.slice(3, 5), 16), b = parseInt(ch.color.slice(5, 7), 16);
      u.f("u_keyUV", -0.148223 * r - 0.290993 * g + 0.439216 * b + 128, 0.439216 * r - 0.367788 * g - 0.071427 * b + 128);
      u.f("u_sim", ch.similarity);
      u.f("u_blend", ch.blend);
    }
    const lut = isMedia ? this.lutTex(clip) : undefined;
    u.i("u_hasLut", lut ? 1 : 0);
    if (lut) {
      this.bindTex(1, lut.tex, gl.TEXTURE_3D);
      u.i("u_lut", 1);
      u.f("u_lutN", lut.n);
    } else u.i("u_lut", 1);
    const mask = isMedia && hasMask(clip.mask) ? this.maskTex(maskAt(clip, layer.T), (srcW * (1 - cr.l - cr.r)) / (srcH * (1 - cr.t - cr.b))) : undefined;
    u.i("u_hasMask", mask ? 1 : 0);
    if (mask) this.bindTex(2, mask);
    u.i("u_mask", 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    // 레이어 VS는 -0.5..0.5 사각형을 기대하므로 [-1,1] 버퍼를 절반으로
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.drawHalfQuad();
  }

  private halfQuad?: WebGLBuffer;
  private drawHalfQuad() {
    const gl = this.gl;
    if (!this.halfQuad) {
      this.halfQuad = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.halfQuad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.halfQuad);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** 메인 트랙 클립: 캔버스 배경(색/블러) + 레이어 */
  private drawMainClip(layer: LayerDraw, dst: FBO, bg: string, provide: SourceProvider, boxes: Map<string, LayerBox>) {
    const cv = layer.clip.canvas;
    this.clear(dst, cv?.type === "color" ? cv.color : bg);
    if (cv?.type === "blur") {
      const src = this.sourceTex(layer, provide);
      if (src) {
        const tmp = this.fbo("cover");
        this.clear(tmp, bg);
        // 화면을 꽉 채우도록(cover) 그린 뒤 흐리게
        const cover = Math.max(this.W / src.w, this.H / src.h);
        const coverLayer: LayerDraw = { ...layer, clip: { ...layer.clip, crop: undefined, flipH: false, flipV: false, mask: undefined, chroma: undefined }, m: { ...layer.m, x: 0, y: 0, rotation: 0, opacity: 1, scale: (cover / Math.min(this.W / src.w, this.H / src.h)) } };
        this.drawLayer(coverLayer, tmp, provide);
        const blurred = this.blur(tmp, Math.max(1, cv.blur * 60 * (this.H / 1080)), "coverBlur");
        this.pass("copy", dst, (u) => {
          this.bindTex(0, blurred.tex);
          u.i("u_tex", 0);
        });
      }
    }
    this.drawLayer(layer, dst, provide, boxes);
  }

  render(frame: Frame, background: string, provide: SourceProvider): Map<string, LayerBox> {
    const boxes = new Map<string, LayerBox>();
    let acc = this.fbo("accA");
    let alt = this.fbo("accB");
    this.clear(acc, background);
    const swap = () => ([acc, alt] = [alt, acc]);

    // 메인 트랙
    if (frame.main?.type === "single") {
      const mf = this.fbo("mainA");
      this.drawMainClip(frame.main.layer, mf, background, provide, boxes);
      this.pass("copy", acc, (u) => {
        this.bindTex(0, mf.tex);
        u.i("u_tex", 0);
      });
    } else if (frame.main?.type === "transition") {
      const { a, b, kind, p } = frame.main;
      const fa = this.fbo("mainA");
      const fb = this.fbo("mainB");
      this.drawMainClip(a, fa, background, provide, boxes);
      this.drawMainClip(b, fb, background, provide, boxes);
      this.pass("transition", acc, (u) => {
        this.bindTex(0, fa.tex);
        this.bindTex(1, fb.tex);
        u.i("u_a", 0);
        u.i("u_b", 1);
        u.i("u_kind", kind);
        u.f("u_p", p);
        u.f("u_res", this.W, this.H);
        u.f("u_rect", 0, 0, this.W, this.H);
      });
    }

    for (const item of frame.items) {
      if (item.type === "layer") {
        const blend = item.layer.clip.blend ?? "normal";
        if (blend === "normal") this.drawLayer(item.layer, acc, provide, boxes);
        else {
          const lf = this.fbo("layer");
          this.target(lf);
          this.gl.clearColor(0, 0, 0, 0);
          this.gl.clear(this.gl.COLOR_BUFFER_BIT);
          this.drawLayer(item.layer, lf, provide, boxes);
          this.pass("blend", alt, (u) => {
            this.bindTex(0, acc.tex);
            this.bindTex(1, lf.tex);
            u.i("u_base", 0);
            u.i("u_layer", 1);
            u.i("u_mode", BLEND_IDS[blend]);
          });
          swap();
        }
      } else if (item.type === "effect") {
        const def = findEffect(item.clip.effect?.id);
        if (!def) continue;
        const prm = { ...defaultParams(def), ...item.clip.effect!.params };
        const k = this.H / 1080;
        let aux: FBO | undefined;
        if (def.kind === 1) aux = this.blur(acc, Math.max(0.01, (prm.strength ?? 0) * 30 * k), "fxBlur");
        if (def.kind === 40) aux = this.blur(acc, Math.max(0.5, 25 * k), "fxBlur");
        if (def.kind === 44) aux = this.blur(acc, Math.max(0.5, 40 * k), "fxBlur");
        // u_a = 강도/크기, u_b = 속도/단계 (스케치는 선 진하기)
        const a = prm.strength ?? prm.size ?? 0;
        const b = def.id === "sketch" ? prm.strength : (prm.speed ?? prm.levels ?? 0);
        this.pass("effect", alt, (u) => {
          this.bindTex(0, acc.tex);
          u.i("u_tex", 0);
          if (aux) this.bindTex(1, aux.tex);
          u.i("u_aux", 1);
          u.i("u_kind", def.kind);
          u.f("u_res", this.W, this.H);
          u.f("u_t", item.T);
          u.f("u_a", a);
          u.f("u_b", b);
          u.f("u_D", item.clip.duration);
          u.f("u_k", k);
          const col = duoColor(prm.hue ?? 0);
          u.f("u_col", col[0], col[1], col[2]);
        });
        swap();
      } else if (item.type === "transition") {
        // 오버레이 전환: 두 클립을 투명 화면에 그려(미리 곱한 알파) 클립 영역 안에서 섞은 뒤 얹는다
        const gl = this.gl;
        const [fa, fb, fo] = [this.fbo("ovA"), this.fbo("ovB"), this.fbo("ovOut")];
        for (const [l, f] of [[item.a, fa], [item.b, fb]] as const) {
          this.target(f);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          this.drawLayer(l, f, provide, boxes);
        }
        const r = transitionRect(item.a.clip, item.a.media, item.b.clip, item.b.media, this.W, this.H);
        this.pass("transition", fo, (u) => {
          this.bindTex(0, fa.tex);
          this.bindTex(1, fb.tex);
          u.i("u_a", 0);
          u.i("u_b", 1);
          u.i("u_kind", item.kind);
          u.f("u_p", item.p);
          u.f("u_res", this.W, this.H);
          u.f("u_rect", r.x, r.y, r.w, r.h);
        });
        this.target(acc);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        const u = this.use("copy");
        u.f("u_flipY", 0);
        this.bindTex(0, fo.tex);
        u.i("u_tex", 0);
        this.drawQuad();
      } else if (item.type === "adjust") {
        // 조정 레이어: 현재 화면 전체에 LUT/선명도/비네트 적용
        this.drawFboAsLayer(acc, alt, item.clip);
        swap();
      }
    }

    // 화면 출력 (위아래 뒤집기)
    this.pass("copy", null, (u) => {
      this.bindTex(0, acc.tex);
      u.i("u_tex", 0);
    }, true);
    return boxes;
  }

  /** 조정 레이어용: FBO 내용을 LUT/선명도/비네트를 적용해 dst에 그린다 */
  private drawFboAsLayer(src: FBO, dst: FBO, clip: Clip) {
    const gl = this.gl;
    this.target(dst);
    gl.disable(gl.BLEND);
    const u = this.use("layer");
    u.f("u_res", this.W, this.H);
    u.f("u_center", this.W / 2, this.H / 2);
    u.f("u_size", this.W, this.H);
    u.f("u_rot", 0);
    this.bindTex(0, src.tex);
    u.i("u_tex", 0);
    u.f("u_texel", 1 / this.W, 1 / this.H);
    u.f("u_crop", 0, 0, 0, 0);
    u.f("u_flip", 0, 0);
    u.f("u_opacity", 1);
    u.f("u_sharpen", clip.adjust.sharpen ?? 0);
    u.f("u_vignette", clip.adjust.vignette ?? 0);
    u.f("u_srcSize", this.W, this.H);
    u.i("u_chroma", 0);
    const lut = this.lutTex(clip);
    u.i("u_hasLut", lut ? 1 : 0);
    if (lut) {
      this.bindTex(1, lut.tex, gl.TEXTURE_3D);
      u.f("u_lutN", lut.n);
    }
    u.i("u_lut", 1);
    u.i("u_hasMask", 0);
    u.i("u_mask", 2);
    gl.enableVertexAttribArray(0);
    this.drawHalfQuad();
  }

  resize(w: number, h: number) {
    if (this.W === w && this.H === h) return;
    this.W = w;
    this.H = h;
    this.canvas.width = w;
    this.canvas.height = h;
  }

  /** 클립 삭제 등으로 쓰지 않는 텍스처 정리 */
  prune(liveClipIds: Set<string>, liveMediaIds: Set<string>) {
    for (const [id, e] of this.texCache) {
      const alive = id.startsWith("img:") ? liveMediaIds.has(id.slice(4)) : liveClipIds.has(id);
      if (!alive) {
        this.gl.deleteTexture(e.tex);
        this.texCache.delete(id);
      }
    }
    for (const id of this.textCanvas.keys()) if (!liveClipIds.has(id)) this.textCanvas.delete(id);
  }
}
