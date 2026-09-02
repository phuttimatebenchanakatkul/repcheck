// static/video_recorder.js -- the analyze page's in-app recorder.
//
// Three things here break quietly rather than loudly, which is why they get
// the most coverage:
//
//   1. The container. iOS Safari (and therefore the iOS shell) records mp4
//      and cannot play webm back, so picking the wrong one leaves the user a
//      black preview and hands app.py a mislabelled file that dies at the
//      ffmpeg step -- with no error anywhere near the real cause.
//   2. The filename. app.py decides what it accepts from the extension, so a
//      webm named .mp4 is a rejected upload of a perfectly good recording.
//   3. Releasing the camera. A missed track.stop() leaves the camera light on
//      over a page the user thinks is idle.

import { describe, it, expect } from "vitest";
import { loadVideoRecorder, fakeStream, fakeTrack } from "./support/loadVideoRecorder.js";

const IOS_TYPES = ["video/mp4"];
const WEBM_TYPES = ["video/webm;codecs=vp9", "video/webm"];

describe("container choice", () => {
  it("prefers mp4 where the browser records it (iOS Safari, and the iOS shell)", () => {
    const { recorder } = loadVideoRecorder({ supportedTypes: IOS_TYPES });

    expect(recorder.pickMime()).toBe("video/mp4");
  });

  it("falls back to the best webm everywhere else", () => {
    const { recorder } = loadVideoRecorder({ supportedTypes: WEBM_TYPES });

    expect(recorder.pickMime()).toBe("video/webm;codecs=vp9");
  });

  it("returns an empty string when nothing is supported, rather than guessing", () => {
    const { recorder } = loadVideoRecorder({ supportedTypes: [] });

    // "" means "let MediaRecorder choose" -- a valid outcome, not a failure.
    expect(recorder.pickMime()).toBe("");
  });

  it("names the file after the bytes, since the server judges the extension", () => {
    const { recorder } = loadVideoRecorder();

    expect(recorder.filenameFor("video/mp4")).toBe("recording.mp4");
    expect(recorder.filenameFor("video/webm;codecs=vp9")).toBe("recording.webm");
    expect(recorder.extensionForMime("")).toBe("webm");
  });
});

describe("support detection", () => {
  it("is unsupported without MediaRecorder, so the page can hide the button", () => {
    const { recorder } = loadVideoRecorder({ hasMediaRecorder: false });

    expect(recorder.isSupported()).toBe(false);
  });

  it("is supported when both MediaRecorder and getUserMedia exist", () => {
    const { recorder } = loadVideoRecorder();

    expect(recorder.isSupported()).toBe(true);
  });
});

describe("opening the camera", () => {
  it("asks for the rear camera as a hint, never as a demand", async () => {
    const { recorder, requests } = loadVideoRecorder();

    await recorder.createSession().open("environment");

    // `exact` would fail outright on a laptop with one camera and no
    // rear/front distinction -- the only camera it has must still be used.
    expect(requests[0].video.facingMode).toEqual({ ideal: "environment" });
    // The full constraint set (resolution, frame rate) is pinned further
    // down, under "keeping the preview smooth while recording".
    expect(requests[0].video).not.toHaveProperty("facingMode.exact");
  });

  it("never asks for a microphone", async () => {
    const { recorder, requests } = loadVideoRecorder();

    await recorder.createSession().open();

    // Audio would add an iOS permission prompt for data the trim step drops.
    expect(requests[0].audio).toBe(false);
  });

  it("pulls a multi-lens phone back to 1x framing where zoom is exposed", async () => {
    const track = fakeTrack("video", { zoom: { min: 0.5, max: 8 } });
    const { recorder } = loadVideoRecorder({
      getUserMedia: () => Promise.resolve(fakeStream([track])),
    });

    await recorder.createSession().open();

    expect(track.constraints).toEqual([{ advanced: [{ zoom: 1 }] }]);
  });

  it("leaves a camera with no zoom control alone instead of failing", async () => {
    const track = fakeTrack("video", null);
    const { recorder } = loadVideoRecorder({
      getUserMedia: () => Promise.resolve(fakeStream([track])),
    });

    await expect(recorder.createSession().open()).resolves.toBeTruthy();
    expect(track.constraints).toEqual([]);
  });

  it("propagates a denied permission so the page can offer upload instead", async () => {
    const { recorder } = loadVideoRecorder({
      getUserMedia: () => Promise.reject(new Error("NotAllowedError")),
    });

    await expect(recorder.createSession().open()).rejects.toThrow("NotAllowedError");
  });
});

describe("recording", () => {
  async function recordingSession(options) {
    const track = fakeTrack();
    const loaded = loadVideoRecorder({
      getUserMedia: () => Promise.resolve(fakeStream([track])),
      ...options,
    });
    const session = loaded.recorder.createSession();
    await session.open();
    return { ...loaded, session, track };
  }

  it("resolves with a File named for the container the recorder actually used", async () => {
    const { session, recorders } = await recordingSession({ supportedTypes: WEBM_TYPES });

    const capture = session.start();
    recorders[0].emit(new Blob([new Uint8Array([1, 2, 3])]));
    session.stop();
    const file = await capture;

    expect(file.name).toBe("recording.webm");
    expect(file.type).toBe("video/webm;codecs=vp9");
    expect(file.size).toBe(3);
  });

  it("names an iOS recording .mp4, which is what the analyze route accepts", async () => {
    const { session, recorders } = await recordingSession({ supportedTypes: IOS_TYPES });

    const capture = session.start();
    recorders[0].emit(new Blob([new Uint8Array([9])]));
    session.stop();

    expect((await capture).name).toBe("recording.mp4");
  });

  it("releases the camera when the recording is kept", async () => {
    const { session, track } = await recordingSession();

    const capture = session.start();
    session.stop();
    await capture;

    expect(track.stopped).toBe(true);
  });

  it("resolves with null on cancel, so a closed sheet submits nothing", async () => {
    const { session, recorders, track } = await recordingSession();

    const capture = session.start();
    recorders[0].emit(new Blob([new Uint8Array([1, 2, 3])]));
    session.cancel();

    expect(await capture).toBeNull();
    expect(track.stopped).toBe(true);
  });

  it("cancelling before recording starts still releases the camera", async () => {
    const { session, track } = await recordingSession();

    session.cancel();

    expect(session.isRecording()).toBe(false);
    expect(track.stopped).toBe(true);
  });

  it("reports it is recording only between start and stop", async () => {
    const { session } = await recordingSession();

    expect(session.isRecording()).toBe(false);
    const capture = session.start();
    expect(session.isRecording()).toBe(true);
    session.stop();
    await capture;
    expect(session.isRecording()).toBe(false);
  });

  it("times the take on the monotonic clock, not the wall clock", async () => {
    // The stop button is gated on elapsedMs(). A clock jump mid-set (NTP
    // sync, a manual time change) running Date.now() backwards would leave
    // the user unable to stop until the 90s hard cap fired.
    let ticks = 1000;
    const { session } = await recordingSession({ performanceNow: () => ticks });

    const capture = session.start();
    ticks = 7500;
    const elapsed = session.elapsedMs();
    session.stop();
    await capture;

    expect(elapsed).toBe(6500);
  });

  it("falls back to the wall clock where performance.now is unavailable", async () => {
    const { session } = await recordingSession();

    const capture = session.start();
    expect(session.elapsedMs()).toBeGreaterThanOrEqual(0);
    session.stop();
    await capture;
  });

  it("refuses to start without an open camera rather than throwing on null", async () => {
    const { recorder } = loadVideoRecorder();

    await expect(recorder.createSession().start()).rejects.toThrow("camera is not open");
  });
});

describe("flipping the camera", () => {
  it("releases the old stream before asking for the other lens", async () => {
    const first = fakeTrack();
    const second = fakeTrack();
    const streams = [fakeStream([first]), fakeStream([second])];
    const stoppedWhenRequested = [];
    const { recorder } = loadVideoRecorder({
      getUserMedia: () => {
        stoppedWhenRequested.push(first.stopped);
        return Promise.resolve(streams.shift());
      },
    });

    const session = recorder.createSession();
    await session.open("environment");
    await session.flip();

    // iOS refuses a second camera while the first is still live, so the
    // release has to happen before the request, not after it.
    expect(stoppedWhenRequested).toEqual([false, true]);
    expect(session.facingMode()).toBe("user");
  });

  it("falls back to the original lens rather than leaving a dead preview", async () => {
    const { recorder, requests } = loadVideoRecorder({
      getUserMedia: (constraints) =>
        constraints.video.facingMode.ideal === "user"
          ? Promise.reject(new Error("OverconstrainedError"))
          : Promise.resolve(fakeStream()),
    });

    const session = recorder.createSession();
    await session.open("environment");
    await expect(session.flip()).resolves.toBeTruthy();

    expect(requests.map((r) => r.video.facingMode.ideal)).toEqual([
      "environment",
      "user",
      "environment",
    ]);
    expect(session.facingMode()).toBe("environment");
  });
});

describe("keeping the preview smooth while recording", () => {
  // Left unconstrained, phones pick whatever mode the platform prefers --
  // on some that is 1080p/4K or 60fps -- and every extra pixel and frame is
  // encoder + preview work while the user is watching themselves lift.
  it("asks the camera for 720p at 30fps, as ideals the device may not meet", async () => {
    const { recorder, requests } = loadVideoRecorder();

    await recorder.createSession().open("environment");

    expect(requests).toHaveLength(1);
    expect(requests[0].video).toEqual({
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    });
    expect(requests[0].audio).toBe(false);
  });

  it("never uses a hard constraint, which would fail the whole call on a camera that can't meet it", () => {
    const { recorder } = loadVideoRecorder();

    const video = recorder.videoConstraints("user");
    for (const key of Object.keys(video)) {
      expect(Object.keys(video[key])).toEqual(["ideal"]);
    }
  });

  it("caps the encoder bitrate, and still names the container it picked", () => {
    const { recorder } = loadVideoRecorder({ supportedTypes: IOS_TYPES });

    expect(recorder.recorderOptions("video/mp4")).toEqual({
      mimeType: "video/mp4",
      videoBitsPerSecond: 1500000,
    });
    // "" means MediaRecorder chooses the container; the cap still applies.
    expect(recorder.recorderOptions("")).toEqual({ videoBitsPerSecond: 1500000 });
  });

  it("hands the bitrate cap to the MediaRecorder it actually builds", async () => {
    const { recorder, recorders } = loadVideoRecorder({ supportedTypes: IOS_TYPES });
    const session = recorder.createSession();
    await session.open("environment");

    session.start();

    expect(recorders).toHaveLength(1);
    expect(recorders[0].mimeType).toBe("video/mp4");
    expect(recorders[0].options).toEqual({ mimeType: "video/mp4", videoBitsPerSecond: 1500000 });
    session.cancel();
  });
});

describe("the bitrate cap follows every recording", () => {
  it("applies with no container chosen, without inventing a mimeType", async () => {
    // supportedTypes [] is the "MediaRecorder won't say" browser: pickMime()
    // returns "" and the recorder must be built with the cap alone.
    const { recorder, recorders } = loadVideoRecorder({ supportedTypes: [] });
    const session = recorder.createSession();
    await session.open("environment");

    session.start();

    expect(recorders[0].options).toEqual({ videoBitsPerSecond: 1500000 });
    expect(recorders[0].options).not.toHaveProperty("mimeType");
    session.cancel();
  });

  it("re-requests the same resolution and frame rate after a lens flip", async () => {
    const { recorder, requests } = loadVideoRecorder();
    const session = recorder.createSession();
    await session.open("environment");
    await session.flip();

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.video.width).toEqual({ ideal: 1280 });
      expect(request.video.height).toEqual({ ideal: 720 });
      expect(request.video.frameRate).toEqual({ ideal: 30 });
    }
    expect(requests[1].video.facingMode).toEqual({ ideal: "user" });
  });
});
