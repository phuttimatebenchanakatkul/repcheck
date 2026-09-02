// Loads the REAL static/video_recorder.js -- the analyze page's in-app
// recorder -- against fake camera/MediaRecorder globals, rather than a
// hand-copied duplicate that could drift from what ships.
//
// Same shape as loadNative.js: the file is a standalone IIFE taking
// (window, document), so each load gets its own window.RepCheckRecorder and
// its own fake camera. That isolation is the point here -- the unit under
// test is "which container did it pick, and did it let go of the camera",
// and a shared global would leak one test's fake stream into the next.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, "..", "..", "static", "video_recorder.js");

export function readSource() {
  return readFileSync(SCRIPT_PATH, "utf-8");
}

/**
 * A fake MediaStreamTrack that records whether it was stopped. "Did every
 * track stop" is the difference between the camera light going out when the
 * user closes the sheet and it staying on over a page they think is idle.
 */
export function fakeTrack(kind = "video", capabilities = null) {
  return {
    kind,
    stopped: false,
    constraints: [],
    stop() { this.stopped = true; },
    getCapabilities: capabilities ? () => capabilities : undefined,
    applyConstraints(value) { this.constraints.push(value); return Promise.resolve(); },
  };
}

export function fakeStream(tracks) {
  const list = tracks && tracks.length ? tracks : [fakeTrack()];
  return {
    tracks: list,
    getTracks: () => list,
    getVideoTracks: () => list.filter((t) => t.kind === "video"),
  };
}

/**
 * Evaluate video_recorder.js against a fake window.
 *
 * @param {object} options
 * @param {string[]} options.supportedTypes  what MediaRecorder.isTypeSupported
 *   says yes to. Defaults to webm-only (every browser but iOS Safari); pass
 *   ["video/mp4"] for the iOS/shell case, or [] for a MediaRecorder that
 *   won't answer at all.
 * @param {Function} options.getUserMedia  stub for
 *   navigator.mediaDevices.getUserMedia. Receives the constraints, so a test
 *   can assert on facingMode or reject to stand in for a denied permission.
 * @param {boolean} options.hasMediaRecorder  false drops MediaRecorder from
 *   the fake window -- the "this browser can't record at all" case, where the
 *   analyze page must keep its upload dropzone and hide the record button.
 * @param {Function|null} options.performanceNow  stands in for
 *   performance.now(). Omit for a window with no performance object at all,
 *   which is the wall-clock fallback path.
 */
export function loadVideoRecorder({
  supportedTypes = ["video/webm;codecs=vp9", "video/webm"],
  getUserMedia,
  hasMediaRecorder = true,
  performanceNow,
} = {}) {
  const requests = [];
  const recorders = [];

  class FakeMediaRecorder {
    constructor(stream, options) {
      this.stream = stream;
      this.mimeType = (options && options.mimeType) || "";
      /** The full options bag, so a test can see what the page asked for beyond the container. */
      this.options = options || {};
      this.state = "inactive";
      this.ondataavailable = null;
      this.onstop = null;
      recorders.push(this);
    }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      if (this.onstop) this.onstop();
    }
    /** Test hook: feed the recorder a chunk the way a real one would. */
    emit(data) {
      if (this.ondataavailable) this.ondataavailable({ data });
    }
    static isTypeSupported(type) { return supportedTypes.includes(type); }
  }

  const windowStub = {
    MediaRecorder: hasMediaRecorder ? FakeMediaRecorder : undefined,
    performance: performanceNow ? { now: performanceNow } : undefined,
    // The real Blob/File are fine -- the point of the conversion is that the
    // caller receives genuine ones, named the way the server will judge them.
    Blob: globalThis.Blob,
    File: globalThis.File,
    navigator: {
      mediaDevices: {
        getUserMedia(constraints) {
          requests.push(constraints);
          if (getUserMedia) return getUserMedia(constraints);
          return Promise.resolve(fakeStream());
        },
      },
    },
  };

  // eslint-disable-next-line no-new-func
  new Function("window", "document", readSource())(windowStub, {});

  return {
    recorder: windowStub.RepCheckRecorder,
    windowStub,
    /** Constraints passed to every getUserMedia call, in order. */
    requests,
    /** Every FakeMediaRecorder constructed, in order. */
    recorders,
  };
}
