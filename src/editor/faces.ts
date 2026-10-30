// 얼굴 찾기: 재생헤드 프레임에서 얼굴을 찾아 미리보기에 보여 주고, 고른 얼굴을 모자이크로 가린 뒤 따라가게 한다.
// 모델은 YuNet(OpenCV Zoo, MIT), 실행은 onnxruntime-web(WASM). 파일은 메인 프로세스가 읽어 넘긴다 (file:// fetch 불가).
import type { InferenceSession, Tensor } from "onnxruntime-web";
import { decodeYuNet, toTensor, YUNET_SIZE } from "../core/faces";
import { placement, toCanvas } from "../core/placement";
import { clipEnd, effectClip, findClip, placeClip } from "../core/timeline";
import { DEFAULT_MASK } from "../core/types";
import { frameAt } from "../preview/frame";
import { useEditor } from "./store";
import { trackRegion } from "./tracking";

let detector: Promise<{ session: InferenceSession; Tensor: typeof Tensor }> | undefined;
function loadDetector() {
  detector ??= (async () => {
    const ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.numThreads = 1; // 교차 출처 격리가 없어 스레드를 쓰지 않는다
    ort.env.wasm.wasmBinary = await window.zapcut.mlRead("ort.wasm");
    const session = await ort.InferenceSession.create(await window.zapcut.mlRead("yunet.onnx"), { executionProviders: ["wasm"] });
    return { session, Tensor: ort.Tensor };
  })();
  detector.catch(() => (detector = undefined));
  return detector;
}

/** 재생헤드에 보이는 가장 위 영상·사진에서 얼굴을 찾아 미리보기에 표시 */
export async function findFaces() {
  const s = useEditor.getState();
  const p = s.project;
  const t = s.playhead;
  const layers = frameAt(p, t).layers.filter((l) => (l.clip.kind === "video" || l.clip.kind === "image") && l.media && !l.media.sticker);
  const layer = layers[layers.length - 1];
  if (!layer) return s.notify("재생헤드 위치에 영상이나 사진이 없습니다", "error");
  const media = layer.media!;
  s.setBusy("얼굴 찾기");
  try {
    const { session, Tensor } = await loadDetector();
    const bgr = await window.zapcut.grabFrame(media.path, layer.clip.kind === "video" ? layer.clip.in + layer.T * layer.clip.speed : 0);
    const out = await session.run({ [session.inputNames[0]]: new Tensor("float32", toTensor(bgr), [1, 3, YUNET_SIZE, YUNET_SIZE]) });
    // 프레임은 긴 변을 640에 맞춰 왼쪽 위에 놓았다
    const k = Math.min(YUNET_SIZE / media.width, YUNET_SIZE / media.height);
    const pl = placement(layer.clip, media, layer.T, p.width, p.height);
    const faces = decodeYuNet(out as never).map((f) => {
      const a = toCanvas(pl, f.x / k, f.y / k);
      const z = toCanvas(pl, (f.x + f.w) / k, (f.y + f.h) / k);
      return { x: Math.min(a.X, z.X) / p.width, y: Math.min(a.Y, z.Y) / p.height, w: Math.abs(z.X - a.X) / p.width, h: Math.abs(z.Y - a.Y) / p.height };
    });
    if (!faces.length) {
      s.setFaceHits(undefined);
      return s.notify("이 프레임에서 얼굴을 찾지 못했습니다. 얼굴이 잘 보이는 시점으로 옮겨 다시 시도하세요");
    }
    s.setFaceHits({ t, clipId: layer.clip.id, faces });
    s.notify(`얼굴 ${faces.length}개를 찾았습니다. 가릴 얼굴을 누르세요`);
  } catch (e) {
    s.notify(`얼굴 찾기 실패: ${(e as Error).message}`, "error");
  } finally {
    s.setBusy(undefined);
  }
}

/** 찾은 얼굴(들)을 모자이크로 가리고, 영상이면 끝까지 따라가게 한다 */
export async function coverFaces(indices: number[]) {
  const s = useEditor.getState();
  const hits = s.faceHits;
  if (!hits) return;
  s.setFaceHits(undefined);
  const found = findClip(s.project, hits.clipId);
  if (!found) return;
  const { clip } = found;
  const p = s.project;
  const M = Math.min(p.width, p.height);
  const ids: string[] = [];
  for (const i of indices) {
    const f = hits.faces[i];
    // 머리카락·턱까지 덮도록 조금 크게, 타원으로
    const c = effectClip(hits.t, "effect", { id: "mosaic", params: { size: 0.45 } }, Math.max(0.5, clipEnd(clip) - hits.t));
    c.mask = { ...DEFAULT_MASK, type: "circle", x: f.x + f.w / 2 - 0.5, y: f.y + f.h / 2 - 0.5, w: (f.w * p.width * 1.3) / M, h: (f.h * p.height * 1.4) / M, feather: 0.08 };
    useEditor.getState().commit((pr) => placeClip(pr, c));
    ids.push(c.id);
  }
  useEditor.getState().select(ids.slice(-1));
  if (clip.kind !== "video") return s.notify(`얼굴 ${ids.length}개를 가렸습니다`);
  for (const id of ids) await trackRegion(id);
}
