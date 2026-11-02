// 텍스트 클립 안 글자 범위별 스타일(runs): "엽떡매니아"에서 "엽떡"만 빨갛게 하는 식으로 글자 단위로 색·크기를 바꾼다.
// 범위는 content의 UTF-16 인덱스 [start, end). 서로 겹치지 않고 시작 순으로 정렬된 상태를 유지한다.
import type { TextRun } from "./types";

/** null = 그 속성을 지워 기본 스타일로 */
export interface RunPatch {
  color?: string | null;
  fontSize?: number | null;
}

function patched(r: TextRun, patch: RunPatch): TextRun {
  const o: TextRun = { ...r };
  if (patch.color !== undefined) {
    if (patch.color === null) delete o.color;
    else o.color = patch.color;
  }
  if (patch.fontSize !== undefined) {
    if (patch.fontSize === null) delete o.fontSize;
    else o.fontSize = patch.fontSize;
  }
  return o;
}

/** 빈 범위·스타일 없는 run을 버리고 정렬한 뒤, 붙어 있고 스타일이 같은 run은 합친다 */
export function normalizeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  const kept = runs.filter((x) => x.end > x.start && (x.color !== undefined || x.fontSize !== undefined)).sort((a, b) => a.start - b.start);
  for (const r of kept) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end && last.color === r.color && last.fontSize === r.fontSize) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** [a, b) 범위에 patch를 입힌다 (기존 run 위에 덮어씀). 결과가 비면 undefined */
export function applyRun(runs: TextRun[] | undefined, a: number, b: number, patch: RunPatch): TextRun[] | undefined {
  if (b <= a) return runs;
  const out: TextRun[] = [];
  let pos = a; // 아직 어떤 run도 덮지 않은 범위의 시작
  for (const r of [...(runs ?? [])].sort((x, y) => x.start - y.start)) {
    if (r.end <= a || r.start >= b) {
      out.push(r);
      continue;
    }
    if (r.start < a) out.push({ ...r, end: a });
    if (r.end > b) out.push({ ...r, start: b });
    const s = Math.max(r.start, a);
    const e = Math.min(r.end, b);
    if (s > pos) out.push(patched({ start: pos, end: s }, patch));
    out.push(patched({ ...r, start: s, end: e }, patch));
    pos = Math.max(pos, e);
  }
  if (pos < b) out.push(patched({ start: pos, end: b }, patch));
  const n = normalizeRuns(out);
  return n.length ? n : undefined;
}

/**
 * 내용이 바뀐 뒤 run 위치를 맞춘다. 앞뒤 공통 부분으로 바뀐 구간을 찾아 뒤쪽 run은 밀고, 구간에 걸친 run은 잘라낸다.
 * run 안이나 바로 뒤에 이어 쓴 글자는 그 run에 들어간다 (빨간 글자 뒤에 계속 쓰면 빨강).
 */
export function shiftRuns(runs: TextRun[] | undefined, before: string, after: string): TextRun[] | undefined {
  if (!runs?.length || before === after) return runs;
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  const oldEnd = before.length - s;
  const delta = after.length - before.length;
  const out: TextRun[] = [];
  for (const r of runs) {
    const start = r.start <= p ? r.start : r.start >= oldEnd ? r.start + delta : p;
    const end = r.end >= oldEnd ? r.end + delta : r.end <= p ? r.end : p;
    if (end > start) out.push({ ...r, start, end });
  }
  const n = normalizeRuns(out);
  return n.length ? n : undefined;
}

/** 줄 안의 한 조각. fontSize·color가 없으면 기본 스타일 */
export interface TextPiece {
  text: string;
  fontSize?: number;
  color?: string;
}

/** 줄마다 run 경계로 자른 조각. 그리기·측정은 조각 단위로 한다 (빈 줄은 빈 조각 하나) */
export function linePieces(content: string, runs: TextRun[] | undefined): TextPiece[][] {
  const sorted = runs?.length ? [...runs].sort((a, b) => a.start - b.start) : [];
  let offset = 0;
  return content.split("\n").map((line) => {
    const out: TextPiece[] = [];
    let pos = 0;
    for (const r of sorted) {
      const a = Math.max(0, r.start - offset);
      const b = Math.min(line.length, r.end - offset);
      if (b <= a || b <= pos) continue;
      const from = Math.max(a, pos);
      if (from > pos) out.push({ text: line.slice(pos, from) });
      out.push({ text: line.slice(from, b), fontSize: r.fontSize, color: r.color });
      pos = b;
    }
    if (pos < line.length) out.push({ text: line.slice(pos) });
    offset += line.length + 1;
    return out.length ? out : [{ text: "" }];
  });
}
