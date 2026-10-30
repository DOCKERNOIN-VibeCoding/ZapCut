// YuNet 얼굴 검출 출력 해석 (OpenCV FaceDetectorYN과 같은 규칙). 입력은 640×640, 결과는 입력 px 상자.
export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

export const YUNET_SIZE = 640;
const STRIDES = [8, 16, 32];

type Outputs = Record<string, { data: Float32Array | ArrayLike<number> }>;

/** 격자마다 점수 = √(분류×존재), 상자 = (칸 + 오프셋)×보폭, 너비·높이 = exp(값)×보폭 */
export function decodeYuNet(out: Outputs, threshold = 0.6): FaceBox[] {
  const faces: FaceBox[] = [];
  for (const s of STRIDES) {
    const cls = out[`cls_${s}`].data;
    const obj = out[`obj_${s}`].data;
    const bbox = out[`bbox_${s}`].data;
    const cols = YUNET_SIZE / s;
    const rows = YUNET_SIZE / s;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
        if (score < threshold) continue;
        const cx = (c + bbox[i * 4]) * s;
        const cy = (r + bbox[i * 4 + 1]) * s;
        const w = Math.exp(bbox[i * 4 + 2]) * s;
        const h = Math.exp(bbox[i * 4 + 3]) * s;
        faces.push({ x: cx - w / 2, y: cy - h / 2, w, h, score });
      }
  }
  return nms(faces, 0.3);
}

const iou = (a: FaceBox, b: FaceBox) => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = x * y;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

/** 겹치는 상자 중 점수 높은 것만 남긴다 */
export function nms(boxes: FaceBox[], thr: number): FaceBox[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const keep: FaceBox[] = [];
  for (const b of sorted) if (keep.every((k) => iou(k, b) <= thr)) keep.push(b);
  return keep;
}

/** BGR 바이트(HWC) → YuNet 입력 텐서 (NCHW, BGR 그대로, 정규화 없음) */
export function toTensor(bgr: Uint8Array): Float32Array {
  const n = YUNET_SIZE * YUNET_SIZE;
  const t = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    t[i] = bgr[i * 3];
    t[n + i] = bgr[i * 3 + 1];
    t[2 * n + i] = bgr[i * 3 + 2];
  }
  return t;
}
