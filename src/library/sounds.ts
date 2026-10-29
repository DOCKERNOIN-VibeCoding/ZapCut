/**
 * 짭컷 기본 사운드 라이브러리.
 * 오디오 파일을 배포하지 않고, 사용자 PC의 FFmpeg로 수식 합성해서 만든다 (모두 자체 제작).
 * 앱은 `ffmpeg -y -v error ...args -ar 48000 -ac 2 <out.wav>` 로 실행한다.
 */

export type SoundCategory = "효과음" | "배경음악";
export interface SoundDef {
  id: string; // kebab-case ascii, unique
  name: string; // Korean display name
  category: SoundCategory;
  duration: number; // seconds (exact length of the generated file)
  /** ffmpeg arguments that produce the sound; the app runs: ffmpeg -y -v error ...args -ar 48000 -ac 2 <out.wav> */
  args: string[];
}

// ---------------------------------------------------------------------------
// 수식 빌더 (FFmpeg expression 문자열 생성)
// ---------------------------------------------------------------------------

/** 숫자를 수식용 문자열로. 음수는 괄호로 감싼다. */
function n(x: number): string {
  const s = String(Math.round(x * 1e4) / 1e4);
  return x < 0 ? `(${s})` : s;
}

const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 음이름 → Hz (A4 = 440). 예: "C4", "F#3", "Bb5" */
function hz(note: string): number {
  const m = /^([A-G])([#b]?)(\d)$/.exec(note);
  if (!m) throw new Error(`bad note ${note}`);
  const midi = 12 * (Number(m[3]) + 1) + SEMI[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  return 440 * 2 ** ((midi - 69) / 12);
}

/** 루프 길이 L초 안에 정수 주기가 들어가도록 반올림한 주파수 (루프 이음매에서 위상이 맞음) */
function lhz(note: string, L: number, detune = 1): number {
  return Math.round(hz(note) * detune * L) / L;
}

/** 인덱스 수식 값에 따라 values[i] 를 고르는 수식 (0 은 생략 = 쉼표) */
function sel(idx: string, values: number[]): string {
  const terms = values.map((v, i) => (v ? `eq(${idx},${i})*${n(v)}` : "")).filter(Boolean);
  return `(${terms.join("+")})`;
}

/** 지수형 피치 글라이드 위상: f(x) = f1 + (f0 - f1)·e^(-r·x) 의 적분 × 2π */
function glide(x: string, f0: number, f1: number, r: number): string {
  return `2*PI*(${n(f1)}*${x}+${n((f0 - f1) / r)}*(1-exp(-${n(r)}*${x})))`;
}

/** t0 에서 시작해 rate 로 감쇠하는 엔벨로프 (짧은 어택 포함) */
function hit(t0: number, rate: number, atk = 2000): string {
  const x = `(t-${n(t0)})`;
  return `if(gte(t,${n(t0)}),exp(-${n(rate)}*${x})*(1-exp(-${atk}*${x})),0)`;
}

/** 주기 신호 U(≥0)에 대한 감쇠 엔벨로프 */
function pl(u: string, rate: number, atk = 400): string {
  return `exp(-${n(rate)}*${u})*(1-exp(-${atk}*${u}))`;
}

/** 킥 드럼: U = 타격 후 경과 시간 */
function kick(u: string, f0: number, f1: number, decay: number): string {
  return `sin(${glide(u, f0, f1, 30)})*exp(-${n(decay)}*${u})`;
}

/** 백색 잡음 (-1..1), 시드는 변수 1 */
const NOISE = "(random(1)*2-1)";

function src(expr: string, d: number): string {
  return `aevalsrc=exprs='${expr}':s=48000:d=${d}`;
}

function sfx(id: string, name: string, d: number, gainDb: number, expr: string, af?: string): SoundDef {
  const filters = [af, `volume=${gainDb}dB`].filter(Boolean).join(",");
  return {
    id,
    name,
    category: "효과음",
    duration: d,
    args: ["-f", "lavfi", "-i", src(expr, d), "-af", filters, "-t", String(d)],
  };
}

/** 여러 aevalsrc 레이어를 각자 필터링 후 합친다 (amix normalize=0). */
function bgm(id: string, name: string, L: number, gainDb: number, layers: { expr: string; af?: string }[]): SoundDef {
  const inputs = layers.flatMap((l) => ["-f", "lavfi", "-i", src(l.expr, L)]);
  const chains = layers.map((l, i) => `[${i}:a]${l.af ?? "anull"}[l${i}]`);
  const labels = layers.map((_, i) => `[l${i}]`).join("");
  const graph = `${chains.join(";")};${labels}amix=inputs=${layers.length}:normalize=0,volume=${gainDb}dB[out]`;
  return {
    id,
    name,
    category: "배경음악",
    duration: L,
    args: [...inputs, "-filter_complex", graph, "-map", "[out]", "-t", String(L)],
  };
}

// ---------------------------------------------------------------------------
// 효과음
// ---------------------------------------------------------------------------

/** 필터 계수가 시간에 따라 열렸다 닫히는 잡음 스윕 (휙/슉) */
function sweepNoise(d: number, kMin: number, kMax: number): string {
  const k = `(${n(kMin)}+${n(kMax)}*ld(9))`;
  return (
    `st(9,pow(sin(PI*pow(t/${d},0.7)),2));st(0,${NOISE});` +
    `st(2,ld(2)+${k}*(ld(0)-ld(2)));st(3,ld(3)+${k}*(ld(2)-ld(3)));ld(3)*ld(9)`
  );
}

/** 종소리 음색 (기음 + 배음) */
function bell(f: number, t0: number, decay: number): string {
  const x = `(t-${n(t0)})`;
  return (
    `if(gte(t,${n(t0)}),(sin(2*PI*${n(f)}*${x})+0.3*sin(4*PI*${n(f)}*${x})+0.08*sin(6*PI*${n(f)}*${x}))` +
    `*exp(-${n(decay)}*${x})*(1-exp(-2000*${x})),0)`
  );
}

/** 사다리꼴 게이트 비프 */
function beep(f: number, t0: number, len: number): string {
  return (
    `(sin(2*PI*${n(f)}*t)+0.2*sin(4*PI*${n(f)}*t))` +
    `*clip(min((t-${n(t0)})/0.004,(${n(t0 + len)}-t)/0.004),0,1)`
  );
}

const typingTimes: [number, number, number][] = [
  [0, 1700, 1],
  [0.13, 2100, 0.7],
  [0.29, 1900, 0.9],
  [0.38, 2300, 0.6],
  [0.55, 1800, 1],
  [0.66, 2000, 0.75],
  [0.84, 1750, 0.9],
  [0.95, 2200, 0.65],
  [1.07, 1850, 0.85],
];

const sparkleNotes: [number, string][] = [
  [0, "C7"],
  [0.07, "G6"],
  [0.15, "E7"],
  [0.22, "A6"],
  [0.3, "D7"],
  [0.38, "G7"],
  [0.47, "C8"],
];

const riserK = (2 * Math.PI * 180 * 2) / Math.log(8); // f(t) = 180·8^(t/2) 의 위상 계수

const EFFECTS: SoundDef[] = [
  sfx("whoosh", "휙 (전환)", 0.7, 6, sweepNoise(0.7, 0.01, 0.25)),
  sfx("swoosh-fast", "슉 (빠른 전환)", 0.4, 2.1, sweepNoise(0.4, 0.04, 0.5), "highpass=f=700"),
  sfx("pop", "팝", 0.15, 1.7, `sin(${glide("t", 1100, 320, 45)})*(1-exp(-600*t))*exp(-28*t)`),
  sfx("bubble-pop", "뽁 (물방울)", 0.25, 0.8, `sin(${glide("t", 350, 1500, 22)})*(1-exp(-900*t))*exp(-16*t)`),
  sfx(
    "click",
    "딸깍 (클릭)",
    0.06,
    -3.6,
    `0.6*${NOISE}*exp(-350*t)+sin(2*PI*2400*t)*exp(-180*t)`,
    "highpass=f=500",
  ),
  sfx(
    "ding",
    "딩 (알림)",
    1.5,
    -3.9,
    `(1-exp(-3000*t))*(sin(2*PI*880*t)*exp(-2.6*t)+0.45*sin(2*PI*1760.8*t)*exp(-4.5*t)` +
      `+0.25*sin(2*PI*2429*t)*exp(-7*t)+0.12*sin(2*PI*4752*t)*exp(-12*t))`,
    "afade=t=out:st=1.4:d=0.1",
  ),
  sfx(
    "dingdong",
    "띵동 (초인종)",
    1.8,
    -2.5,
    `${bell(hz("E5"), 0, 3)}+${bell(hz("C5"), 0.5, 2.6)}`,
    "afade=t=out:st=1.65:d=0.15",
  ),
  sfx(
    "success",
    "성공 차임",
    1.2,
    -7.3,
    [
      [hz("C5"), 0],
      [hz("E5"), 0.09],
      [hz("G5"), 0.18],
      [hz("C6"), 0.27],
    ]
      .map(([f, t0]) => bell(f, t0, t0 === 0.27 ? 3 : 4.5))
      .join("+"),
    "afade=t=out:st=1.05:d=0.15",
  ),
  sfx(
    "error-buzz",
    "삐빅 (오류)",
    0.55,
    -0.2,
    `clip(3*(sin(2*PI*140*t)+0.6*sin(2*PI*147*t)),-1,1)*pow(max(0,sin(PI*mod(t,0.28)/0.22)),0.25)*lt(t,0.5)`,
    "lowpass=f=2500",
  ),
  sfx(
    "camera-shutter",
    "찰칵 (카메라)",
    0.22,
    -1.6,
    `st(0,${NOISE});ld(0)*(${hit(0, 60)}+0.8*${hit(0.07, 45)})` +
      `+0.5*sin(2*PI*3200*t)*${hit(0, 70)}+0.4*sin(2*PI*2700*t)*${hit(0.07, 60)}`,
    "highpass=f=300",
  ),
  sfx(
    "boom",
    "쿵 (임팩트)",
    1.6,
    -0.7,
    `sin(${glide("t", 140, 38, 5)})*exp(-2.2*t)*(1-exp(-800*t))+0.5*${NOISE}*exp(-14*t)`,
    "lowpass=f=1800,afade=t=out:st=1.4:d=0.2",
  ),
  sfx(
    "riser",
    "상승 (라이저)",
    2,
    -0.5,
    `st(0,${NOISE});st(9,0.01+0.4*pow(t/2,2));st(2,ld(2)+ld(9)*(ld(0)-ld(2)));` +
      `(0.45*sin(${n(riserK)}*(pow(8,t/2)-1))+0.9*ld(2))*pow(t/2,1.6)*min(1,(2-t)*25)`,
  ),
  sfx(
    "typing",
    "타닥타닥 (타자)",
    1.2,
    3.1,
    `st(0,${NOISE});` +
      typingTimes
        .map(([t0, f, a]) => `${n(a)}*(0.8*ld(0)*${hit(t0, 500)}+0.5*sin(2*PI*${f}*(t-${n(t0)}))*${hit(t0, 250)})`)
        .join("+"),
    "highpass=f=400",
  ),
  sfx(
    "coin",
    "코인",
    0.7,
    0.6,
    `st(2,if(lt(t,0.08),${n(hz("B5"))},${n(hz("E6"))}));` +
      `(sin(2*PI*ld(2)*t)+0.33*sin(6*PI*ld(2)*t)+0.2*sin(10*PI*ld(2)*t))` +
      `*if(lt(t,0.08),1-exp(-2000*t),exp(-5*(t-0.08)))`,
    "afade=t=out:st=0.6:d=0.1",
  ),
  sfx(
    "heartbeat",
    "두근 (심장박동)",
    1.6,
    1.5,
    [
      [0, 1],
      [0.22, 0.75],
      [0.8, 1],
      [1.02, 0.75],
    ]
      .map(([t0, a]) => `${n(a)}*if(gte(t,${n(t0)}),sin(${glide(`(t-${n(t0)})`, 90, 45, 20)})*${hit(t0, 11, 300)},0)`)
      .join("+"),
    "lowpass=f=400",
  ),
  sfx(
    "sparkle",
    "반짝 (트윙클)",
    1.3,
    -4.7,
    `(${sparkleNotes.map(([t0, note]) => `sin(2*PI*${n(hz(note))}*t)*${hit(t0, 8)}`).join("+")})` +
      `*(1+0.3*sin(2*PI*12*t))`,
    "afade=t=out:st=1.15:d=0.15",
  ),
  sfx(
    "countdown",
    "카운트다운 (삐삐삐 삐-)",
    4,
    -0.6,
    `${beep(880, 0, 0.15)}+${beep(880, 1, 0.15)}+${beep(880, 2, 0.15)}+${beep(1760, 3, 0.7)}`,
  ),
  sfx(
    "drum-roll",
    "두구두구 (드럼롤)",
    2.6,
    -3.4,
    `st(0,${NOISE});` +
      `ld(0)*exp(-45*mod(t,0.055))*(0.15+0.85*pow(t/2.2,1.5))*lt(t,2.2)` +
      `+ld(0)*${hit(2.2, 6)}+if(gte(t,2.2),sin(${glide("(t-2.2)", 160, 70, 10)})*exp(-8*(t-2.2)),0)`,
    "highpass=f=150,lowpass=f=6000,afade=t=out:st=2.45:d=0.15",
  ),
];

// ---------------------------------------------------------------------------
// 배경음악 (루프: 길이가 마디의 정수배, 모든 주기 신호가 루프 길이로 나누어떨어짐)
// ---------------------------------------------------------------------------

/** 1) 잔잔한 로파이 — 80 BPM, 4마디(12초), Fmaj7–Em7–Dm7–Cmaj7 */
function lofi(): SoundDef {
  const L = 12;
  const chords = [
    ["F3", "A3", "C4", "E4"],
    ["E3", "G3", "B3", "D4"],
    ["D3", "F3", "A3", "C4"],
    ["C3", "E3", "G3", "B3"],
  ];
  const roots = ["F2", "E2", "D2", "C2"].map((r) => lhz(r, L));
  const voices = [0, 1, 2, 3].map((v) => sel("ld(0)", chords.map((c) => lhz(c[v], L))));
  const u = "ld(1)";
  const tonal =
    `st(0,floor(mod(t,12)/3));st(1,mod(t,3));st(3,0);` +
    voices.map((F) => `st(2,${F});st(3,ld(3)+sin(2*PI*ld(2)*t)+0.2*sin(4*PI*ld(2)*t));`).join("") +
    `st(4,max(${pl(u, 0.8, 30)},if(gte(${u},1.875),0.6*${pl(`(${u}-1.875)`, 1.2, 30)},0))*min(1,(3-${u})*12));` +
    `st(2,${sel("ld(0)", roots)});` +
    `0.12*ld(3)*ld(4)` +
    `+0.5*sin(2*PI*ld(2)*t)*max(exp(-1.2*${u}),if(gte(${u},1.5),${pl(`(${u}-1.5)`, 1.2, 60)},0))*(1-exp(-60*${u}))*min(1,(3-${u})*12)` +
    `+0.9*${kick("mod(t,3)", 120, 45, 9)}+0.7*${kick("mod(t-1.875,3)", 120, 45, 9)}`;
  return bgm("bgm-lofi-chill", "잔잔한 로파이", L, -2.1, [
    { expr: tonal, af: "lowpass=f=3200" },
    { expr: `st(0,${NOISE});0.5*ld(0)*exp(-14*mod(t-0.75,1.5))`, af: "highpass=f=1000,lowpass=f=5000" },
    {
      expr: `st(0,${NOISE});0.25*ld(0)*(exp(-60*mod(t,0.75))+0.6*exp(-60*mod(t-0.45,0.75)))`,
      af: "highpass=f=7000",
    },
  ]);
}

/** 2) 신나는 하우스 — 120 BPM, 4마디(8초), Am–F–C–G, 4-on-the-floor + 오프비트 스탭 */
function house(): SoundDef {
  const L = 8;
  const chords = [
    ["A3", "C4", "E4"],
    ["A3", "C4", "F4"],
    ["G3", "C4", "E4"],
    ["G3", "B3", "D4"],
  ];
  const roots = ["A2", "F2", "C3", "G2"].map((r) => lhz(r, L));
  const voices = [0, 1, 2].map((v) => sel("ld(0)", chords.map((c) => lhz(c[v], L))));
  const tonal =
    `st(0,floor(mod(t-0.25,8)/2));st(1,mod(t-0.25,0.5));st(3,0);` +
    voices
      .map(
        (F) =>
          `st(2,${F});st(3,ld(3)+sin(2*PI*ld(2)*t)+0.5*sin(4*PI*ld(2)*t)+0.33*sin(6*PI*ld(2)*t)+0.25*sin(8*PI*ld(2)*t));`,
      )
      .join("") +
    `st(2,${sel("ld(0)", roots)});` +
    `0.12*ld(3)*${pl("ld(1)", 12)}` +
    `+0.45*(sin(2*PI*ld(2)*t)+0.3*sin(4*PI*ld(2)*t))*${pl("ld(1)", 9)}` +
    `+${kick("mod(t,0.5)", 150, 50, 10)}`;
  return bgm("bgm-house-upbeat", "신나는 하우스", L, -1.9, [
    { expr: tonal, af: "lowpass=f=7000" },
    { expr: `st(0,${NOISE});0.5*ld(0)*exp(-20*mod(t-0.5,1))`, af: "highpass=f=900,lowpass=f=4000" },
    {
      expr: `st(0,${NOISE});0.3*ld(0)*(exp(-25*mod(t-0.25,0.5))+0.35*exp(-120*mod(t,0.125)))`,
      af: "highpass=f=7500",
    },
  ]);
}

/** 3) 몽환적인 앰비언트 — 60 BPM, 4마디(16초), 겹치는 패드 + 메아리 벨 */
function ambient(): SoundDef {
  const L = 16;
  const chords = [
    ["C4", "E4", "G4", "B4"],
    ["C4", "E4", "G4", "A4"],
    ["C4", "E4", "F4", "A4"],
    ["D4", "E4", "G4", "B4"],
  ];
  const roots = ["C3", "A2", "F2", "G2"];
  const pads = chords
    .map((c, k) => {
      const tones = c
        .map((note) => `sin(2*PI*${n(lhz(note, L))}*t)+sin(2*PI*${n(lhz(note, L, 1.004))}*t)`)
        .join("+");
      return (
        `st(5,mod(t-${n(4 * k - 1)},16));` +
        `st(6,ld(6)+if(lt(ld(5),6),pow(sin(PI*ld(5)/6),2)*(${tones}+1.5*sin(2*PI*${n(lhz(roots[k], L))}*t)),0));`
      );
    })
    .join("");
  const bells: [number, string][] = [
    [0.5, "E5"],
    [2.5, "B5"],
    [4.5, "C6"],
    [6.5, "A5"],
    [8.5, "G5"],
    [10.5, "E5"],
    [12.5, "D5"],
    [14.5, "G5"],
  ];
  const bellExpr = bells
    .map(([t0, note]) => {
      const f = n(lhz(note, L));
      const env = `(${pl(`mod(t-${n(t0)},16)`, 1.2, 300)}+0.35*${pl(`mod(t-${n(t0 + 0.375)},16)`, 1.2, 300)})`;
      return `(sin(2*PI*${f}*t)+0.2*sin(4*PI*${f}*t))*${env}`;
    })
    .join("+");
  const tonal = `st(6,0);${pads}0.06*ld(6)*(0.8+0.2*sin(2*PI*0.25*t))+0.25*(${bellExpr})`;
  return bgm("bgm-ambient-dream", "몽환적인 앰비언트", L, 5.4, [
    { expr: tonal },
    {
      expr: `st(0,${NOISE});st(2,ld(2)+0.02*(ld(0)-ld(2)));ld(2)*pow(sin(PI*t/8),2)`,
      af: "highpass=f=200",
    },
  ]);
}

/** 4) 긴장감 시네마틱 — 100 BPM, 4마디(9.6초), D 드론 + 8분 펄스 + 반음 현 트레몰로 */
function cinematic(): SoundDef {
  const L = 9.6;
  const saw = (note: string) => {
    const f = n(lhz(note, L));
    return `(sin(2*PI*${f}*t)+0.5*sin(4*PI*${f}*t)+0.33*sin(6*PI*${f}*t))`;
  };
  const pulseNotes = ["D3", "D3", "Bb2", "A2"].map((x) => lhz(x, L));
  const trem = Math.round((25 / 3) * L) / L;
  const tonal =
    `st(0,floor(mod(t,9.6)/2.4));st(1,mod(t,0.3));st(4,mod(t,4.8));` +
    `st(2,${sel("ld(0)", pulseNotes)});` +
    `st(3,if(lt(mod(t,9.6),4.8),${n(lhz("A4", L))},${n(lhz("Bb4", L))}));` +
    `0.22*(${saw("D2")}+0.7*${saw("A2")}+0.5*sin(2*PI*${n(lhz("D3", L))}*t))*(0.75+0.25*sin(2*PI*t/9.6))` +
    `+0.35*(sin(2*PI*ld(2)*t)+0.6*sin(4*PI*ld(2)*t)+0.3*sin(6*PI*ld(2)*t))*${pl("ld(1)", 12, 500)}` +
    `*(0.6+0.4*eq(mod(floor(t/0.3),2),0))` +
    `+0.18*(sin(2*PI*ld(3)*t)+0.4*sin(4*PI*ld(3)*t))*pow(sin(PI*ld(4)/4.8),2)*(0.6+0.4*sin(2*PI*${n(trem)}*t))` +
    `+0.8*sin(${glide("ld(4)", 90, 32, 5)})*${pl("ld(4)", 2.5, 300)}`;
  return bgm("bgm-cinematic-tension", "긴장감 시네마틱", L, -3.1, [
    { expr: tonal, af: "lowpass=f=5000" },
    {
      expr: `st(0,${NOISE});ld(0)*(0.25*exp(-90*mod(t,0.6))+0.6*if(gte(t,7.2),pow((t-7.2)/2.4,2)*min(1,(9.6-t)*30),0))`,
      af: "highpass=f=2500",
    },
  ]);
}

/** 5) 귀여운 플럭 — 120 BPM, 4마디(8초), C–Am–F–G, 8분음표 플럭 멜로디 */
function cutePluck(): SoundDef {
  const L = 8;
  const melody = [
    "E5", "G5", "C6", "G5", "E5", "G5", "A5", "G5",
    "C5", "E5", "A5", "E5", "C5", "E5", "G5", "E5",
    "F5", "A5", "C6", "A5", "F5", "A5", "G5", "F5",
    "D5", "G5", "B5", "G5", "D5", "F5", "G5", "-",
  ].map((x) => (x === "-" ? 0 : lhz(x, L)));
  const chords = [
    ["G4", "C4", "E4", "C5"],
    ["A4", "C4", "E4", "A4"],
    ["A4", "C4", "F4", "A4"],
    ["G4", "B3", "D4", "G4"],
  ];
  const roots = ["C3", "A2", "F2", "G2"].map((r) => lhz(r, L));
  const voices = [0, 1, 2, 3].map((v) => sel("ld(3)", chords.map((c) => lhz(c[v], L))));
  const tonal =
    `st(0,floor(mod(t,8)/0.25));st(1,mod(t,0.25));st(3,floor(mod(t,8)/2));st(4,mod(t,1));` +
    `st(2,${sel("ld(0)", melody)});` +
    `st(6,0.4*(sin(2*PI*ld(2)*t)+0.5*sin(4*PI*ld(2)*t)*exp(-8*ld(1))+0.25*sin(6*PI*ld(2)*t)*exp(-14*ld(1)))` +
    `*${pl("ld(1)", 7, 600)}*min(1,(0.25-ld(1))*40));` +
    `st(7,0);` +
    voices.map((F) => `st(2,${F});st(7,ld(7)+sin(2*PI*ld(2)*t)+0.3*sin(4*PI*ld(2)*t));`).join("") +
    `st(2,${sel("ld(3)", roots)});` +
    `ld(6)+0.08*ld(7)*${pl("ld(4)", 4, 300)}+0.35*sin(2*PI*ld(2)*t)*${pl("ld(4)", 5, 300)}`;
  return bgm("bgm-cute-pluck", "귀여운 플럭", L, -0.8, [
    { expr: tonal },
    {
      expr: `st(0,${NOISE});0.3*ld(0)*exp(-45*mod(t,0.25))*(0.5+0.5*eq(mod(floor(t/0.25),2),1))`,
      af: "highpass=f=6000",
    },
  ]);
}

export const SOUNDS: SoundDef[] = [...EFFECTS, lofi(), house(), ambient(), cinematic(), cutePluck()];
