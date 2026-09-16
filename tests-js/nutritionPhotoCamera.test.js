// The in-app "Take photo" viewfinder on /nutrition -- the first step of
// "Analyze a food photo".
//
// The bug these cover: renderAfPhotoCameraScreen() attached the stream to the
// <video> and stopped there. It never called play(), and it never waited for
// the frame size. A MediaStream goes live BEFORE the element reports a
// videoWidth -- that number only arrives with loadedmetadata -- and
// captureAfPhoto() opens with `if (!video.videoWidth) return`. So every tap on
// the shutter inside that window did nothing at all: no photo, no error, no
// sign the button was connected to anything. A stream that never produced a
// frame left the same dead screen permanently.
//
// startLiveBarcodeScan(), three hundred lines further down the same file,
// already had all of this: play(), a loadedmetadata wait with a ceiling, and a
// real failure screen when no frame lands. These tests pin the photo path to
// the same contract.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadPhotoCamera, extractSource } from "./support/loadNutritionPhotoCamera.js";

const realCreateElement = document.createElement.bind(document);
const realGetContext = HTMLCanvasElement.prototype.getContext;
const realToBlob = HTMLCanvasElement.prototype.toBlob;

describe("the in-app food-photo viewfinder", () => {
  let harness;

  afterEach(() => {
    if (harness) harness.restore();
    harness = null;
    document.createElement = realCreateElement;
    HTMLCanvasElement.prototype.getContext = realGetContext;
    HTMLCanvasElement.prototype.toBlob = realToBlob;
    vi.useRealTimers();
  });

  describe("starting the camera", () => {
    it("plays the element rather than trusting the autoplay attribute", async () => {
      harness = loadPhotoCamera();
      await harness.openAfPhotoCamera();

      expect(harness.onCameraScreen()).toBe(true);
      expect(harness.playCallsFor(harness.video())).toBe(1);
    });

    it("waits for the frame size, so the shutter works the moment it is on screen", async () => {
      // The whole bug: openAfPhotoCamera() used to resolve with the viewfinder
      // up and videoWidth still 0, and a tap in that window was swallowed.
      harness = loadPhotoCamera();
      await harness.openAfPhotoCamera();

      expect(harness.video().videoWidth).toBeGreaterThan(0);

      harness.captureAfPhoto();
      expect(harness.calls.useAfImage).toHaveLength(1);
      expect(harness.calls.useAfImage[0].name).toBe("photo.jpg");
      expect(harness.onUnavailableScreen()).toBe(false);
    });

    it("captures at the stream's own resolution, not the element's CSS box", async () => {
      harness = loadPhotoCamera({ frameWidth: 1280 });
      await harness.openAfPhotoCamera();
      harness.captureAfPhoto();

      expect(harness.canvasUse.drawn).toHaveLength(1);
      expect(harness.canvasUse.drawn[0]).toBe(harness.video());
    });

    it("survives a play() that rejects, because a refused autoplay is not a failure", async () => {
      // The harness's play() always rejects (jsdom's does too). Reaching a
      // working shutter anyway is the assertion.
      harness = loadPhotoCamera();
      await expect(harness.openAfPhotoCamera()).resolves.toBeUndefined();
      expect(harness.onCameraScreen()).toBe(true);
    });
  });

  describe("a stream that never produces a frame", () => {
    it("gives up at the ceiling and says the camera is unavailable", async () => {
      vi.useFakeTimers();
      harness = loadPhotoCamera({ frameWidth: 0 });

      const opening = harness.openAfPhotoCamera();
      await vi.advanceTimersByTimeAsync(4000);
      await opening;

      expect(harness.onUnavailableScreen()).toBe(true);
      expect(harness.onCameraScreen()).toBe(false);
    });

    it("releases the camera on the way out, so the light goes off", async () => {
      vi.useFakeTimers();
      harness = loadPhotoCamera({ frameWidth: 0 });

      const opening = harness.openAfPhotoCamera();
      await vi.advanceTimersByTimeAsync(4000);
      await opening;

      expect(harness.streams).toHaveLength(1);
      expect(harness.streams[0].tracks.every((t) => t.stopped)).toBe(true);
      expect(harness.currentStream()).toBe(null);
    });
  });

  describe("the shutter", () => {
    it("reports a feed that died instead of silently doing nothing", async () => {
      harness = loadPhotoCamera();
      await harness.openAfPhotoCamera();
      expect(harness.onCameraScreen()).toBe(true);

      // The lens was taken by something else after the preview started.
      const video = harness.video();
      Object.defineProperty(video, "videoWidth", { get: () => 0, configurable: true });

      harness.captureAfPhoto();

      expect(harness.calls.useAfImage).toHaveLength(0);
      expect(harness.onUnavailableScreen()).toBe(true);
      expect(harness.streams[0].tracks.every((t) => t.stopped)).toBe(true);
    });
  });

  describe("flipping to the other lens", () => {
    it("starts the new stream the same way, not just by swapping srcObject", async () => {
      harness = loadPhotoCamera();
      await harness.openAfPhotoCamera();
      const playsAfterOpen = harness.playCallsFor(harness.video());

      await harness.flipAfPhotoCamera();

      expect(harness.facing()).toBe("user");
      expect(harness.playCallsFor(harness.video())).toBe(playsAfterOpen + 1);
      expect(harness.video().videoWidth).toBeGreaterThan(0);
      expect(harness.onCameraScreen()).toBe(true);
    });

    it("releases the first lens before asking for the second", async () => {
      // iOS refuses a second camera stream while the first is still live.
      harness = loadPhotoCamera();
      await harness.openAfPhotoCamera();
      await harness.flipAfPhotoCamera();

      expect(harness.streams).toHaveLength(2);
      expect(harness.streams[0].tracks.every((t) => t.stopped)).toBe(true);
      expect(harness.streams[1].tracks.every((t) => t.stopped)).toBe(false);
    });
  });

  describe("no camera at all", () => {
    it("falls back to the native/file-input route when getUserMedia is missing", async () => {
      harness = loadPhotoCamera({ noMediaDevices: true });
      await harness.openAfPhotoCamera();

      expect(harness.calls.nativeOpenCamera).toBe(1);
      expect(harness.onCameraScreen()).toBe(false);
    });

    it("shows the retry screen when the camera is refused, rather than a dead viewfinder", async () => {
      harness = loadPhotoCamera({ getUserMediaError: new Error("NotAllowedError") });
      await harness.openAfPhotoCamera();

      expect(harness.onUnavailableScreen()).toBe(true);
      // Not the native route: the click's user activation is gone by now, so
      // opening a picker here would be a silent no-op.
      expect(harness.calls.nativeOpenCamera).toBe(0);
    });
  });

  describe("the source this harness reads", () => {
    it("still contains the four calls the viewfinder cannot work without", () => {
      // Cheap guard on the extraction markers themselves: if the region ever
      // stops covering the real functions, the behavioural tests above would
      // pass against whatever happened to be extracted instead.
      const source = extractSource();
      for (const needed of [
        "async function openAfPhotoCamera",
        "async function startAfPhotoPreview",
        "async function renderAfPhotoCameraScreen",
        "function captureAfPhoto",
      ]) {
        expect(source).toContain(needed);
      }
    });
  });
});
