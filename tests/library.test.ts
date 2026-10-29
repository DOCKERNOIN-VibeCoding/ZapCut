// 라이브러리(템플릿·텍스트 템플릿·스티커·소리)의 참조 무결성
import { describe, expect, it } from "vitest";
import { FILTER_PRESETS, applyLook, bakeLut, clipColorFn, cubeText, parseCube } from "../src/core/color";
import { EFFECTS } from "../src/core/effects";
import { IN_ANIMS, LOOP_ANIMS, OUT_ANIMS } from "../src/core/motion";
import { TRANSITIONS } from "../src/core/transitions";
import { DEFAULT_ADJUST } from "../src/core/types";
import { SOUNDS } from "../src/library/sounds";
import { STICKERS } from "../src/library/stickers";
import { TEMPLATES } from "../src/library/templates";
import { TEXT_TEMPLATES } from "../src/library/textTemplates";

const has = <T extends { id: string }>(list: T[], id?: string) => !id || list.some((x) => x.id === id);
const unique = (ids: string[]) => new Set(ids).size === ids.length;

describe("라이브러리 무결성", () => {
  it("ID가 모두 고유하다", () => {
    for (const list of [STICKERS, SOUNDS, TEMPLATES, TEXT_TEMPLATES, FILTER_PRESETS, EFFECTS, TRANSITIONS]) expect(unique(list.map((x) => x.id))).toBe(true);
  });

  it("템플릿이 참조하는 항목이 모두 존재한다", () => {
    for (const t of TEMPLATES) {
      expect(has(FILTER_PRESETS, t.filter?.id), `${t.id} filter`).toBe(true);
      for (const tr of t.transitions ?? []) expect(has(TRANSITIONS, tr), `${t.id} transition ${tr}`).toBe(true);
      for (const fx of t.effects ?? []) expect(has(EFFECTS, fx.id), `${t.id} effect ${fx.id}`).toBe(true);
      for (const st of t.stickers ?? []) {
        expect(has(STICKERS, st.id), `${t.id} sticker ${st.id}`).toBe(true);
        expect(has(LOOP_ANIMS, st.loop), `${t.id} sticker loop ${st.loop}`).toBe(true);
      }
      for (const s of t.sounds ?? []) expect(has(SOUNDS, s.id), `${t.id} sound ${s.id}`).toBe(true);
      expect(has(SOUNDS, t.bgm), `${t.id} bgm`).toBe(true);
      for (const tx of t.texts ?? []) {
        expect(has(IN_ANIMS, tx.animIn?.id), `${t.id} text in`).toBe(true);
        expect(has(OUT_ANIMS, tx.animOut?.id), `${t.id} text out`).toBe(true);
        expect(has(LOOP_ANIMS, tx.animLoop?.id), `${t.id} text loop`).toBe(true);
      }
    }
  });

  it("텍스트 템플릿 애니메이션이 존재한다", () => {
    for (const t of TEXT_TEMPLATES) {
      expect(has(IN_ANIMS, t.animIn?.id), t.id).toBe(true);
      expect(has(OUT_ANIMS, t.animOut?.id), t.id).toBe(true);
      expect(has(LOOP_ANIMS, t.animLoop?.id), t.id).toBe(true);
    }
  });
});

describe("색 엔진", () => {
  it("조정이 없으면 LUT를 만들지 않는다", () => {
    expect(clipColorFn({ adjust: { ...DEFAULT_ADJUST } })).toBeUndefined();
  });
  it("모든 필터 프리셋 출력이 0..1 범위", () => {
    for (const f of FILTER_PRESETS)
      for (const c of [[0, 0, 0], [1, 1, 1], [0.8, 0.3, 0.1], [0.2, 0.5, 0.9]] as [number, number, number][]) {
        for (const v of applyLook(c, f.look)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
  });
  it(".cube 쓰기/읽기 왕복", () => {
    const fn = clipColorFn({ adjust: { ...DEFAULT_ADJUST, saturation: -1 } })!;
    const lut = bakeLut(fn, 9);
    const back = parseCube(cubeText(lut));
    expect(back.size).toBe(9);
    expect(back.data[back.data.length - 1]).toBeCloseTo(lut.data[lut.data.length - 1], 5);
    // 채도 -1 → 회색
    const [r, g, b] = fn([0.9, 0.2, 0.1]);
    expect(Math.abs(r - g)).toBeLessThan(1e-6);
    expect(Math.abs(g - b)).toBeLessThan(1e-6);
  });
});
