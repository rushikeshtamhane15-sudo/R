/* iter-138 · face-api.js loader.
 * Loads face-api.js from a CDN once (idempotent) and points it at
 * pre-hosted TensorFlow.js models. All heavy lifting happens in-browser:
 *  - `tinyFaceDetector` picks a face out of a live video frame (fast, 190KB).
 *  - `faceRecognitionNet` computes a 128-dim descriptor per face (5.4MB).
 *  - `faceLandmark68Net` aligns the face before descriptor extraction (350KB).
 *
 * We keep the library out of the main bundle so it only downloads on pages
 * that actually need it (kiosk + profile enrollment).
 */

const FACEAPI_SRC = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/dist/face-api.min.js";
// iter-138.j — models are now served from the same origin (/models) so a
// blocked/slow jsdelivr CDN on the wall-kiosk network never leaves the tile
// stuck at "camera live but no detection". A CDN URL is kept as a fallback
// in case the local static files ever go missing.
const MODEL_LOCAL = "/models";
const MODEL_CDN = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model";

let _libPromise = null;
let _modelsLoaded = false;

/** Lazily inject the face-api.js UMD bundle and resolve when window.faceapi is ready. */
export async function ensureFaceApiLoaded() {
  if (typeof window === "undefined") throw new Error("SSR");
  if (window.faceapi) return window.faceapi;
  if (!_libPromise) {
    _libPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-face-api="1"]`);
      const s = existing || document.createElement("script");
      s.src = FACEAPI_SRC;
      s.async = true;
      s.dataset.faceApi = "1";
      s.crossOrigin = "anonymous";
      s.onload = () => resolve(window.faceapi);
      s.onerror = (e) => reject(new Error(`Failed to load face-api.js: ${e && e.message ? e.message : "network"}`));
      if (!existing) document.head.appendChild(s);
    });
  }
  return _libPromise;
}

/** Load the three required models (idempotent). Total download ≈ 6MB, cached forever.
 * iter-138.j — tries the same-origin /models bundle first (fast, no CDN
 * dependency, works even on tight-firewalled wall-kiosk networks). Falls
 * back to the jsdelivr CDN only if the local files 404.
 */
export async function ensureModelsLoaded() {
  const faceapi = await ensureFaceApiLoaded();
  if (_modelsLoaded) return faceapi;
  const load = async (base) => Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(base),
    faceapi.nets.faceLandmark68Net.loadFromUri(base),
    faceapi.nets.faceRecognitionNet.loadFromUri(base),
  ]);
  try {
    await load(MODEL_LOCAL);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[faceApi] local models failed, falling back to CDN", e && e.message);
    await load(MODEL_CDN);
  }
  _modelsLoaded = true;
  return faceapi;
}

/** Compute a 128-dim descriptor from an <img>, <video>, or <canvas>. Returns null when no face detected. */
export async function computeDescriptor(source) {
  const out = await detectFace(source);
  return out ? out.descriptor : null;
}

/** iter-138.l — detect a face + return both the 128-dim descriptor AND the
 * bounding box (relative x/y/w/h in [0,1] against the source's dimensions).
 * Returns null when no face is detected. Used by the wall-kiosk red/green
 * alignment guide to know where the face is inside the video frame.
 */
export async function detectFace(source) {
  const faceapi = await ensureModelsLoaded();
  const detected = await faceapi
    .detectSingleFace(source, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.55 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detected || !detected.descriptor) return null;
  const b = detected.detection && detected.detection.box;
  const iw = (source && (source.videoWidth || source.naturalWidth || source.width)) || 1;
  const ih = (source && (source.videoHeight || source.naturalHeight || source.height)) || 1;
  const box = b ? {
    x: b.x / iw,
    y: b.y / ih,
    w: b.width / iw,
    h: b.height / ih,
  } : null;
  return {
    descriptor: Array.from(detected.descriptor),
    box,
    score: (detected.detection && detected.detection.score) || 0,
  };
}
