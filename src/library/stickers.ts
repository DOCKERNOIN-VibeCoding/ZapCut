// 짭컷 자체 제작 스티커 (모두 직접 그린 벡터)
// 모든 도형은 짭컷 용으로 새로 그린 단순 벡터이며, 외부 브랜드/캐릭터를 참조하지 않는다.

export type StickerCategory = "감탄" | "하트·별" | "화살표·도형" | "라벨" | "표정" | "생활" | "손그림";

export interface StickerDef {
  id: string;
  name: string;
  category: StickerCategory;
  svg: string;
}

export const STICKER_CATEGORIES: StickerCategory[] = ["감탄", "하트·별", "화살표·도형", "라벨", "표정", "생활", "손그림"];

// ---------- 공통 그리기 도우미 ----------
const INK = "#1b1b1f";
const FONT = `'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif`;
const OL = `stroke="${INK}" stroke-width="8" stroke-linejoin="round"`;
const r1 = (v: number) => Math.round(v * 10) / 10;

const svg = (body: string, defs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${defs ? `<defs>${defs}</defs>` : ""}${body}</svg>`;

/** 굵은 텍스트 (cy = 시각적 중심) */
const txt = (s: string, x: number, cy: number, size: number, fill = "#fff", stroke = INK, sw = 12) =>
  `<text x="${x}" y="${r1(cy + size * 0.36)}" font-family="${FONT}" font-size="${size}" font-weight="900" text-anchor="middle" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke">${s}</text>`;

/** 별/버스트 꼭짓점 (jag = 바깥 꼭짓점 길이를 번갈아 줄여 만화풍으로) */
const pts = (n: number, ro: number, ri: number, cx = 128, cy = 128, jag = 0) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 ? ri : i % 4 === 0 ? ro : ro - jag;
    const a = ((-90 + (i * 180) / n) * Math.PI) / 180;
    return `${r1(cx + r * Math.cos(a))},${r1(cy + r * Math.sin(a))}`;
  }).join(" ");

const poly = (p: string, fill: string, extra = OL) => `<polygon points="${p}" fill="${fill}" ${extra}/>`;

/** 테두리 + 색 스트로크 2겹 선 */
const dbl = (d: string, color: string, w: number, outline = INK, ow = 16) =>
  `<path d="${d}" fill="none" stroke="${outline}" stroke-width="${w + ow}" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** 단색 선 */
const line = (d: string, w = 12, color = INK) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** 손그림 선 (흰색 컷라인) */
const doodle = (d: string, color: string, w = 14) => dbl(d, color, w, "#fff", 12);

const HEART =
  "M128 224 C128 224 20 160 20 92 C20 54 48 30 80 30 C104 30 120 44 128 60 C136 44 152 30 176 30 C208 30 236 54 236 92 C236 160 128 224 128 224 Z";
const heart = (fill: string, tx = 0, ty = 0, s = 1, sw = 8) =>
  `<path d="${HEART}" fill="${fill}"${sw ? ` stroke="${INK}" stroke-width="${r1(sw / s)}" stroke-linejoin="round"` : ""}${
    s !== 1 || tx || ty ? ` transform="translate(${r1(tx)} ${r1(ty)}) scale(${s})"` : ""
  }/>`;

/** 4각 반짝이 */
const spark = (cx: number, cy: number, r: number, fill: string, sw = 8) => {
  const a = r1(r * 0.09);
  const b = r1(r * 0.3);
  return `<path d="M${cx} ${cy - r} C${cx + a} ${cy - b} ${cx + b} ${cy - a} ${cx + r} ${cy} C${cx + b} ${cy + a} ${cx + a} ${cy + b} ${cx} ${cy + r} C${cx - a} ${cy + b} ${cx - b} ${cy + a} ${cx - r} ${cy} C${cx - b} ${cy - a} ${cx - a} ${cy - b} ${cx} ${cy - r} Z" fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
};

// 말풍선 모양
const BUBBLE_RECT =
  "M56 28 H200 A40 40 0 0 1 240 68 V148 A40 40 0 0 1 200 188 H120 L72 236 L84 188 H56 A40 40 0 0 1 16 148 V68 A40 40 0 0 1 56 28 Z";
const BUBBLE_OVAL =
  "M128 20 C196 20 244 60 244 112 C244 164 196 204 128 204 C116 204 104 203 93 200 L44 236 L58 186 C30 170 12 143 12 112 C12 60 60 20 128 20 Z";
const bubble = (d: string, fill: string) => `<path d="${d}" fill="${fill}" ${OL}/>`;

// 얼굴 바탕
const face = (fill = "#ffd23f", cx = 128, cy = 128, r = 116) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${OL}/>`;
const cheeks = `<ellipse cx="62" cy="150" rx="18" ry="11" fill="#ff7aa2" opacity=".7"/><ellipse cx="194" cy="150" rx="18" ry="11" fill="#ff7aa2" opacity=".7"/>`;

// ---------- 스티커 목록 ----------
export const STICKERS: StickerDef[] = [
  // ===== 감탄 =====
  {
    id: "exclaim-wa",
    name: "와!",
    category: "감탄",
    svg: svg(poly(pts(16, 116, 86, 128, 128, 12), "#ffd23f") + txt("와!", 128, 128, 92, "#ff3b5c", INK, 14)),
  },
  {
    id: "exclaim-daebak",
    name: "대박",
    category: "감탄",
    svg: svg(bubble(BUBBLE_RECT, "#ff5fa2") + txt("대박", 128, 108, 80)),
  },
  {
    id: "exclaim-kkk",
    name: "ㅋㅋㅋ",
    category: "감탄",
    svg: svg(bubble(BUBBLE_OVAL, "#ffe14d") + txt("ㅋㅋㅋ", 128, 112, 70, "#ff8a00")),
  },
  {
    id: "exclaim-heol",
    name: "헐",
    category: "감탄",
    svg: svg(poly(pts(12, 116, 80, 128, 128, 14), "#3d8bff") + txt("헐", 128, 128, 116, "#fff", INK, 14)),
  },
  {
    id: "exclaim-jjang",
    name: "짱!",
    category: "감탄",
    svg: svg(bubble(BUBBLE_RECT, "#ff8a00") + spark(214, 46, 26, "#fff", 6) + txt("짱!", 128, 108, 92, "#ffe14d")),
  },
  {
    id: "exclaim-omg",
    name: "OMG",
    category: "감탄",
    svg: svg(poly(pts(14, 116, 90, 128, 128, 10), "#9b5cff") + txt("OMG", 128, 128, 62, "#ffe14d")),
  },
  {
    id: "exclaim-wow",
    name: "WOW",
    category: "감탄",
    svg: svg(bubble(BUBBLE_OVAL, "#2ad4c4") + txt("WOW", 128, 112, 62)),
  },
  {
    id: "exclaim-ggultip",
    name: "꿀팁",
    category: "감탄",
    svg: svg(bubble(BUBBLE_RECT, "#ffb300") + spark(42, 50, 22, "#fff", 6) + txt("꿀팁", 128, 108, 76)),
  },

  // ===== 하트·별 =====
  {
    id: "heart",
    name: "하트",
    category: "하트·별",
    svg: svg(heart("#ff3b5c") + `<ellipse cx="74" cy="78" rx="20" ry="12" transform="rotate(-35 74 78)" fill="#fff" opacity=".75"/>`),
  },
  {
    id: "heart-double",
    name: "더블 하트",
    category: "하트·별",
    svg: svg(heart("#ff9ec4", 116, 6, 0.5) + heart("#ff3b5c", 8, 40, 0.75) + `<ellipse cx="72" cy="104" rx="14" ry="9" transform="rotate(-35 72 104)" fill="#fff" opacity=".75"/>`),
  },
  {
    id: "star",
    name: "별",
    category: "하트·별",
    svg: svg(poly(pts(5, 118, 54, 128, 136), "#ffd23f") + `<ellipse cx="104" cy="104" rx="14" ry="9" transform="rotate(-30 104 104)" fill="#fff" opacity=".8"/>`),
  },
  {
    id: "sparkle",
    name: "반짝",
    category: "하트·별",
    svg: svg(
      spark(128, 128, 116, "url(#st-sparkle-g)"),
      `<linearGradient id="st-sparkle-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff27a"/><stop offset="1" stop-color="#ff7ac0"/></linearGradient>`,
    ),
  },
  {
    id: "twinkle",
    name: "반짝반짝",
    category: "하트·별",
    svg: svg(spark(104, 144, 88, "#ffd23f") + spark(192, 64, 48, "#5ee0ff") + spark(204, 200, 32, "#ff7ac0", 6)),
  },
  {
    id: "shooting-star",
    name: "별똥별",
    category: "하트·별",
    svg: svg(
      dbl("M150 112 L34 222", "#ff7ac0", 20, INK, 12) +
        dbl("M124 78 L30 166", "#ffe14d", 12, INK, 12) +
        dbl("M168 136 L88 214", "#5ee0ff", 12, INK, 12) +
        poly(pts(5, 64, 30, 180, 78), "#ffd23f"),
    ),
  },
  {
    id: "heart-glow",
    name: "빛나는 하트",
    category: "하트·별",
    svg: svg(
      `<circle cx="128" cy="128" r="120" fill="url(#st-hglow-g)"/>` +
        line("M128 10 V30 M128 226 V246 M10 128 H30 M226 128 H246 M44 44 L58 58 M212 44 L198 58 M44 212 L58 198 M212 212 L198 198", 10, "#ffb300") +
        heart("#ff3b5c", 38.4, 38, 0.7) +
        `<ellipse cx="92" cy="94" rx="13" ry="8" transform="rotate(-35 92 94)" fill="#fff" opacity=".8"/>`,
      `<radialGradient id="st-hglow-g"><stop offset=".3" stop-color="#ffe08a" stop-opacity=".95"/><stop offset="1" stop-color="#ffe08a" stop-opacity="0"/></radialGradient>`,
    ),
  },
  {
    id: "star-badge",
    name: "별 배지",
    category: "하트·별",
    svg: svg(
      poly(pts(24, 118, 104), "#3d8bff") +
        `<circle cx="128" cy="128" r="84" fill="#fff" ${OL}/>` +
        poly(pts(5, 64, 28, 128, 134), "#ffd23f"),
    ),
  },

  // ===== 화살표·도형 =====
  {
    id: "arrow-curved",
    name: "곡선 화살표",
    category: "화살표·도형",
    svg: svg(
      line("M36 216 Q40 80 160 76", 46) + poly("148,28 234,78 148,128", "#ff8a00") + line("M36 216 Q40 80 166 76", 28, "#ff8a00"),
    ),
  },
  {
    id: "arrow-bold",
    name: "굵은 화살표",
    category: "화살표·도형",
    svg: svg(`<path d="M16 92 H136 V36 L238 128 L136 220 V164 H16 Z" fill="#3d8bff" ${OL}/><path d="M32 108 H120" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".6"/>`),
  },
  {
    id: "ring",
    name: "동그라미",
    category: "화살표·도형",
    svg: svg(`<circle cx="128" cy="128" r="96" fill="none" stroke="${INK}" stroke-width="44"/><circle cx="128" cy="128" r="96" fill="none" stroke="#ff3b5c" stroke-width="28"/>`),
  },
  {
    id: "check",
    name: "체크",
    category: "화살표·도형",
    svg: svg(dbl("M40 134 L102 194 L220 64", "#22c55e", 34, INK, 18)),
  },
  {
    id: "x-mark",
    name: "엑스",
    category: "화살표·도형",
    svg: svg(dbl("M54 54 L202 202 M202 54 L54 202", "#ff3b5c", 34, INK, 18)),
  },
  {
    id: "exclamation",
    name: "느낌표",
    category: "화살표·도형",
    svg: svg(`<rect x="98" y="14" width="60" height="162" rx="30" fill="#ffd23f" ${OL}/><circle cx="128" cy="214" r="26" fill="#ffd23f" ${OL}/>`),
  },
  {
    id: "question",
    name: "물음표",
    category: "화살표·도형",
    svg: svg(
      dbl("M78 96 C78 56 104 36 132 36 C166 36 186 60 186 88 C186 124 132 126 132 160", "#9b5cff", 34, INK, 18) +
        `<circle cx="132" cy="214" r="24" fill="#9b5cff" ${OL}/>`,
    ),
  },
  {
    id: "pointing-hand",
    name: "가리키는 손",
    category: "화살표·도형",
    svg: svg(
      `<rect x="12" y="100" width="36" height="104" rx="10" fill="#3d8bff" ${OL}/>` +
        `<rect x="40" y="92" width="108" height="120" rx="34" fill="#ffcf9e" ${OL}/>` +
        `<rect x="112" y="92" width="132" height="44" rx="22" fill="#ffcf9e" ${OL}/>` +
        `<rect x="118" y="136" width="50" height="28" rx="14" fill="#ffcf9e" ${OL}/>` +
        `<rect x="118" y="164" width="46" height="26" rx="13" fill="#ffcf9e" ${OL}/>` +
        `<rect x="116" y="188" width="40" height="24" rx="12" fill="#ffcf9e" ${OL}/>` +
        `<rect x="66" y="120" width="72" height="32" rx="16" fill="#ffcf9e" ${OL}/>`,
    ),
  },

  // ===== 라벨 =====
  {
    id: "label-new",
    name: "NEW",
    category: "라벨",
    svg: svg(`<rect x="12" y="72" width="232" height="112" rx="56" fill="#22c55e" ${OL}/>` + txt("NEW", 128, 128, 70)),
  },
  {
    id: "label-best",
    name: "BEST",
    category: "라벨",
    svg: svg(
      `<path d="M8 84 H248 L224 128 L248 172 H8 L32 128 Z" fill="#ff3b5c" ${OL}/>` +
        poly(pts(5, 22, 10, 128, 52), "#ffd23f", `stroke="${INK}" stroke-width="6" stroke-linejoin="round"`) +
        txt("BEST", 128, 128, 62),
    ),
  },
  {
    id: "label-sale",
    name: "SALE",
    category: "라벨",
    svg: svg(
      `<path d="M62 48 H224 A16 16 0 0 1 240 64 V192 A16 16 0 0 1 224 208 H62 L16 128 Z" fill="#ffd23f" ${OL}/>` +
        `<circle cx="52" cy="128" r="10" fill="#fff" ${OL}/>` +
        txt("SALE", 148, 128, 50, "#ff3b5c"),
    ),
  },
  {
    id: "label-hot",
    name: "HOT",
    category: "라벨",
    svg: svg(
      `<rect x="12" y="84" width="232" height="104" rx="52" fill="url(#st-hot-g)" ${OL}/>` +
        `<path d="M204 18 C228 44 238 62 230 84 C222 102 186 102 180 84 C174 68 188 60 190 44 C196 56 202 58 204 18 Z" fill="#ffd23f" ${OL}/>` +
        txt("HOT", 120, 136, 66),
      `<linearGradient id="st-hot-g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffb300"/><stop offset="1" stop-color="#ff3b30"/></linearGradient>`,
    ),
  },
  {
    id: "label-live",
    name: "LIVE",
    category: "라벨",
    svg: svg(`<rect x="12" y="80" width="232" height="96" rx="22" fill="#ff3b5c" ${OL}/><circle cx="56" cy="128" r="14" fill="#fff"/>` + txt("LIVE", 150, 128, 54)),
  },
  {
    id: "label-subscribe",
    name: "구독",
    category: "라벨",
    svg: svg(
      `<rect x="12" y="76" width="232" height="104" rx="52" fill="#7c4dff" ${OL}/>` +
        `<circle cx="66" cy="128" r="30" fill="#fff" stroke="${INK}" stroke-width="6"/>` +
        line("M66 112 V144 M50 128 H82", 9) +
        txt("구독", 160, 128, 62),
    ),
  },
  {
    id: "label-like",
    name: "좋아요",
    category: "라벨",
    svg: svg(
      `<rect x="8" y="80" width="240" height="96" rx="48" fill="#ff5fa2" ${OL}/>` +
        heart("#fff", 51 - 128 * 0.2, 128 - 127 * 0.2, 0.2, 5) +
        txt("좋아요", 156, 128, 48),
    ),
  },
  {
    id: "label-pick",
    name: "PICK",
    category: "라벨",
    svg: svg(
      `<g transform="rotate(-8 128 128)"><rect x="20" y="76" width="216" height="104" rx="18" fill="#ffd23f" ${OL}/>` +
        poly(pts(5, 18, 8, 222, 82), "#ff3b5c", `stroke="${INK}" stroke-width="5" stroke-linejoin="round"`) +
        txt("PICK", 128, 128, 64, INK, "#fff", 10) +
        `</g>`,
    ),
  },

  // ===== 표정 =====
  {
    id: "face-smile",
    name: "미소",
    category: "표정",
    svg: svg(
      face() +
        `<ellipse cx="88" cy="104" rx="14" ry="20" fill="${INK}"/><ellipse cx="168" cy="104" rx="14" ry="20" fill="${INK}"/>` +
        cheeks +
        line("M80 156 Q128 204 176 156"),
    ),
  },
  {
    id: "face-laugh",
    name: "빵 터짐",
    category: "표정",
    svg: svg(
      face() +
        line("M66 110 Q88 80 110 110 M146 110 Q168 80 190 110") +
        `<path d="M70 144 H186 Q186 214 128 214 Q70 214 70 144 Z" fill="${INK}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>` +
        `<path d="M98 198 Q128 174 158 198 Q146 212 128 212 Q110 212 98 198 Z" fill="#ff6b8a"/>`,
    ),
  },
  {
    id: "face-cry",
    name: "엉엉",
    category: "표정",
    svg: svg(
      face() +
        line("M66 104 Q88 124 110 104 M146 104 Q168 124 190 104") +
        `<path d="M80 120 V206 M176 120 V206" stroke="#5ec8ff" stroke-width="20" stroke-linecap="round"/>` +
        line("M98 186 Q128 160 158 186", 10),
    ),
  },
  {
    id: "face-surprised",
    name: "깜짝",
    category: "표정",
    svg: svg(
      face() +
        line("M64 64 Q88 48 112 64 M144 64 Q168 48 192 64", 10) +
        `<circle cx="88" cy="106" r="24" fill="#fff" stroke="${INK}" stroke-width="7"/><circle cx="168" cy="106" r="24" fill="#fff" stroke="${INK}" stroke-width="7"/>` +
        `<circle cx="88" cy="108" r="10" fill="${INK}"/><circle cx="168" cy="108" r="10" fill="${INK}"/>` +
        `<ellipse cx="128" cy="180" rx="22" ry="30" fill="${INK}"/>`,
    ),
  },
  {
    id: "face-heart-eyes",
    name: "하트 눈",
    category: "표정",
    svg: svg(
      face() +
        heart("#ff3b5c", 88 - 128 * 0.26, 102 - 127 * 0.26, 0.26, 5) +
        heart("#ff3b5c", 168 - 128 * 0.26, 102 - 127 * 0.26, 0.26, 5) +
        `<path d="M76 150 Q128 222 180 150 Z" fill="${INK}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`,
    ),
  },
  {
    id: "face-cool",
    name: "쿨",
    category: "표정",
    svg: svg(
      face() +
        line("M18 102 H238", 8) +
        `<rect x="50" y="90" width="70" height="48" rx="16" fill="${INK}"/><rect x="136" y="90" width="70" height="48" rx="16" fill="${INK}"/>` +
        line("M66 104 L84 104 M152 104 L170 104", 6, "#9fd8ff") +
        line("M96 178 Q140 196 172 164"),
    ),
  },
  {
    id: "face-angry",
    name: "버럭",
    category: "표정",
    svg: svg(
      face("#ff7a59") +
        line("M62 78 L112 102 M194 78 L144 102") +
        `<ellipse cx="92" cy="122" rx="12" ry="15" fill="${INK}"/><ellipse cx="164" cy="122" rx="12" ry="15" fill="${INK}"/>` +
        line("M88 190 Q128 158 168 190") +
        line("M196 34 L206 50 M214 28 L218 46 M226 44 L214 54", 7, "#ff3b30"),
    ),
  },
  {
    id: "face-sleepy",
    name: "졸려",
    category: "표정",
    svg: svg(
      face("#ffd23f", 112, 140, 104) +
        line("M62 138 Q82 152 102 138 M122 138 Q142 152 162 138", 10) +
        `<ellipse cx="112" cy="192" rx="12" ry="14" fill="${INK}"/>` +
        `<ellipse cx="54" cy="168" rx="14" ry="9" fill="#ff7aa2" opacity=".7"/><ellipse cx="170" cy="168" rx="14" ry="9" fill="#ff7aa2" opacity=".7"/>` +
        txt("Z", 192, 64, 52, "#8fb8ff", INK, 10) +
        txt("z", 228, 30, 34, "#8fb8ff", INK, 8),
    ),
  },

  // ===== 생활 =====
  {
    id: "life-pin",
    name: "위치",
    category: "생활",
    svg: svg(
      `<path d="M128 242 C128 242 40 150 40 98 C40 48 80 12 128 12 C176 12 216 48 216 98 C216 150 128 242 128 242 Z" fill="#ff3b5c" ${OL}/>` +
        `<circle cx="128" cy="96" r="34" fill="#fff" ${OL}/>`,
    ),
  },
  {
    id: "life-clock",
    name: "시계",
    category: "생활",
    svg: svg(
      `<circle cx="128" cy="128" r="114" fill="#3d8bff" ${OL}/><circle cx="128" cy="128" r="88" fill="#fff" ${OL}/>` +
        line("M128 52 V66 M128 190 V204 M52 128 H66 M190 128 H204", 8) +
        line("M128 128 V74 M128 128 L170 150", 12) +
        `<circle cx="128" cy="128" r="10" fill="#ff3b5c" stroke="${INK}" stroke-width="5"/>`,
    ),
  },
  {
    id: "life-camera",
    name: "카메라",
    category: "생활",
    svg: svg(
      `<path d="M78 66 L96 36 H160 L178 66 Z" fill="#4a4a55" ${OL}/>` +
        `<rect x="14" y="60" width="228" height="164" rx="28" fill="#2ad4c4" ${OL}/>` +
        `<circle cx="128" cy="144" r="58" fill="#fff" ${OL}/><circle cx="128" cy="144" r="36" fill="#3d8bff" ${OL}/>` +
        `<circle cx="116" cy="132" r="9" fill="#fff"/>` +
        `<rect x="186" y="82" width="32" height="18" rx="6" fill="#ffd23f" stroke="${INK}" stroke-width="6"/>`,
    ),
  },
  {
    id: "life-coffee",
    name: "커피",
    category: "생활",
    svg: svg(
      line("M84 70 C70 54 98 44 84 22 M120 70 C106 54 134 44 120 22 M156 70 C142 54 170 44 156 22", 10) +
        line("M186 118 C240 110 240 196 176 190", 30) +
        line("M186 118 C240 110 240 196 176 190", 14, "#ff8fab") +
        `<path d="M32 88 H200 L184 214 Q182 234 162 234 H70 Q50 234 48 214 Z" fill="#ff8fab" ${OL}/>` +
        heart("#fff", 116 - 128 * 0.26, 160 - 127 * 0.26, 0.26, 0),
    ),
  },
  {
    id: "life-music",
    name: "음표",
    category: "생활",
    svg: svg(
      line("M104 70 V188 M216 44 V164", 16) +
        poly("96,44 224,16 224,58 96,86", INK) +
        `<ellipse cx="76" cy="194" rx="36" ry="27" transform="rotate(-20 76 194)" fill="#9b5cff" ${OL}/>` +
        `<ellipse cx="188" cy="170" rx="36" ry="27" transform="rotate(-20 188 170)" fill="#ff5fa2" ${OL}/>`,
    ),
  },
  {
    id: "life-gift",
    name: "선물",
    category: "생활",
    svg: svg(
      `<rect x="34" y="124" width="188" height="114" rx="8" fill="#ff5fa2" ${OL}/>` +
        `<rect x="18" y="86" width="220" height="44" rx="8" fill="#ff3b5c" ${OL}/>` +
        `<rect x="112" y="86" width="32" height="152" fill="#ffd23f" ${OL}/>` +
        `<path d="M128 86 C88 34 44 50 66 80 C78 94 106 90 128 86 Z M128 86 C168 34 212 50 190 80 C178 94 150 90 128 86 Z" fill="#ffd23f" ${OL}/>`,
    ),
  },
  {
    id: "life-cake",
    name: "케이크",
    category: "생활",
    svg: svg(
      `<ellipse cx="128" cy="224" rx="116" ry="18" fill="#fff" ${OL}/>` +
        `<rect x="36" y="118" width="184" height="102" rx="12" fill="#ffd6a5" ${OL}/>` +
        `<path d="M36 132 Q36 116 52 116 H204 Q220 116 220 132 V150 Q212 166 204 150 Q196 136 184 150 V170 Q176 184 168 170 V150 Q156 136 140 152 Q128 166 116 152 Q104 136 92 150 V168 Q84 182 76 168 V150 Q64 136 52 152 Q44 162 36 150 Z" fill="#ff8fb1" ${OL}/>` +
        `<rect x="82" y="70" width="12" height="46" rx="3" fill="#5ec8ff" stroke="${INK}" stroke-width="5"/><rect x="122" y="62" width="12" height="54" rx="3" fill="#ffd23f" stroke="${INK}" stroke-width="5"/><rect x="162" y="70" width="12" height="46" rx="3" fill="#9b5cff" stroke="${INK}" stroke-width="5"/>` +
        `<path d="M88 34 C98 48 100 60 88 64 C76 60 78 48 88 34 Z M128 26 C138 40 140 52 128 56 C116 52 118 40 128 26 Z M168 34 C178 48 180 60 168 64 C156 60 158 48 168 34 Z" fill="#ffb300" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`,
    ),
  },
  {
    id: "life-airplane",
    name: "비행기",
    category: "생활",
    svg: svg(
      `<g transform="rotate(45 128 128)">` +
        poly("128,92 234,148 234,170 128,142 22,170 22,148", "#7fb5ff") +
        poly("128,192 170,222 170,234 128,222 86,234 86,222", "#7fb5ff") +
        `<rect x="110" y="16" width="36" height="220" rx="18" fill="#fff" ${OL}/>` +
        `<path d="M118 46 Q128 30 138 46" fill="none" stroke="#3d8bff" stroke-width="8" stroke-linecap="round"/>` +
        `</g>`,
    ),
  },

  // ===== 손그림 =====
  {
    id: "doodle-underline",
    name: "밑줄 낙서",
    category: "손그림",
    svg: svg(doodle("M20 132 C70 120 150 118 236 114 C170 128 92 140 34 162 C100 154 168 148 228 146 C180 160 120 168 70 182", "#ffe14d", 22)),
  },
  {
    id: "doodle-circle",
    name: "동그라미 낙서",
    category: "손그림",
    svg: svg(doodle("M150 34 C80 24 24 70 26 130 C28 194 90 230 150 222 C212 214 238 162 226 108 C214 58 162 32 98 44", "#ff3b5c", 12)),
  },
  {
    id: "doodle-wave",
    name: "물결선",
    category: "손그림",
    svg: svg(doodle("M20 130 C38 92 62 94 76 128 S114 166 132 130 S170 90 188 126 S224 166 234 124", "#2ad4c4", 16)),
  },
  {
    id: "doodle-sparkle",
    name: "반짝 낙서",
    category: "손그림",
    svg: svg(
      doodle(
        "M128 22 L130 74 M126 182 L129 234 M22 129 L74 126 M182 130 L234 127 M58 56 L90 90 M200 58 L168 88 M56 200 L90 166 M198 198 L166 168 M128 104 C132 120 136 124 152 128 C136 132 132 136 128 152 C124 136 120 132 104 128 C120 124 124 120 128 104",
        "#ffb300",
        12,
      ),
    ),
  },
  {
    id: "doodle-arrow",
    name: "화살표 낙서",
    category: "손그림",
    svg: svg(doodle("M28 214 C48 150 96 120 112 160 C126 196 70 196 84 150 C100 100 160 70 220 58 M188 36 L222 58 L194 88", "#3d8bff", 12)),
  },
  {
    id: "doodle-crown",
    name: "왕관 낙서",
    category: "손그림",
    svg: svg(
      doodle("M42 188 L30 82 L86 132 L128 52 L172 130 L226 80 L214 190 Z M46 218 C100 210 160 214 212 216", "#ffb300", 12) +
        doodle("M30 66 a1 1 0 0 0 0 1 M128 34 a1 1 0 0 0 0 1 M226 64 a1 1 0 0 0 0 1", "#ffb300", 16),
    ),
  },
  {
    id: "doodle-sun",
    name: "해 낙서",
    category: "손그림",
    svg: svg(
      doodle(
        "M128 78 C160 76 182 102 180 130 C178 160 154 182 126 180 C96 178 74 154 76 126 C78 100 100 80 134 80 M128 22 L130 56 M127 200 L129 234 M200 128 L234 126 M22 130 L56 128 M178 78 L202 54 M78 78 L54 54 M178 178 L204 202 M78 178 L52 204",
        "#ff8a00",
        12,
      ),
    ),
  },
  {
    id: "doodle-bracket",
    name: "강조 괄호",
    category: "손그림",
    svg: svg(
      doodle("M76 30 C40 66 36 190 78 228 M180 30 C216 66 220 190 178 228", "#9b5cff", 14) +
        doodle("M44 42 L24 26 M212 42 L232 26 M44 216 L24 232 M212 216 L232 232", "#ff5fa2", 10),
    ),
  },
];
