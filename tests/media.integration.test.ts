// 가져오기 단계(정보·썸네일·필름스트립)를 실제 ffmpeg로 검증한다 (ffmpeg가 PATH에 없으면 건너뜀)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(os.tmpdir(), "zapcut-media-"));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => dir } }));
const { filmstrip, probe, thumbnails } = await import("../electron/ffmpeg");

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const size = (file: string) => execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" }).trim();

/** JPEG의 SOI 바로 뒤에 EXIF(Orientation=6, 90° 돌려서 보기) 세그먼트를 넣는다. 폰 세로 사진과 같은 모양 */
function withOrientation6(jpeg: Buffer) {
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const body = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff]), body]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

describe.skipIf(!hasFfmpeg)("미디어 가져오기 (실제 ffmpeg)", () => {
  const landscape = path.join(dir, "land.jpg");
  const phone = path.join(dir, "phone.jpg");
  const sparse = path.join(dir, "sparse.mp4");
  beforeAll(() => {
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180", "-frames:v", "1", landscape]);
    writeFileSync(phone, withOrientation6(readFileSync(landscape)));
    // 키프레임이 10초에 하나뿐인 20초 영상
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=duration=20:size=320x180:rate=30", "-c:v", "libx264", "-preset", "ultrafast", "-g", "300", "-keyint_min", "300", "-sc_threshold", "0", "-pix_fmt", "yuv420p", sparse]);
  });

  it("EXIF로 돌려 보는 사진은 돌린 뒤의 가로·세로로 기록한다", async () => {
    expect(await probe(phone)).toMatchObject({ kind: "image", width: 180, height: 320 });
    expect(await probe(landscape)).toMatchObject({ kind: "image", width: 320, height: 180 });
  });

  it("사진 썸네일 파일이 실제로 만들어지고, 돌려 보는 방향을 따른다", async () => {
    const { thumbnail } = await thumbnails(await probe(phone));
    expect(existsSync(thumbnail!)).toBe(true);
    expect(size(thumbnail!)).toBe("240,426");
  });

  it("키프레임이 드문 영상도 필름스트립 칸이 끝까지 채워진다", async () => {
    const r = await filmstrip(await probe(sparse));
    expect(r.filmstripFrames).toBe(10);
    // 마지막 칸이 검지 않은지: 오른쪽 끝 한 칸을 잘라 평균 밝기를 본다
    const tile = execFileSync("ffmpeg", ["-v", "error", "-i", r.filmstrip!, "-vf", "crop=iw/10:ih:iw*9/10:0,scale=1:1,format=gray", "-f", "rawvideo", "-"]);
    expect(tile[0]).toBeGreaterThan(30);
  });
});
