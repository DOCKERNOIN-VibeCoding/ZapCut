import { describe, expect, it } from "vitest";
import { fillTokens, instantiateTitle, titleLabel, titleTiming, type Title } from "../src/core/titles";
import { TITLE_TEMPLATES } from "../src/library/titleTemplates";

describe("타이틀 시간", () => {
  const title: Title = {
    layers: [
      { id: "a", x: 0, y: 0, text: { label: "제목", content: "ABCDE", style: {} }, in: { at: 0.2, dur: 0.5, per: "char", stagger: 0.1 }, out: { at: 0.4, dur: 0.3 } },
      { id: "b", x: 0, y: 0, shape: { type: "rect", w: 10, h: 10 }, in: { at: 0, dur: 0.3 } },
    ],
  };

  it("등장 끝 = 마지막 글자까지 (0.2 + 4×0.1 + 0.5), 퇴장은 클립 끝 기준", () => {
    const t = titleTiming(title, 4);
    expect(t.inEnd).toBeCloseTo(1.1);
    expect(t.outStart).toBeCloseTo(3.6);
    expect(t.loop).toBe(false);
    // 클립을 늘려도 등장은 그대로, 퇴장만 끝을 따라간다
    expect(titleTiming(title, 10).inEnd).toBeCloseTo(1.1);
    expect(titleTiming(title, 10).outStart).toBeCloseTo(9.6);
  });

  it("가운데부터 순서는 시간차가 절반", () => {
    const centered: Title = { layers: [{ ...title.layers[0], in: { ...title.layers[0].in!, order: "center" } }] };
    expect(titleTiming(centered, 4).inEnd).toBeCloseTo(0.2 + 2 * 0.1 + 0.5);
  });
});

describe("날짜 자리표시", () => {
  const d = new Date(2026, 9, 30, 14, 5); // 2026-10-30(금) 14:05
  it("채운다", () => {
    expect(fillTokens("{YYYY}.{MM}.{DD}", d)).toBe("2026.10.30");
    expect(fillTokens("{MON}.{DD} {Week} {요일}요일", d)).toBe("OCT.30 Fri 금요일");
    expect(fillTokens("{hh}:{mm} {AMPM} / {HH}", d)).toBe("02:05 PM / 14");
  });
  it("템플릿을 넣을 때 텍스트 레이어에만 적용된다", () => {
    const def = TITLE_TEMPLATES.find((x) => x.id === "stack-date")!;
    const t = instantiateTitle(def, d);
    expect(t.layers.find((l) => l.id === "month")!.text!.content).toBe("10");
    expect(t.layers.find((l) => l.id === "week")!.text!.content).toBe("금요일");
    expect(titleLabel(t)).toBe("10");
  });
});

describe("템플릿 정의", () => {
  it("아이디가 겹치지 않고, 붙이기·맞추기는 있는 레이어를 가리킨다", () => {
    expect(new Set(TITLE_TEMPLATES.map((t) => t.id)).size).toBe(TITLE_TEMPLATES.length);
    for (const t of TITLE_TEMPLATES) {
      const ids = new Set(t.layers.map((l) => l.id));
      expect(ids.size, t.id).toBe(t.layers.length);
      for (const l of t.layers) {
        if (l.attach) expect(ids.has(l.attach.layer), `${t.id}.${l.id}`).toBe(true);
        if (l.shape?.fit) expect(ids.has(l.shape.fit.layer), `${t.id}.${l.id}`).toBe(true);
        expect(!!l.text !== !!l.shape, `${t.id}.${l.id}`).toBe(true);
      }
    }
  });
});
