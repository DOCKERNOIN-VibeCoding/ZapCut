// 영역 추적: 흑백 프레임에서 정규화 상호상관(NCC) 템플릿 매칭으로 상자를 따라간다.
// 순수 함수라 메인 프로세스에서 돌리고, 합성 영상으로 테스트한다. 좌표는 분석 프레임의 px(왼쪽 위 기준).

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface TrackResult {
  boxes: Box[]; // boxes[i] = i번째 프레임 (0 = 시작 상자)
  lostAt?: number; // 이 프레임부터 놓침 (boxes는 그 앞까지)
}

const G = 24; // 템플릿 격자 (상자 크기와 무관하게 G×G 점을 비교)
const SCALES = [0.95, 1, 1.05];
const LOST = 0.4; // 이보다 닮지 않으면 놓친 것으로 본다
const LOST_FRAMES = 4;

/** 상자 안을 G×G로 표본 추출해 평균 0, 길이 1로 정규화. 무늬가 거의 없으면 undefined */
function sample(f: Uint8Array, fw: number, fh: number, b: Box, out = new Float32Array(G * G)): Float32Array | undefined {
  let sum = 0;
  for (let j = 0; j < G; j++) {
    const y = Math.min(fh - 1, Math.max(0, b.y + ((j + 0.5) * b.h) / G));
    const y0 = Math.floor(y);
    const y1 = Math.min(fh - 1, y0 + 1);
    const fy = y - y0;
    for (let i = 0; i < G; i++) {
      const x = Math.min(fw - 1, Math.max(0, b.x + ((i + 0.5) * b.w) / G));
      const x0 = Math.floor(x);
      const x1 = Math.min(fw - 1, x0 + 1);
      const fx = x - x0;
      const top = f[y0 * fw + x0] * (1 - fx) + f[y0 * fw + x1] * fx;
      const bot = f[y1 * fw + x0] * (1 - fx) + f[y1 * fw + x1] * fx;
      const v = top * (1 - fy) + bot * fy;
      out[j * G + i] = v;
      sum += v;
    }
  }
  const mean = sum / (G * G);
  let ss = 0;
  for (let k = 0; k < out.length; k++) {
    out[k] -= mean;
    ss += out[k] * out[k];
  }
  if (ss < G * G * 4) return undefined; // 표준편차 2 미만 = 단색
  const inv = 1 / Math.sqrt(ss);
  for (let k = 0; k < out.length; k++) out[k] *= inv;
  return out;
}

function dot(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += a[k] * b[k];
  return s;
}

const clampBox = (b: Box, fw: number, fh: number): Box => {
  const w = Math.min(fw, Math.max(4, b.w));
  const h = Math.min(fh, Math.max(4, b.h));
  return { x: Math.min(fw - w, Math.max(0, b.x)), y: Math.min(fh - h, Math.max(0, b.y)), w, h };
};

/** frames[0]의 init 상자를 끝까지 따라간다 */
export function trackBox(frames: Uint8Array[], fw: number, fh: number, init: Box, onProgress?: (done: number) => void): TrackResult {
  const start = clampBox(init, fw, fh);
  const first = sample(frames[0], fw, fh, start);
  if (!first) return { boxes: [start], lostAt: 1 };
  const initT = first.slice();
  let tmpl = first.slice();
  const buf = new Float32Array(G * G);
  const boxes = [start];
  let cur = start;
  let vx = 0;
  let vy = 0;
  let low = 0;
  for (let n = 1; n < frames.length; n++) {
    const f = frames[n];
    const cx = cur.x + cur.w / 2 + vx;
    const cy = cur.y + cur.h / 2 + vy;
    const r = Math.max(6, 0.6 * Math.max(cur.w, cur.h));
    let best = { score: -2, box: cur };
    const tryAt = (x: number, y: number, s: number) => {
      const b = clampBox({ x: x - (cur.w * s) / 2, y: y - (cur.h * s) / 2, w: cur.w * s, h: cur.h * s }, fw, fh);
      const v = sample(f, fw, fh, b, buf);
      const score = v ? dot(tmpl, v) : -1;
      if (score > best.score) best = { score, box: b };
    };
    // 거친 탐색 → 찾은 자리 주변을 점점 촘촘히
    let step = Math.max(1, Math.round(r / 10));
    for (const s of SCALES) for (let dy = -r; dy <= r; dy += step) for (let dx = -r; dx <= r; dx += step) tryAt(cx + dx, cy + dy, s);
    while (step > 1) {
      step = Math.max(1, Math.floor(step / 2));
      const b = best.box;
      const s = b.w / cur.w;
      for (let dy = -2 * step; dy <= 2 * step; dy += step) for (let dx = -2 * step; dx <= 2 * step; dx += step) tryAt(b.x + b.w / 2 + dx, b.y + b.h / 2 + dy, s);
    }
    if (best.score < LOST) {
      if (++low >= LOST_FRAMES) {
        boxes.length -= LOST_FRAMES - 1; // 놓치기 시작한 프레임부터 버린다
        onProgress?.(frames.length);
        return { boxes, lostAt: boxes.length };
      }
      boxes.push(cur);
      continue;
    }
    low = 0;
    const b = best.box;
    vx = 0.6 * vx + 0.4 * (b.x + b.w / 2 - (cur.x + cur.w / 2));
    vy = 0.6 * vy + 0.4 * (b.y + b.h / 2 - (cur.y + cur.h / 2));
    cur = b;
    boxes.push(b);
    // 모습이 조금씩 바뀌는 것을 따라가되 처음 모습도 잊지 않게
    if (best.score > 0.6) {
      const now = sample(f, fw, fh, b, buf)!;
      let ss = 0;
      for (let k = 0; k < tmpl.length; k++) {
        tmpl[k] = 0.85 * tmpl[k] + 0.1 * now[k] + 0.05 * initT[k];
        ss += tmpl[k] * tmpl[k];
      }
      const inv = 1 / Math.sqrt(ss || 1);
      for (let k = 0; k < tmpl.length; k++) tmpl[k] *= inv;
    }
    if (n % 10 === 0) onProgress?.(n);
  }
  onProgress?.(frames.length);
  return { boxes };
}

/** 떨림 줄이기: 앞뒤 같은 개수(최대 k)의 평균. 양 끝으로 갈수록 창을 줄여 처음·끝 위치가 밀리지 않게 */
export function smoothBoxes(boxes: Box[], k = 2): Box[] {
  return boxes.map((_, i) => {
    const r = Math.min(k, i, boxes.length - 1 - i);
    const a = i - r;
    const z = i + r;
    const acc = { x: 0, y: 0, w: 0, h: 0 };
    for (let j = a; j <= z; j++) (["x", "y", "w", "h"] as const).forEach((p) => (acc[p] += boxes[j][p]));
    const n = z - a + 1;
    return { x: acc.x / n, y: acc.y / n, w: acc.w / n, h: acc.h / n };
  });
}

/** 꺾은선 단순화 (Ramer–Douglas–Peucker): 허용 오차 안에서 점을 줄인다. 처음·끝 점은 남긴다 */
export function simplify<T extends { t: number; v: number }>(pts: T[], tol: number): T[] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let dmax = tol;
    for (let i = a + 1; i < b; i++) {
      const p = (pts[i].t - pts[a].t) / (pts[b].t - pts[a].t || 1);
      const d = Math.abs(pts[i].v - (pts[a].v + (pts[b].v - pts[a].v) * p));
      if (d > dmax) (dmax = d), (worst = i);
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
