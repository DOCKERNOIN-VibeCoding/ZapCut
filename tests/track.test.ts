import { describe, expect, it } from "vitest";
import { simplify, smoothBoxes, trackBox, type Box } from "../src/core/track";

const FW = 320;
const FH = 180;

/** 무늬 있는 배경 위에 무늬 있는 물체(얼굴 대용)를 그린 흑백 프레임 */
function frame(cx: number, cy: number, size: number, occluded = false) {
  const f = new Uint8Array(FW * FH);
  for (let y = 0; y < FH; y++)
    for (let x = 0; x < FW; x++) {
      // 배경: 완만한 그라데이션 + 잔무늬
      let v = 60 + (x / FW) * 40 + ((x * 7 + y * 13) % 17);
      const dx = (x - cx) / (size / 2);
      const dy = (y - cy) / (size / 2);
      if (!occluded && dx * dx + dy * dy < 1) {
        // 물체: 밝은 원 안에 어두운 눈 두 개와 입
        v = 200;
        if (Math.hypot(dx + 0.35, dy + 0.25) < 0.15 || Math.hypot(dx - 0.35, dy + 0.25) < 0.15) v = 30;
        if (Math.abs(dy - 0.4) < 0.08 && Math.abs(dx) < 0.4) v = 50;
      }
      f[y * FW + x] = v;
    }
  return f;
}

const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

describe("영역 추적", () => {
  it("움직이며 커지는 물체를 따라간다", () => {
    const n = 40;
    const path = Array.from({ length: n }, (_, i) => ({ x: 60 + i * 4.5, y: 70 + Math.sin(i / 6) * 25, s: 40 + i * 0.5 }));
    const frames = path.map((p) => frame(p.x, p.y, p.s));
    const init = { x: path[0].x - 22, y: path[0].y - 22, w: 44, h: 44 };
    const r = trackBox(frames, FW, FH, init);
    expect(r.lostAt).toBeUndefined();
    expect(r.boxes).toHaveLength(n);
    for (let i = 0; i < n; i += 5) {
      const c = center(r.boxes[i]);
      expect(Math.hypot(c.x - path[i].x, c.y - path[i].y), `frame ${i}`).toBeLessThan(5);
    }
    // 커진 만큼 상자도 커진다
    expect(r.boxes[n - 1].w).toBeGreaterThan(init.w * 1.15);
  });

  it("물체가 사라지면 그 앞에서 멈춘다", () => {
    const frames = Array.from({ length: 30 }, (_, i) => frame(100 + i * 3, 90, 44, i >= 18));
    const r = trackBox(frames, FW, FH, { x: 78, y: 68, w: 44, h: 44 });
    expect(r.lostAt).toBe(18);
    expect(r.boxes).toHaveLength(18);
  });
});

describe("후처리", () => {
  it("평균으로 떨림을 줄인다", () => {
    const boxes = [0, 2, 0, 2, 0, 2, 0].map((x) => ({ x, y: 0, w: 10, h: 10 }));
    const s = smoothBoxes(boxes, 1);
    expect(Math.max(...s.slice(1, -1).map((b) => b.x)) - Math.min(...s.slice(1, -1).map((b) => b.x))).toBeLessThan(1);
  });
  it("직선 위 점은 버리고 꺾이는 점은 남긴다", () => {
    const pts = [0, 1, 2, 3, 4, 5, 6].map((t) => ({ t, v: t < 3 ? t : 6 - t }));
    const s = simplify(pts, 0.01);
    expect(s.map((p) => p.t)).toEqual([0, 3, 6]);
  });
});
