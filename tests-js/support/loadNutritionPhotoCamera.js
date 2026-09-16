// Loads the REAL in-app "Take photo" viewfinder out of templates/nutrition.html:
// stopAfPhotoCamera / openAfPhotoCamera / startAfPhotoPreview /
// renderAfPhotoCameraUnavailable / renderAfPhotoCameraScreen /
// flipAfPhotoCamera / captureAfPhoto, as one contiguous region.
//
// Same extraction-by-source-marker approach as loadNutritionRelogConfirm.js:
// the region is evaluated in a `new Function` factory so the tests exercise
// the shipped source rather than a hand-copied duplicate, and extraction
// throws loudly if a marker stops matching instead of silently testing stale
// code.
//
// What is faked is exactly what a browser owns and jsdom does not: the camera
// (getUserMedia + streams), the <video> element's frame size, and the canvas
// the shutter draws into. The timing of the frame size is the whole point --
// a real stream goes live BEFORE the element knows how big its frames are,
// and everything this harness exists to test happens in that window.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "nutrition.html");

const REGION = {
  name: "the in-app Take-photo viewfinder (open/start/render/flip/capture)",
  start: '  // ---------- In-app "Take photo" (live viewfinder, no OS camera round-trip) ----------',
  end: "  // Shown after a photo is captured/picked but before it's sent to",
};

export function extractSource() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const s = html.indexOf(REGION.start);
  const e = html.indexOf(REGION.end);
  if (s === -1 || e === -1 || e <= s) {
    throw new Error(
      `loadNutritionPhotoCamera: could not find region "${REGION.name}" in templates/nutrition.html -- ` +
        "the extraction markers moved or the code was renamed/reordered. Update start/end markers."
    );
  }
  return html.slice(s, e);
}

/** A video track that records whether the camera was actually released. */
export function fakeTrack() {
  return { kind: "video", stopped: false, stop() { this.stopped = true; } };
}

export function fakeStream(tracks) {
  const list = tracks && tracks.length ? tracks : [fakeTrack()];
  return { tracks: list, getTracks: () => list };
}

// Frame-size behaviour is patched onto HTMLVideoElement.prototype, not onto
// the element after the fact. The element under test is created by the code
// under test -- `afModalBody.innerHTML = ...` -- and play() is called in the
// same synchronous block, so there is no moment in between to reach in and
// instrument it. A MutationObserver is a microtask; it is already too late.
const VIDEO_STATE = new WeakMap();
let videoProtoPatched = null;
let videoDefaults = { width: 0, height: 0, autoLand: false };

function videoState(video) {
  let state = VIDEO_STATE.get(video);
  if (!state) {
    state = { landed: false, playCalls: 0, ...videoDefaults };
    VIDEO_STATE.set(video, state);
  }
  return state;
}

/**
 * Make every <video> created from here on behave like a real one: videoWidth
 * stays 0 until metadata arrives, and arriving is an event, not a property
 * write.
 *
 * @param {object} defaults
 * @param {number} defaults.width    frame width once metadata lands (0 = never lands)
 * @param {number} defaults.height
 * @param {boolean} defaults.autoLand land metadata shortly after play(), as a real element does
 * @returns {function} restores the prototype
 */
function patchVideoPrototype(defaults) {
  if (videoProtoPatched) videoProtoPatched();
  videoDefaults = defaults;
  const proto = HTMLVideoElement.prototype;
  const realPlay = proto.play;
  const realWidth = Object.getOwnPropertyDescriptor(proto, "videoWidth");
  const realHeight = Object.getOwnPropertyDescriptor(proto, "videoHeight");

  const land = (video) => {
    const state = videoState(video);
    if (state.landed || !state.width) return;
    state.landed = true;
    video.dispatchEvent(new (video.ownerDocument.defaultView.Event)("loadedmetadata"));
  };

  Object.defineProperty(proto, "videoWidth", {
    configurable: true,
    get() { const s = videoState(this); return s.landed ? s.width : 0; },
  });
  Object.defineProperty(proto, "videoHeight", {
    configurable: true,
    get() { const s = videoState(this); return s.landed ? s.height : 0; },
  });
  proto.play = function () {
    const state = videoState(this);
    state.playCalls += 1;
    if (state.autoLand) {
      // A real element fires loadedmetadata a beat after playback starts --
      // a timer, not a microtask, so the code under test has attached its
      // listener by the time it arrives.
      setTimeout(() => land(this), 0);
    }
    // jsdom's own play() rejects with "Not implemented"; a real muted
    // playsinline element may also reject when autoplay is refused. Either
    // way the code under test must survive it, so keep the rejection.
    return Promise.reject(new Error("Not implemented: HTMLMediaElement.prototype.play"));
  };
  videoProtoPatched = () => {
    proto.play = realPlay;
    if (realWidth) Object.defineProperty(proto, "videoWidth", realWidth);
    else delete proto.videoWidth;
    if (realHeight) Object.defineProperty(proto, "videoHeight", realHeight);
    else delete proto.videoHeight;
    videoProtoPatched = null;
  };
  return videoProtoPatched;
}

/**
 * Evaluate the viewfinder region against a fake camera and a fake canvas.
 *
 * @param {object} [options]
 * @param {number} [options.frameWidth] frame width once metadata lands; 0 means
 *        the stream goes live but never produces a frame (the dead-feed case)
 * @param {boolean} [options.autoLandMetadata] land metadata as soon as the
 *        element is asked to play (the common case); false leaves it to the test
 * @param {boolean} [options.noMediaDevices] hide navigator.mediaDevices, so the
 *        RepCheckNative fallback route is taken
 * @param {Error} [options.getUserMediaError] make getUserMedia reject
 */
export function loadPhotoCamera(options = {}) {
  const {
    frameWidth = 1280,
    autoLandMetadata = true,
    noMediaDevices = false,
    getUserMediaError = null,
  } = options;

  document.body.innerHTML = '<div id="af-modal-body"></div>';
  const afModalBody = document.getElementById("af-modal-body");

  const calls = { getUserMedia: [], nativeOpenCamera: 0, renderAfChoice: 0, useAfImage: [] };
  const streams = [];

  const mediaDevices = {
    getUserMedia: (constraints) => {
      calls.getUserMedia.push(constraints);
      if (getUserMediaError) return Promise.reject(getUserMediaError);
      const stream = fakeStream();
      streams.push(stream);
      return Promise.resolve(stream);
    },
  };
  if (noMediaDevices) delete navigator.mediaDevices;
  else Object.defineProperty(navigator, "mediaDevices", { value: mediaDevices, configurable: true });

  // The shutter draws into a canvas jsdom cannot rasterise. Only two things
  // about it matter here: that drawImage got the live element, and that a
  // File came back out.
  const canvasUse = { drawn: [] };
  HTMLCanvasElement.prototype.getContext = function () {
    return { drawImage: (source) => canvasUse.drawn.push(source) };
  };
  HTMLCanvasElement.prototype.toBlob = function (callback, type) {
    callback(new Blob(["fake-jpeg"], { type: type || "image/jpeg" }));
  };

  const restoreVideoProto = patchVideoPrototype({
    width: frameWidth,
    height: frameWidth ? Math.round((frameWidth * 9) / 16) : 0,
    autoLand: autoLandMetadata && !!frameWidth,
  });

  const RepCheckNative = {
    openCamera: () => { calls.nativeOpenCamera += 1; },
  };

  const factory = new Function(
    "afModalBody",
    "RepCheckNative",
    "afCameraInput",
    "useAfImage",
    "renderAfChoice",
    "afPretextRelayout",
    `
      "use strict";
      let afPhotoStream = null;
      let afPhotoFacing = "environment";
      ${extractSource()}
      return {
        openAfPhotoCamera, stopAfPhotoCamera, captureAfPhoto, flipAfPhotoCamera,
        currentStream: () => afPhotoStream,
        facing: () => afPhotoFacing,
      };
    `
  );

  const api = factory(
    afModalBody,
    RepCheckNative,
    null,
    (file) => calls.useAfImage.push(file),
    () => { calls.renderAfChoice += 1; afModalBody.innerHTML = '<div id="af-choice"></div>'; },
    () => {}
  );

  return {
    ...api,
    afModalBody,
    calls,
    streams,
    canvasUse,
    video: () => afModalBody.querySelector("#af-photo-video"),
    playCallsFor: (video) => videoState(video).playCalls,
    /** True when the screen on show is the live viewfinder. */
    onCameraScreen: () => !!afModalBody.querySelector("#af-photo-shutter"),
    /** True when the screen on show is the "Camera unavailable" fallback. */
    onUnavailableScreen: () => !!afModalBody.querySelector("#af-photo-fallback-btn"),
    restore: restoreVideoProto,
  };
}
