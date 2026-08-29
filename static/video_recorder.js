// In-app video recorder (RepCheckRecorder).
//
// The analyze page used to be upload-only: the one control was an
// <input type="file">, so "record a set" meant leaving RepCheck, filming in
// the system camera app, coming back, and hunting for the clip in the photo
// picker. This module is the recording half -- getUserMedia for a live
// preview, MediaRecorder for the capture, and a File handed back in exactly
// the shape the <input type="file"> would have produced, so the existing
// upload/analyze path needs no recorded-vs-uploaded branch.
//
// The same technique already ships on the challenges page (see the recorder
// inline in templates/challenges.html); this is that flow factored into a
// file so the analyze page can use it without a second hand-copied version,
// and so the parts that are easy to get wrong (container choice, cancel vs.
// stop, releasing the camera) are unit-testable.
//
// It works inside the packaged iOS shell as well as in a browser: Capacitor's
// WebViewDelegationHandler grants WKMediaCaptureType outright
// (node_modules/@capacitor/ios/.../WebViewDelegationHandler.swift), so the
// only gate is iOS's own camera permission prompt, backed by the
// NSCameraUsageDescription string codemagic.yaml writes into Info.plist.

(function (window, document) {
  "use strict";

  // Ordered by preference, not by popularity: iOS Safari (and therefore the
  // iOS shell's webview) records mp4 and cannot play a webm blob back, so
  // asking for webm first would leave the review/preview <video> a black
  // rectangle there AND hand the server a mislabelled file. Every other
  // browser falls through to webm, which app.py accepts alongside the
  // upload-from-file formats.
  var MIME_CANDIDATES = [
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];

  // Nothing here needs audio -- form analysis is entirely visual, the trim
  // step drops the audio track anyway, and asking for a microphone would
  // add an iOS permission prompt (and an NSMicrophoneUsageDescription
  // string) for data the app would immediately throw away.
  var AUDIO = false;

  function isSupported() {
    var media = window.navigator && window.navigator.mediaDevices;
    return Boolean(
      window.MediaRecorder &&
      media &&
      typeof media.getUserMedia === "function"
    );
  }

  /** The best container this browser can both record and play, or "" if it
   *  won't say -- an empty string means "let MediaRecorder choose", which is
   *  a valid outcome, not a failure. */
  function pickMime() {
    if (!window.MediaRecorder || typeof window.MediaRecorder.isTypeSupported !== "function") return "";
    for (var i = 0; i < MIME_CANDIDATES.length; i++) {
      if (window.MediaRecorder.isTypeSupported(MIME_CANDIDATES[i])) return MIME_CANDIDATES[i];
    }
    return "";
  }

  /** Monotonic clock where the browser has one; wall clock is the fallback. */
  function now() {
    var perf = window.performance;
    return perf && typeof perf.now === "function" ? perf.now() : Date.now();
  }

  function extensionForMime(mime) {
    return String(mime || "").indexOf("mp4") !== -1 ? "mp4" : "webm";
  }

  /**
   * The server decides what it will accept from the filename's extension, so
   * the extension has to describe the bytes rather than the page that made
   * them -- naming a webm recording "clip.mp4" is how a perfectly good
   * capture gets rejected at the ffmpeg step with a container error.
   */
  function filenameFor(mime) {
    return "recording." + extensionForMime(mime);
  }

  /**
   * Some phones (notably iPhones with multiple rear lenses) hand back the
   * 0.5x ultra-wide camera by default, which frames the lifter far too wide
   * for the analysis to see anything. 1.0 is the standard "1x" framing, so
   * pull the track to it where the browser exposes zoom control. Best-effort:
   * most webcams don't support zoom at all, and that is fine.
   */
  async function normalizeZoom(stream) {
    try {
      var track = stream.getVideoTracks()[0];
      if (!track || typeof track.getCapabilities !== "function") return;
      var caps = track.getCapabilities();
      if (!caps || typeof caps.zoom === "undefined") return;
      var target = 1;
      if (caps.zoom.min != null) target = Math.max(target, caps.zoom.min);
      if (caps.zoom.max != null) target = Math.min(target, caps.zoom.max);
      await track.applyConstraints({ advanced: [{ zoom: target }] });
    } catch (error) {
      /* zoom control is decoration -- never let it block a recording */
    }
  }

  /**
   * One recording session: camera on, record, stop with a File (or cancel
   * with nothing). Deliberately not a singleton -- the session owns the
   * MediaStream, and "who is allowed to turn the camera off" is the bug
   * class this shape exists to prevent.
   */
  function createSession() {
    var stream = null;
    var recorder = null;
    var chunks = [];
    var mime = "";
    var cancelled = false;
    var settle = null;
    var facing = "environment";
    var startedAt = 0;

    /**
     * Turn the camera on and resolve with the MediaStream.
     *
     * facingMode is a hint, not a demand ({ ideal: ... }): a laptop has one
     * camera and no rear/front distinction, and an exact constraint there
     * fails outright with OverconstrainedError instead of just using the
     * only camera the machine has.
     */
    async function open(facingMode) {
      facing = facingMode || facing;
      stream = await window.navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing } },
        audio: AUDIO,
      });
      await normalizeZoom(stream);
      return stream;
    }

    /** Swap between the front and rear camera, keeping the session alive. */
    async function flip() {
      var next = facing === "environment" ? "user" : "environment";
      var previous = stream;
      // Release the old stream FIRST: iOS refuses a second camera while the
      // first one is still live, so acquiring before releasing fails on the
      // exact devices this button exists for.
      stopTracks(previous);
      stream = null;
      try {
        return await open(next);
      } catch (error) {
        // Couldn't get the other lens -- fall back to the one we had rather
        // than leaving the user staring at a dead preview.
        facing = facing === "environment" ? "user" : "environment";
        return await open(facing);
      }
    }

    function stopTracks(target) {
      if (!target) return;
      target.getTracks().forEach(function (track) { track.stop(); });
    }

    /** True once start() has been called and stop()/cancel() has not. */
    function isRecording() {
      return Boolean(recorder && recorder.state !== "inactive");
    }

    /**
     * Monotonic, not wall-clock: the stop button is gated on this, and a
     * clock jump mid-set (NTP sync, a manual time change) run backwards
     * through Date.now() would leave the user unable to stop until the
     * hard cap fires.
     */
    function elapsedMs() {
      return startedAt ? now() - startedAt : 0;
    }

    /**
     * Begin capturing. Returns a promise that resolves with a File when
     * stop() is called, or with null if cancel() is called instead --
     * cancelling is an ordinary outcome (the user closed the sheet), not an
     * error, and must never produce a half-written clip for the server to
     * choke on.
     */
    function start() {
      if (!stream) return Promise.reject(new Error("camera is not open"));
      chunks = [];
      cancelled = false;
      mime = pickMime();
      recorder = new window.MediaRecorder(stream, mime ? { mimeType: mime } : {});
      var done = new Promise(function (resolve) { settle = resolve; });
      recorder.ondataavailable = function (event) {
        if (event.data && event.data.size) chunks.push(event.data);
      };
      recorder.onstop = function () {
        var resolve = settle;
        settle = null;
        if (!resolve) return;
        if (cancelled) return resolve(null);
        // MediaRecorder reports the container it actually used, which can
        // differ from what was asked for; trust it over our request so the
        // File's type and its extension can't disagree.
        var type = recorder.mimeType || mime || "video/webm";
        var blob = new window.Blob(chunks, { type: type });
        resolve(new window.File([blob], filenameFor(type), { type: type }));
      };
      recorder.start();
      startedAt = now();
      return done;
    }

    /** Stop recording and keep the clip. Resolves the promise from start(). */
    function stop() {
      if (isRecording()) recorder.stop();
      startedAt = 0;
      stopTracks(stream);
      stream = null;
    }

    /** Stop recording and throw the clip away, then release the camera. */
    function cancel() {
      cancelled = true;
      if (isRecording()) recorder.stop();
      // A session cancelled before start() has no onstop to fire, so settle
      // it here -- otherwise a caller awaiting start()'s promise would hang.
      if (settle) { var resolve = settle; settle = null; resolve(null); }
      startedAt = 0;
      stopTracks(stream);
      stream = null;
    }

    return {
      open: open,
      flip: flip,
      start: start,
      stop: stop,
      cancel: cancel,
      isRecording: isRecording,
      elapsedMs: elapsedMs,
      facingMode: function () { return facing; },
    };
  }

  window.RepCheckRecorder = {
    isSupported: isSupported,
    pickMime: pickMime,
    extensionForMime: extensionForMime,
    filenameFor: filenameFor,
    createSession: createSession,
  };
})(window, document);
