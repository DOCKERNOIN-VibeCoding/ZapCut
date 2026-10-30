import { describe, expect, it } from "vitest";
import { decodeYuNet, nms } from "../src/core/faces";

/** 격자 출력 흉내: 보폭 16의 (행 10, 열 5)에 얼굴 하나 */
function outputs() {
  const mk = (n: number, k = 1) => ({ data: new Float32Array(n * k) });
  const out = {
    cls_8: mk(80 * 80), obj_8: mk(80 * 80), bbox_8: mk(80 * 80, 4),
    cls_16: mk(40 * 40), obj_16: mk(40 * 40), bbox_16: mk(40 * 40, 4),
    cls_32: mk(20 * 20), obj_32: mk(20 * 20), bbox_32: mk(20 * 20, 4),
  };
  const i = 10 * 40 + 5;
  out.cls_16.data[i] = 0.81;
  out.obj_16.data[i] = 1;
  out.bbox_16.data.set([0.5, 0.5, Math.log(2), Math.log(3)], i * 4);
  return out;
}

describe("YuNet 출력 해석", () => {
  it("칸·오프셋·보폭으로 상자를 되돌린다", () => {
    const [f] = decodeYuNet(outputs());
    expect(f.score).toBeCloseTo(0.9);
    expect(f.w).toBeCloseTo(32);
    expect(f.h).toBeCloseTo(48);
    expect(f.x).toBeCloseTo((5 + 0.5) * 16 - 16);
    expect(f.y).toBeCloseTo((10 + 0.5) * 16 - 24);
  });
  it("겹치는 상자는 점수 높은 것만 남긴다", () => {
    const kept = nms([{ x: 0, y: 0, w: 100, h: 100, score: 0.7 }, { x: 10, y: 10, w: 100, h: 100, score: 0.9 }, { x: 300, y: 300, w: 50, h: 50, score: 0.8 }], 0.3);
    expect(kept.map((b) => b.score)).toEqual([0.9, 0.8]);
  });
});
