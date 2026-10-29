// 텍스트 템플릿 = 글자 스타일 + 인/아웃/반복 애니메이션 조합 (ZapCut 자체 구성)
import type { AnimRef, TextStyle } from "../core/types";

export interface TextTemplate {
  id: string;
  name: string;
  category: "기본" | "제목" | "자막" | "강조" | "감성" | "예능";
  content: string;
  style: Partial<TextStyle>;
  animIn?: AnimRef;
  animOut?: AnimRef;
  animLoop?: AnimRef;
  y?: number; // 세로 위치 (캔버스 비율, 기본 0.3)
  duration?: number;
}

const A = (id: string, duration = 0.5): AnimRef => ({ id, duration });
const BOLD = { bold: true, fontFamily: "Malgun Gothic" };

export const TEXT_TEMPLATES: TextTemplate[] = [
  // 기본
  { id: "plain", name: "기본", category: "기본", content: "텍스트", style: {}, animIn: A("fade"), animOut: A("fade") },
  { id: "outline", name: "굵은 외곽선", category: "기본", content: "외곽선 텍스트", style: { ...BOLD, color: "#ffe14d", strokeColor: "#000000", strokeWidth: 10, fontSize: 110 }, animIn: A("pop", 0.4) },
  { id: "shadow", name: "그림자", category: "기본", content: "그림자 텍스트", style: { ...BOLD, strokeWidth: 0, shadowColor: "rgba(0,0,0,0.7)", shadowBlur: 12, shadowX: 6, shadowY: 6 }, animIn: A("slide-up") },
  { id: "box", name: "박스 배경", category: "기본", content: "박스 텍스트", style: { color: "#111111", strokeWidth: 0, background: "#ffffff", bgRadius: 18, fontSize: 72 }, animIn: A("zoom-in", 0.4) },
  { id: "gradient", name: "그라데이션", category: "기본", content: "그라데이션", style: { ...BOLD, color: "#ffd86b", color2: "#ff5c8a", strokeColor: "#2a0a1a", strokeWidth: 6, fontSize: 120 }, animIn: A("rise", 0.6) },
  // 제목
  { id: "title-cinema", name: "시네마 타이틀", category: "제목", content: "THE JOURNEY", style: { fontFamily: "Georgia", bold: false, strokeWidth: 0, letterSpacing: 24, fontSize: 110 }, animIn: A("fade", 1.2), animOut: A("fade", 1), y: 0 },
  { id: "title-impact", name: "임팩트 타이틀", category: "제목", content: "대박 사건!", style: { fontFamily: "Impact", bold: true, color: "#ffffff", strokeColor: "#e8173c", strokeWidth: 14, fontSize: 150 }, animIn: A("zoom-out", 0.35), animLoop: A("shake", 1), y: 0 },
  { id: "title-neon", name: "네온 사인", category: "제목", content: "NEON NIGHT", style: { ...BOLD, color: "#ffffff", glow: "#ff3df2", strokeWidth: 0, fontSize: 130 }, animIn: A("blink", 0.8), animLoop: A("flicker", 1.6), y: 0 },
  { id: "title-mint", name: "민트 타이틀", category: "제목", content: "오늘의 기록", style: { ...BOLD, color: "#3ff2c4", strokeColor: "#003a2e", strokeWidth: 6, fontSize: 130 }, animIn: A("drop", 0.7) },
  { id: "title-minimal", name: "미니멀", category: "제목", content: "minimal", style: { fontFamily: "Segoe UI", bold: false, strokeWidth: 0, letterSpacing: 40, fontSize: 80, color: "#f4f4f4" }, animIn: A("stretch", 0.8), animOut: A("fade") },
  { id: "title-retro", name: "레트로 80s", category: "제목", content: "RETRO 80s", style: { ...BOLD, italic: true, color: "#ffe066", color2: "#ff6b9d", strokeColor: "#2b145c", strokeWidth: 10, fontSize: 140, shadowColor: "#00e5ff", shadowX: 8, shadowY: 8 }, animIn: A("slide-left", 0.6), animLoop: A("float", 2) },
  { id: "title-count", name: "카운트다운", category: "제목", content: "3", style: { ...BOLD, fontSize: 320, strokeWidth: 12 }, animIn: A("pop", 0.3), animOut: A("zoom-out", 0.3), duration: 1, y: 0 },
  // 자막
  { id: "sub-basic", name: "기본 자막", category: "자막", content: "자막을 입력하세요", style: { fontSize: 60, bold: false, strokeWidth: 4 }, y: 0.4 },
  { id: "sub-bar", name: "자막 바", category: "자막", content: "자막 바 스타일", style: { fontSize: 58, bold: false, strokeWidth: 0, background: "rgba(0,0,0,0.6)", bgRadius: 6 }, y: 0.4 },
  { id: "sub-yellow", name: "노란 자막", category: "자막", content: "예능 자막", style: { ...BOLD, fontSize: 64, color: "#ffe14d", strokeWidth: 7 }, y: 0.38, animIn: A("pop", 0.25) },
  { id: "sub-typing", name: "타자기 자막", category: "자막", content: "한 글자씩 나타나요", style: { fontSize: 60, fontFamily: "Consolas", bold: false, strokeWidth: 4 }, animIn: A("typewriter", 1.2), y: 0.4 },
  { id: "sub-pill", name: "알약 자막", category: "자막", content: "둥근 배경 자막", style: { fontSize: 56, color: "#ffffff", strokeWidth: 0, background: "#7c5cff", bgRadius: 60 }, animIn: A("slide-up", 0.35), y: 0.4 },
  // 강조
  { id: "em-wow", name: "와우!", category: "강조", content: "WOW!", style: { ...BOLD, fontFamily: "Impact", color: "#ff3b6b", strokeColor: "#ffffff", strokeWidth: 12, fontSize: 180 }, animIn: A("pop", 0.35), animLoop: A("heartbeat", 0.9), y: -0.2 },
  { id: "em-warning", name: "경고", category: "강조", content: "주의!", style: { ...BOLD, color: "#111111", strokeWidth: 0, background: "#ffd400", bgRadius: 8, fontSize: 100 }, animIn: A("swing", 0.6), animLoop: A("wiggle", 0.8) },
  { id: "em-sale", name: "할인", category: "강조", content: "50% OFF", style: { ...BOLD, color: "#ffffff", strokeWidth: 0, background: "#e8173c", bgRadius: 14, fontSize: 110 }, animIn: A("zoom-in", 0.3), animLoop: A("pulse", 0.8) },
  { id: "em-check", name: "포인트", category: "강조", content: "★ POINT ★", style: { ...BOLD, color: "#ffef5c", strokeColor: "#1a1a1a", strokeWidth: 8, fontSize: 96 }, animIn: A("spin", 0.6), animLoop: A("bounce", 0.6) },
  { id: "em-tip", name: "꿀팁", category: "강조", content: "꿀팁", style: { ...BOLD, color: "#5a3200", strokeWidth: 0, background: "#ffc43d", bgRadius: 40, fontSize: 90 }, animIn: A("drop", 0.6), animLoop: A("swing", 1.2) },
  // 감성
  { id: "mood-script", name: "손글씨 감성", category: "감성", content: "오늘도 수고했어", style: { fontFamily: "Gungsuh", italic: true, bold: false, strokeWidth: 0, shadowColor: "rgba(0,0,0,0.45)", shadowBlur: 10, fontSize: 90 }, animIn: A("fade", 1), animOut: A("fade", 1) },
  { id: "mood-soft", name: "몽글몽글", category: "감성", content: "몽글몽글한 하루", style: { color: "#fff4fb", strokeColor: "#ff9ccf", strokeWidth: 5, fontSize: 88 }, animIn: A("rise", 0.8), animLoop: A("float", 2.4) },
  { id: "mood-film", name: "필름 날짜", category: "감성", content: "2026. 10. 29", style: { fontFamily: "Consolas", color: "#ffad3b", strokeWidth: 0, glow: "#ff7a00", fontSize: 60, bold: false }, animIn: A("blink", 0.6), y: 0.4 },
  { id: "mood-quote", name: "인용구", category: "감성", content: "“ 작은 행복 ”", style: { fontFamily: "Batang", color: "#f5efe4", strokeWidth: 0, letterSpacing: 6, fontSize: 84 }, animIn: A("stretch", 1), animOut: A("fade", 0.8) },
  // 예능
  { id: "ent-laugh", name: "ㅋㅋㅋ", category: "예능", content: "ㅋㅋㅋㅋ", style: { ...BOLD, color: "#ffe14d", strokeColor: "#000000", strokeWidth: 10, fontSize: 130 }, animIn: A("pop", 0.25), animLoop: A("shake", 1) },
  { id: "ent-shock", name: "충격", category: "예능", content: "(충격)", style: { ...BOLD, color: "#ffffff", strokeColor: "#3a2cff", strokeWidth: 10, fontSize: 110 }, animIn: A("zoom-out", 0.25), animLoop: A("shake", 1) },
  { id: "ent-sad", name: "시무룩", category: "예능", content: "시무룩…", style: { color: "#a9c8ff", strokeColor: "#18284a", strokeWidth: 7, fontSize: 96 }, animIn: A("slide-down", 0.6), animLoop: A("float", 2) },
  { id: "ent-love", name: "하트 뿅뿅", category: "예능", content: "♥ 심쿵 ♥", style: { ...BOLD, color: "#ff6fa8", strokeColor: "#ffffff", strokeWidth: 9, fontSize: 110 }, animIn: A("pop", 0.35), animLoop: A("heartbeat", 0.8) },
  { id: "ent-angry", name: "버럭", category: "예능", content: "버럭!!", style: { ...BOLD, color: "#ff4b2b", strokeColor: "#2a0000", strokeWidth: 11, fontSize: 140 }, animIn: A("zoom-out", 0.2), animLoop: A("shake", 0.5) },
];

export const TEXT_TEMPLATE_CATEGORIES = [...new Set(TEXT_TEMPLATES.map((t) => t.category))];
