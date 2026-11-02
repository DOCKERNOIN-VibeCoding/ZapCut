import { describe, expect, it } from "vitest";
import { applyRun, linePieces, normalizeRuns, shiftRuns } from "../src/core/textRuns";

describe("글자 범위 스타일(runs)", () => {
  it("범위에 색을 입히고, 겹치는 범위에 크기를 더하면 조각으로 나뉜다", () => {
    const red = applyRun(undefined, 0, 2, { color: "#f00" }); // "엽떡매니아"에서 "엽떡"
    expect(red).toEqual([{ start: 0, end: 2, color: "#f00" }]);
    const big = applyRun(red, 1, 4, { fontSize: 120 }); // "떡매니"
    expect(big).toEqual([
      { start: 0, end: 1, color: "#f00" },
      { start: 1, end: 2, color: "#f00", fontSize: 120 },
      { start: 2, end: 4, fontSize: 120 },
    ]);
  });

  it("원래대로(null)는 그 속성을 지우고, 다 지워지면 undefined", () => {
    const r = applyRun(undefined, 0, 3, { color: "#f00", fontSize: 100 });
    expect(applyRun(r, 0, 3, { color: null })).toEqual([{ start: 0, end: 3, fontSize: 100 }]);
    expect(applyRun(r, 0, 3, { color: null, fontSize: null })).toBeUndefined();
    expect(applyRun(r, 1, 2, { color: null, fontSize: null })).toEqual([
      { start: 0, end: 1, color: "#f00", fontSize: 100 },
      { start: 2, end: 3, color: "#f00", fontSize: 100 },
    ]);
  });

  it("같은 스타일이 붙어 있으면 합친다", () => {
    expect(normalizeRuns([{ start: 2, end: 4, color: "a" }, { start: 0, end: 2, color: "a" }, { start: 5, end: 5, color: "a" }])).toEqual([{ start: 0, end: 4, color: "a" }]);
  });

  it("글자를 넣거나 지우면 run 위치가 따라간다", () => {
    const runs = [{ start: 2, end: 4, color: "#f00" }]; // "엽떡매니아"의 "매니"
    expect(shiftRuns(runs, "엽떡매니아", "안녕 엽떡매니아")).toEqual([{ start: 5, end: 7, color: "#f00" }]); // 앞에 넣음
    expect(shiftRuns(runs, "엽떡매니아", "엽떡매니아!!")).toEqual(runs); // 뒤에 넣음
    expect(shiftRuns(runs, "엽떡매니아", "엽떡매X니아")).toEqual([{ start: 2, end: 5, color: "#f00" }]); // run 안에 넣음 → 포함
    expect(shiftRuns(runs, "엽떡매니아", "엽떡니아")).toEqual([{ start: 2, end: 3, color: "#f00" }]); // run 일부 지움
    expect(shiftRuns(runs, "엽떡매니아", "엽아")).toBeUndefined(); // run 전체 지움
    expect(shiftRuns(runs, "엽떡매니아", "엽떡매니아")).toEqual(runs);
  });

  it("줄마다 조각으로 나눈다 (줄바꿈을 건너 이어지는 run 포함)", () => {
    const pieces = linePieces("가나\n다라마", [{ start: 1, end: 4, color: "#f00" }]); // "나", "\n", "다"
    expect(pieces).toEqual([
      [{ text: "가" }, { text: "나", color: "#f00", fontSize: undefined }],
      [{ text: "다", color: "#f00", fontSize: undefined }, { text: "라마" }],
    ]);
    expect(linePieces("", undefined)).toEqual([[{ text: "" }]]);
    expect(linePieces("가\n\n나", undefined)).toEqual([[{ text: "가" }], [{ text: "" }], [{ text: "나" }]]);
  });
});
