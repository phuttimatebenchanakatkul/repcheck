// Pose detection off the main thread (analyze page, "Analyzing" step).
//
// While a clip is being graded, templates/index.html plays it back with a
// live skeleton drawn over it. The skeleton comes from MediaPipe's pose
// landmarker, and one detectForVideo() call takes 25-80ms on real phones --
// longer than a whole 60Hz frame. Run on the main thread (as it used to be,
// even throttled) every call stalls the page for that long, and the <video>
// underneath drops frames each time: that is what "the video lags while it
// analyzes" was.
//
// So the model runs here instead. The page grabs a (downscaled) ImageBitmap
// of the current frame, transfers it over, and gets normalized landmarks
// back; the main thread never does more than a createImageBitmap() and a
// few canvas strokes per detection, and the video plays untouched.
//
// Protocol (all messages are plain objects with a `type`):
//   page  -> worker  { type: "init", visionUrl, wasmUrl, modelUrl }
//   worker -> page   { type: "ready" } | { type: "error", message }
//   page  -> worker  { type: "frame", bitmap: ImageBitmap, ts }   (bitmap transferred)
//   worker -> page   { type: "result", ts, landmarks }
//
// The page sends one frame at a time and waits for its result before the
// next, so timestamps reach detectForVideo() strictly increasing -- it
// throws on anything else, and once it has thrown the landmarker instance is
// wedged for good (see the main-thread fallback in index.html for the same
// finding). Every error here is fatal to this worker: the page drops it and
// hands the analysis to its main-thread fallback.
//
// A CLASSIC worker (no { type: "module" }), pulling MediaPipe in through a
// dynamic import(): its WASM loader calls importScripts(), which module
// workers refuse outright, so a module worker died at init every time
// (checked in Chromium: "Module scripts don't support importScripts()").
// index.html falls back to the main-thread landmarker when workers or
// createImageBitmap are unavailable, so nothing here needs to cope with an
// old browser -- it just needs to fail loudly (post an error) rather than
// hang.

"use strict";

let landmarker = null;

// Mirror of createLandmarker() in templates/index.html (the main-thread
// fallback) -- neither file can see the other, so a change to the model
// options (numPoses, delegate order, confidence thresholds) goes in both.
async function createLandmarker(PoseLandmarker, vision, modelUrl, delegate) {
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelUrl, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

async function init(msg) {
  const { PoseLandmarker, FilesetResolver } = await import(msg.visionUrl);
  const vision = await FilesetResolver.forVisionTasks(msg.wasmUrl);
  try {
    // GPU needs WebGL on an OffscreenCanvas, which not every worker has
    // (iOS before 17); CPU is slower but works anywhere a worker runs, and
    // off the main thread "slower" costs the video nothing.
    landmarker = await createLandmarker(PoseLandmarker, vision, msg.modelUrl, "GPU");
  } catch (err) {
    landmarker = await createLandmarker(PoseLandmarker, vision, msg.modelUrl, "CPU");
  }
}

function detect(msg) {
  const bitmap = msg.bitmap;
  try {
    if (!landmarker) throw new Error("pose worker received a frame before init");
    const result = landmarker.detectForVideo(bitmap, msg.ts);
    self.postMessage({ type: "result", ts: msg.ts, landmarks: result.landmarks || [] });
  } finally {
    // Transferred bitmaps are owned here now; closing frees the GPU/CPU
    // backing store immediately instead of waiting on GC.
    if (bitmap && typeof bitmap.close === "function") bitmap.close();
  }
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    if (msg.type === "init") {
      await init(msg);
      self.postMessage({ type: "ready" });
    } else if (msg.type === "frame") {
      detect(msg);
    }
  } catch (err) {
    self.postMessage({ type: "error", message: String(err && err.message || err) });
  }
};
