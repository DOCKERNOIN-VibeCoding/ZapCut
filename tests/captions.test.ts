import { describe, expect, it } from "vitest";
import { captionClips, parseWhisperJson, srtTime, toSrt } from "../src/core/captions";
import { clipFromMedia } from "../src/core/timeline";
import type { MediaItem } from "../src/core/types";

const media: MediaItem = { id: "m", kind: "video", path: "C:\\v.mp4", name: "v.mp4", duration: 60, width: 1920, height: 1080, fps: 30, hasAudio: true };

describe("whisper 출력 해석", () => {
  it("줄마다 밀리초 → 초, 빈 줄·표시만 있는 줄·깨진 줄은 버린다", () => {
    const text = `{"start":0,"end":1800,"text":"안녕하세요."}\n\n{"start":1800,"end":5920,"text":" 오늘은 시험합니다. "}\nnot json\n{"start":9000,"end":9500,"text":"[끝]"}\n{"start":10,"end":5,"text":"거꾸로"}\n`;
    expect(parseWhisperJson(text)).toEqual([
      { start: 0, end: 1.8, text: "안녕하세요." },
      { start: 1.8, end: 5.92, text: "오늘은 시험합니다." },
    ]);
  });
});

describe("자막 클립 만들기", () => {
  it("배속과 클립 위치를 반영하고, 겹치면 다음 문장에서 끝낸다", () => {
    const src = { ...clipFromMedia(media, 10), in: 5, duration: 6, speed: 2 }; // 원본 5~17초 → 타임라인 10~16초
    const clips = captionClips(src, [
      { start: 0, end: 4, text: "하나" },
      { start: 3, end: 6, text: "둘" }, // 앞 문장과 겹침
      { start: 11, end: 14, text: "셋" }, // 타임라인 15.5~ : 클립 끝(16)에서 잘림
      { start: 13, end: 15, text: "넷" }, // 16.5초 → 클립 밖
    ]);
    expect(clips.map((c) => c.text!.content)).toEqual(["하나", "둘", "셋"]);
    expect(clips[0].start).toBe(10);
    expect(clips[0].duration).toBeCloseTo(1.5); // 둘이 시작하는 11.5초에서 끝
    expect(clips[1].start).toBeCloseTo(11.5);
    expect(clips[1].duration).toBeCloseTo(1.5);
    expect(clips[2].start).toBeCloseTo(15.5);
    expect(clips[2].duration).toBeCloseTo(0.5);
    expect(clips.every((c) => c.caption && c.kind === "text" && c.transform.y === 0.4)).toBe(true);
  });
});

describe("SRT", () => {
  it("시각 형식과 번호", () => {
    expect(srtTime(3661.0045)).toBe("01:01:01,005");
    const src = clipFromMedia(media, 0);
    const srt = toSrt(captionClips(src, [{ start: 2, end: 3.5, text: "둘째" }, { start: 0, end: 1.25, text: "첫째" }]));
    expect(srt).toBe("1\n00:00:00,000 --> 00:00:01,250\n첫째\n\n2\n00:00:02,000 --> 00:00:03,500\n둘째\n");
  });
});
