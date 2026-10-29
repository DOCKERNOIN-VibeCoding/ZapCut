// FFmpeg 수식(libavutil/eval) 부분집합 해석기.
// 내보내기에 쓰는 수식 문자열을 미리보기에서도 그대로 계산해 두 결과를 일치시킨다.
// (CSP 때문에 new Function을 쓰지 않고 클로저 트리로 컴파일한다)

export type Vars = Record<string, number>;
export type Compiled = (vars: Vars) => number;

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  atan2: Math.atan2, exp: Math.exp, log: Math.log, sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor,
  ceil: Math.ceil, trunc: Math.trunc, round: Math.round, hypot: Math.hypot, pow: Math.pow,
  sgn: Math.sign,
  min: (a, b) => Math.min(a, b),
  max: (a, b) => Math.max(a, b),
  clip: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
  lt: (a, b) => +(a < b), lte: (a, b) => +(a <= b), gt: (a, b) => +(a > b), gte: (a, b) => +(a >= b),
  eq: (a, b) => +(a === b), not: (a) => +(a === 0),
  mod: (a, b) => a - b * Math.floor(a / b),
  lerp: (a, b, t) => a + (b - a) * t,
};
const CONSTS: Record<string, number> = { PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 };

class Parser {
  i = 0;
  constructor(private s: string) {}
  ws() {
    while (this.s[this.i] === " ") this.i++;
  }
  peek() {
    this.ws();
    return this.s[this.i];
  }
  // expr := term (('+'|'-') term)*
  expr(): Compiled {
    let left = this.term();
    for (;;) {
      const c = this.peek();
      if (c !== "+" && c !== "-") return left;
      this.i++;
      const right = this.term();
      const l = left;
      left = c === "+" ? (v) => l(v) + right(v) : (v) => l(v) - right(v);
    }
  }
  // term := factor (('*'|'/') factor)*
  term(): Compiled {
    let left = this.factor();
    for (;;) {
      const c = this.peek();
      if (c !== "*" && c !== "/") return left;
      this.i++;
      const right = this.factor();
      const l = left;
      left = c === "*" ? (v) => l(v) * right(v) : (v) => l(v) / right(v);
    }
  }
  // factor := signed ('^' signed)*  — FFmpeg처럼 부호는 거듭제곱보다 나중에 적용
  factor(): Compiled {
    const first = this.signed();
    let base = first.fn;
    while (this.peek() === "^") {
      this.i++;
      const e = this.signed();
      const b = base;
      const ef = e.sign < 0 ? (v: Vars) => -e.fn(v) : e.fn;
      base = (v) => Math.pow(b(v), ef(v));
    }
    if (first.sign < 0) {
      const b = base;
      return (v) => -b(v);
    }
    return base;
  }
  signed(): { sign: number; fn: Compiled } {
    let sign = 1;
    const c = this.peek();
    if (c === "+" || c === "-") {
      this.i++;
      if (c === "-") sign = -1;
    }
    return { sign, fn: this.primary() };
  }
  primary(): Compiled {
    const c = this.peek();
    if (c === "(") {
      this.i++;
      const e = this.expr();
      this.expect(")");
      return e;
    }
    const num = /^(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)/.exec(this.s.slice(this.i));
    if (num) {
      this.i += num[0].length;
      const n = parseFloat(num[0]);
      return () => n;
    }
    const id = /^[A-Za-z_][A-Za-z_0-9]*/.exec(this.s.slice(this.i));
    if (!id) throw new Error(`수식 오류: '${this.s}' 위치 ${this.i}`);
    this.i += id[0].length;
    const name = id[0];
    if (this.peek() === "(") {
      this.i++;
      const args: Compiled[] = [];
      if (this.peek() !== ")") {
        args.push(this.expr());
        while (this.peek() === ",") {
          this.i++;
          args.push(this.expr());
        }
      }
      this.expect(")");
      if (name === "if" || name === "ifnot") {
        const [cond, a, b = () => 0] = args;
        return name === "if" ? (v) => (cond(v) !== 0 ? a(v) : b(v)) : (v) => (cond(v) === 0 ? a(v) : b(v));
      }
      const f = FUNCS[name];
      if (!f) throw new Error(`알 수 없는 함수: ${name}`);
      if (args.length === 1) {
        const [a] = args;
        return (v) => f(a(v));
      }
      if (args.length === 2) {
        const [a, b] = args;
        return (v) => f(a(v), b(v));
      }
      return (v) => f(...args.map((a) => a(v)));
    }
    if (name in CONSTS) {
      const k = CONSTS[name];
      return () => k;
    }
    return (v) => {
      const x = v[name];
      if (x === undefined) throw new Error(`정의되지 않은 변수: ${name}`);
      return x;
    };
  }
  expect(ch: string) {
    if (this.peek() !== ch) throw new Error(`수식 오류: '${ch}' 필요 — '${this.s}' 위치 ${this.i}`);
    this.i++;
  }
}

const cache = new Map<string, Compiled>();

export function compile(src: string): Compiled {
  let fn = cache.get(src);
  if (!fn) {
    const p = new Parser(src);
    fn = p.expr();
    if (p.peek() !== undefined) throw new Error(`수식 끝에 남은 문자: '${src.slice(p.i)}'`);
    if (cache.size > 2000) cache.clear();
    cache.set(src, fn);
  }
  return fn;
}

export const evaluate = (src: string, vars: Vars) => compile(src)(vars);

/** 숫자를 수식에 넣을 때 쓰는 짧은 표기 */
export const num = (v: number) => {
  const s = (+v.toFixed(6)).toString();
  return v < 0 ? `(${s})` : s;
};

/** 수식 안의 변수 이름(단어 단위)을 다른 수식으로 바꾼다 */
export function substitute(src: string, name: string, replacement: string) {
  return src.replace(new RegExp(`\\b${name}\\b`, "g"), `(${replacement})`);
}

/** 상수 수식이면 그 값을, 아니면 undefined */
export function constantValue(src: string): number | undefined {
  try {
    return compile(src)({});
  } catch {
    return undefined;
  }
}
