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
const MODEL_BASE = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model";

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

/** Load the three required models (idempotent). Total download ≈ 6MB, cached forever. */
export async function ensureModelsLoaded() {
  const faceapi = await ensureFaceApiLoaded();
  if (_modelsLoaded) return faceapi;
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_BASE),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_BASE),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_BASE),
  ]);
  _modelsLoaded = true;
  return faceapi;
}

/** Compute a 128-dim descriptor from an <img>, <video>, or <canvas>. Returns null when no face detected. */
export async function computeDescriptor(source) {
  const faceapi = await ensureModelsLoaded();
  const detected = await faceapi
    .detectSingleFace(source, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.55 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detected || !detected.descriptor) return null;
  // detected.descriptor is a Float32Array — convert to plain Array so it
  // serialises correctly through fetch(JSON.stringify).
  return Array.from(detected.descriptor);
}
