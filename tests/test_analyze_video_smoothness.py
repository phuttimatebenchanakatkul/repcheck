"""Smooth video on the analyze page, while recording and while analyzing.

Both halves of the flow stuttered on phones, for different reasons, and both
fixes are the kind that quietly regress -- a constraint dropped, a pause()
removed, an animation switched back to `top` -- without anything failing.

Recording: getUserMedia was called with only a facingMode, so the platform
picked the mode it preferred, which on some phones is 1080p/4K or 60fps.
MediaRecorder was created with only a container, so its bitrate was whatever
the browser defaulted to. Both fed an encoder and a preview that run while
the user watches themselves lift. static/video_recorder.js now asks for
720p30 (as `ideal`, never `max`, since a hard constraint the device can't
meet fails the whole call and the page reads that as "camera denied") and
caps the encoder bitrate. Behaviour covered in tests-js/videoRecorder.test.js.

Analyzing: three things competed with the clip's playback on the main thread.
The review <video> kept decoding behind display:none (a hidden video still
plays); MediaPipe's detectForVideo() -- 25-80ms a call on real phones -- ran
on the main thread; and the scan-line sweep animated `top`, a layout property.
The review clip is now paused, detection runs in static/pose_worker.js with
the main-thread landmarker kept only as a fallback, and the sweep is a
transform animation.

Source-level regex, the same tradeoff tests/test_in_app_recording.py makes:
the worker cannot be driven from jsdom (workers, ImageBitmap, WebGL), so what
is pinned here is the wiring. Mutation-checked: un-pausing the review video,
dropping the worker for the main-thread landmarker, sizing the canvas back to
the video's pixels, animating `top` again, or forgetting to terminate the
worker on a tab swap all fail this file.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def read(relative):
    return (ROOT / relative).read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def page():
    return read("templates/index.html")


@pytest.fixture(scope="module")
def worker():
    return read("static/pose_worker.js")


def js_function(source, name, indent="  "):
    """Body of a top-level `function name(...) {` ... `}` in the page's inline
    script (two-space indent) or in the worker (indent="")."""
    match = re.search(
        rf"^{indent}(?:async )?function {re.escape(name)}\([^)]*\) \{{(.*?)\n{indent}\}}",
        source,
        re.S | re.M,
    )
    assert match, f"{name}() not found"
    return match.group(1)


def css_rule(page, selector):
    match = re.search(rf"^  {re.escape(selector)} \{{(.*?)\n  \}}", page, re.S | re.M)
    assert match, f"CSS rule {selector} not found"
    return match.group(1)


def submit_handler(page):
    start = page.index('submitBtn.addEventListener("click"')
    end = page.index("function showAnalyzeError", start)
    return page[start:end]


# ---------- Only one copy of the clip decodes at a time ----------


def test_the_review_clip_is_paused_before_the_analyzing_view_takes_over(page):
    """display:none does not stop a <video>; two decodes of the same clip on
    a phone already uploading it is half the stutter."""
    body = submit_handler(page)
    assert "reviewVideo.pause();" in body
    assert body.index("reviewVideo.pause();") < body.index('analyzingView.style.display = "block"')


def test_a_failed_analysis_resumes_the_paused_review_clip(page):
    """Pausing it on submit means the error path has to play it again, or
    the user lands back on a frozen frame."""
    body = js_function(page, "showAnalyzeError")
    # play() rejects under autoplay policy; unguarded, that is an unhandled
    # rejection on every failed analysis.
    assert re.search(r"reviewVideo\.play\(\)\s*\.catch\(", body)


def test_the_analyzing_clip_stops_when_the_analysis_does(page):
    """The same rule, the other way round: once the results (or the error)
    are up, the analyzing view's clip is the hidden one, and it must not keep
    decoding behind the result's own copy."""
    stop = js_function(page, "stopPoseLoop")
    assert "previewVideo.pause();" in stop
    # Both exits from the analyzing view run stopPoseLoop() first.
    body = submit_handler(page)
    assert body.count("stopPoseLoop();") >= 2
    assert body.index("stopPoseLoop();") < body.index("showResult(data);")


def test_the_analyzing_clip_is_released_and_never_leaked(page):
    # One helper does the whole release everywhere, rather than three
    # hand-rolled copies that can each forget the load().
    assert "releaseVideo(previewVideo);" in js_function(page, "resetToCapture")
    assert "releaseVideo(reviewVideo);" in js_function(page, "backToCapture")
    # A retry after a failed analysis must revoke the previous blob URL.
    body = submit_handler(page)
    assert "if (previewVideo.src) URL.revokeObjectURL(previewVideo.src);" in body
    assert body.index("URL.revokeObjectURL(previewVideo.src)") < body.index("previewVideo.src = URL.createObjectURL(file);")


# ---------- Detection runs off the main thread ----------


def test_the_analyze_page_loads_pose_detection_in_a_worker(page):
    assert "asset_url('pose_worker.js')" in page, (
        "the worker URL must go through asset_url so it is root-relative "
        "(pagenav.js runs this script with no base URL) and cache-busted"
    )
    # A classic worker, not { type: "module" }: MediaPipe's WASM loader calls
    # importScripts(), which module workers refuse, so a module worker fails
    # at init every time (checked in Chromium). The worker uses import().
    assert re.search(r"new Worker\(POSE_WORKER_URL\);", page), (
        "the pose worker must be a classic worker -- MediaPipe's loader needs importScripts()"
    )
    assert 'type: "module"' not in page


def test_the_worker_is_tried_first_and_the_main_thread_is_only_the_fallback(page, worker):
    """The whole point: detectForVideo() must not run on the main thread
    where a worker is available."""
    assert re.search(
        r"return getPoseWorker\(\)\.then\(\(worker\) => worker \|\| \(poseWanted \? getPoseLandmarker\(\) : null\)\);",
        js_function(page, "getPoseBackend"),
    ), "getPoseBackend() must prefer the worker and fall back to getPoseLandmarker() only while wanted"
    assert "getPoseBackend().then((backend) => { if (backend) startPoseLoop(); });" in submit_handler(page)
    # A worker that never comes up (old browser, CDN blocked) must not take
    # the overlay down with it.
    assert "poseWorkerDead = true;" in page
    assert "await import(msg.visionUrl)" in worker
    assert "if (poseWorkerDead || !poseWorkerSupported()) return Promise.resolve(null);" in page


def test_frames_go_to_the_worker_one_at_a_time_and_downscaled(page):
    """One in flight keeps detectForVideo()'s timestamps monotonic (it throws
    otherwise, and the instance is wedged for good); downscaling keeps a 720p
    or 4K frame from being copied across and uploaded as a texture."""
    loop = js_function(page, "startPoseLoop")
    assert re.search(r"if \(poseWorker\) \{\s*if \(!poseFrameInFlight\) \{", loop)
    assert "sendPoseFrame(poseWorker, now);" in loop

    send = js_function(page, "sendPoseFrame")
    assert "poseFrameInFlight = true;" in send
    assert 'worker.postMessage({ type: "frame", bitmap, ts }, [bitmap]);' in send, (
        "the ImageBitmap must be transferred, not copied"
    )
    assert "const POSE_FRAME_MAX_SIDE = 480;" in page
    assert "resizeWidth" in page and "resizeHeight" in page


def test_the_worker_speaks_the_protocol_the_page_expects(worker):
    assert 'msg.type === "init"' in worker
    assert 'msg.type === "frame"' in worker
    assert 'self.postMessage({ type: "ready" });' in worker
    assert 'self.postMessage({ type: "result", ts: msg.ts, landmarks: result.landmarks || [] });' in worker
    assert 'type: "error"' in worker
    # The model itself runs here, nowhere else on this path.
    assert "landmarker.detectForVideo(bitmap, msg.ts)" in worker
    # A transferred bitmap is owned by the worker; close it rather than wait on GC.
    assert "bitmap.close()" in worker
    # GPU where the worker has WebGL, CPU where it doesn't (iOS before 17).
    assert '"GPU"' in worker and '"CPU"' in worker


def test_a_wedged_worker_is_dropped_and_the_main_thread_takes_this_analysis(page):
    """Same finding as the main-thread landmarker: after one detection
    failure every later call fails too, so the worker holding it has to go.
    A worker that came up but cannot detect will do the same next time, so
    the path is marked dead rather than rebuilt to fail again -- and the
    still-running loop is given the main-thread landmarker to switch to."""
    body = js_function(page, "onPoseWorkerError")
    assert body.index("dropPoseWorker();") < body.index("poseWorkerDead = true;")
    assert "if (poseWanted) getPoseLandmarker();" in body
    drop = js_function(page, "dropPoseWorker")
    assert "poseWorker.terminate()" in drop
    assert "poseWorkerPromise = null;" in drop
    # A drop while a frame is out must not leave the NEXT backend waiting on
    # a result that will never come.
    assert "poseFrameInFlight = false;" in drop


def test_a_swap_during_worker_init_does_not_leave_the_pending_worker_alive(page):
    """poseWorker is only set on "ready". A tab swap during the multi-second
    model load used to null the promise and walk away from the Worker that
    was mid-load; when it finished it cached itself into a dead scope and
    lived, WASM runtime and all, until full page unload."""
    getter = js_function(page, "getPoseWorker")
    assert "poseWorkerPending = worker;" in getter
    drop = js_function(page, "dropPoseWorker")
    assert "if (poseWorkerPending) poseWorkerPending.terminate();" in drop
    assert "poseWorkerPending = null;" in drop
    # Belt and braces: a ready that arrives for a worker nobody is waiting on
    # is refused rather than cached.
    ready = re.search(r'if \(msg\.type === "ready"\) \{(.*?)\n            poseWorkerPending = null;', getter, re.S)
    assert ready, "the ready handler must clear the pending slot"
    assert "if (poseWorkerPending !== worker) {" in ready.group(1)
    assert "worker.terminate();" in ready.group(1) and "resolve(null);" in ready.group(1)


def test_a_page_swap_tears_down_the_loop_and_the_worker(page):
    """pagenav.js swaps <main> without unloading the document, so a worker
    left behind would keep the WASM runtime and model alive with nothing on
    the page talking to it, and the rAF loop would keep ticking against a
    detached <video> for as long as the upload takes."""
    handlers = re.findall(
        r'document\.addEventListener\(\s*"repcheck:page-will-swap"\s*,\s*([A-Za-z0-9_$]+)', page
    )
    assert "teardownPose" in handlers
    body = js_function(page, "teardownPose")
    assert "stopPoseLoop();" in body and "dropPoseWorker();" in body


def test_late_results_cannot_repaint_a_cleared_canvas(page):
    """A frame posted just before the analysis finished answers after
    stopPoseLoop() has cleared the canvas; drawing it would leave a
    skeleton on the results view's stage."""
    assert "if (poseWanted) drawPose(msg);" in js_function(page, "onPoseWorkerMessage")


def test_a_new_analysis_starts_with_no_frame_in_flight(page):
    """A frame that never came back (a worker the platform killed without
    firing onerror) must not gate every later analysis's sends."""
    assert "poseFrameInFlight = false;" in js_function(page, "stopPoseLoop")


def test_a_worker_that_stops_answering_is_given_up_on(page):
    """No onerror fires for a worker iOS killed for memory; only a deadline
    on the in-flight frame notices. Generous, because the first detection
    includes shader compilation and has been measured above ten seconds."""
    timeout = re.search(r"const POSE_RESULT_TIMEOUT_MS = (\d+);", page)
    assert timeout and int(timeout.group(1)) >= 20000
    loop = js_function(page, "startPoseLoop")
    assert re.search(
        r"\} else if \(now - poseFrameDeadlineAt > POSE_RESULT_TIMEOUT_MS\) \{\s*onPoseWorkerError\(", loop
    )


# ---------- Failure paths, pinned individually ----------
#
# The happy path above is what a demo exercises; these are the branches that
# only run when something is already wrong, which is exactly when a silent
# regression costs the most (a wedged loop, a leaked bitmap, a worker that
# never gets replaced).


def test_a_worker_that_fails_to_start_is_torn_down_and_the_main_thread_takes_over(page):
    """A 404 on the worker script, a blocked CDN inside it, or an init error
    it reports itself must all land in the same place: worker gone, flag set,
    the pending promise cleared so nothing awaits it forever, and null handed
    back so getPoseBackend() falls through to getPoseLandmarker()."""
    body = js_function(page, "getPoseWorker")
    fail = re.search(r"const fail = \(err\) => \{(.*?)\n        \};", body, re.S)
    assert fail, "getPoseWorker() has no fail() handler"
    for line in ("worker.terminate();", "poseWorkerDead = true;", "poseWorkerPromise = null;", "resolve(null);"):
        assert line in fail.group(1), f"fail() must {line}"
    # Both ways a worker can fail before "ready" route through it.
    assert "worker.onerror = fail;" in body
    assert re.search(r'else if \(msg\.type === "error"\) \{\s*fail\(msg\.message\);', body)
    # And a browser that refuses to even construct one.
    assert re.search(
        r"\} catch \(err\) \{\s*console\.warn\([^)]*\);\s*poseWorkerDead = true;\s*resolve\(null\);\s*return;", body
    )


def test_a_ready_worker_is_cached_and_its_handlers_swapped_to_the_live_ones(page):
    """Once "ready" arrives the init-time handlers (which treat any error as
    a failed start) have to give way to the per-frame ones, and the worker
    has to be cached so the next analysis skips the model load."""
    body = js_function(page, "getPoseWorker")
    ready = re.search(r'if \(msg\.type === "ready"\) \{(.*?)\n          \}', body, re.S)
    assert ready, "no ready handler"
    assert "worker.onerror = onPoseWorkerError;" in ready.group(1)
    assert "worker.onmessage = onPoseWorkerMessage;" in ready.group(1)
    assert "poseWorker = worker;" in ready.group(1)
    assert "resolve(worker);" in ready.group(1)
    # Fast paths: a cached worker, or an init already in flight, is reused --
    # two submits before "ready" must not build two workers.
    assert body.lstrip().startswith("if (poseWorker) return Promise.resolve(poseWorker);")
    assert "if (!poseWorkerPromise) {" in body


def test_the_page_and_the_worker_agree_on_the_init_message(page, worker):
    init = re.search(r'worker\.postMessage\(\{\s*type: "init",(.*?)\}\);', page, re.S)
    assert init, "the page never sends init"
    for field in ("visionUrl: POSE_VISION_URL", "wasmUrl: POSE_WASM_URL", "modelUrl: POSE_MODEL_URL"):
        assert field in init.group(1)
    for field in ("msg.visionUrl", "msg.wasmUrl", "msg.modelUrl"):
        assert field in worker, f"pose_worker.js never reads {field}"
    assert "FilesetResolver.forVisionTasks(msg.wasmUrl)" in worker


def test_a_worker_error_mid_analysis_routes_to_the_drop_handler(page):
    handler = js_function(page, "onPoseWorkerMessage")
    assert re.search(r'else if \(msg\.type === "error"\) \{\s*onPoseWorkerError\(msg\.message\);', handler)


def test_a_failed_frame_grab_cannot_wedge_the_loop(page):
    """poseFrameInFlight gates every later send. If createImageBitmap()
    rejects (a video element mid-seek, a browser that refuses the resize
    options AND the plain call) the flag has to come back down, or the
    skeleton silently stops for the rest of the analysis."""
    send = js_function(page, "sendPoseFrame")
    rejection = re.search(r"\(err\) => \{(.*?)\n      \}", send, re.S)
    assert rejection and "poseFrameInFlight = false;" in rejection.group(1), "grab rejection must reset the flag"
    # ...and a browser that refuses createImageBitmap(video) outright, frame
    # after frame, hands the analysis to the main thread instead of showing
    # nothing with a working worker idle.
    assert "if (++poseGrabFailures >= POSE_GRAB_FAILURE_LIMIT) onPoseWorkerError(err);" in rejection.group(1)
    assert "poseGrabFailures = 0;" in send
    # Resize options refused -> retry without them, and remember it so later
    # frames don't each pay a rejected attempt first.
    assert "poseResizeUnsupported = true;" in send
    assert "createImageBitmap(previewVideo).then((bitmap) => {" in send
    assert "const options = poseResizeUnsupported ? null : poseFrameOptions();" in send
    # A small clip needs no downscale: no options, plain call.
    assert ": createImageBitmap(previewVideo);" in send


def test_a_stale_or_untransferable_bitmap_is_closed_not_leaked(page):
    send = js_function(page, "sendPoseFrame")
    # The bitmap resolved after the worker was dropped, or after the analysis
    # ended: owned here, so close it -- and only lower the flag if it was THIS
    # worker's frame, never one belonging to the replacement worker.
    stale = re.search(r"if \(poseWorker !== worker \|\| !poseWanted\) \{(.*?)\n        \}", send, re.S)
    assert stale and "bitmap.close();" in stale.group(1)
    assert "if (poseWorker === worker) poseFrameInFlight = false;" in stale.group(1)
    # postMessage can throw (DataCloneError) -- an unhandled throw here would
    # leave the flag up for the rest of the page-load.
    caught = re.search(
        r"try \{\s*worker\.postMessage\(\{ type: \"frame\", bitmap, ts \}, \[bitmap\]\);\s*\} catch \(err\) \{(.*?)\n        \}",
        send,
        re.S,
    )
    assert caught, "postMessage must be guarded"
    assert "bitmap.close();" in caught.group(1) and "onPoseWorkerError(err);" in caught.group(1)


def test_frames_are_only_downscaled_when_they_are_actually_larger(page):
    body = js_function(page, "poseFrameOptions")
    # `!(scale < 1)` rather than `scale >= 1`: a 0x0 video (metadata not in
    # yet) makes scale Infinity/NaN, and both must mean "no resize".
    assert "if (!(scale < 1)) return null;" in body
    assert 'resizeQuality: "low"' in body


def test_the_main_thread_fallback_keeps_its_guards(page):
    """Re-nesting the old loop under the worker branch must not have lost
    the two things it guarded: one rAF chain per page, and a wedged
    landmarker dropped rather than reused."""
    loop = js_function(page, "startPoseLoop")
    assert "if (poseRafId) return;" in loop
    main = re.search(r"\} else if \(poseLandmarker\) \{(.*?)\n        \}\n", loop, re.S)
    assert main, "main-thread branch missing"
    assert "poseLandmarker.detectForVideo(previewVideo, now)" in main.group(1)
    assert "poseLandmarker = null;" in main.group(1)
    assert "poseLandmarkerPromise = null;" in main.group(1)


def test_the_two_landmarker_bootstraps_point_at_each_other(page, worker):
    """The worker cannot see the page and vice versa; the model options live
    in both, so each copy names the other."""
    assert "Mirror of createLandmarker() in static/pose_worker.js" in page
    assert "Mirror of createLandmarker() in templates/index.html" in worker


def test_the_worker_closes_every_bitmap_and_refuses_frames_before_init(worker):
    detect = js_function(worker, "detect", indent="")
    # `finally`, not after the call: a throwing detectForVideo() must not leak
    # the transferred bitmap's backing store.
    assert re.search(r"\} finally \{[^}]*bitmap\.close\(\)", detect, re.S)
    assert 'throw new Error("pose worker received a frame before init")' in detect
    # Unknown message types are ignored, not treated as fatal.
    handler = re.search(r"self\.onmessage = async \(event\) => \{(.*?)\n\};", worker, re.S).group(1)
    assert handler.count("msg.type ===") == 2


# ---------- The overlay itself is cheap to composite ----------


def test_the_skeleton_canvas_is_sized_to_its_box_not_the_clip(page):
    """videoWidth x videoHeight made a 1080p clip's overlay a 2-megapixel
    layer re-uploaded on every redraw; the landmarks are normalized so the
    displayed box (times DPR, capped) is all the resolution it needs."""
    sync = js_function(page, "syncPoseCanvasSize")
    assert "const POSE_CANVAS_MAX_DPR = 2;" in page
    assert "Math.min(window.devicePixelRatio || 1, POSE_CANVAS_MAX_DPR)" in sync
    assert "poseCanvas.clientWidth" in sync and "poseCanvas.clientHeight" in sync
    assert "videoWidth" not in sync, "the clip's pixel grid must never size the overlay"
    loop = js_function(page, "startPoseLoop")
    assert "poseCanvas.width = previewVideo.videoWidth" not in loop
    draw = js_function(page, "drawPose")
    assert draw.lstrip().startswith("if (!syncPoseCanvasSize()) return;")


def test_the_canvas_backing_store_skips_unlaid_boxes_and_only_resizes_on_change(page):
    """Setting canvas.width clears it, so an unconditional assignment would
    wipe the skeleton on every draw; and mid display-toggle the box is 0x0,
    where the only sane answer is to draw nothing this frame."""
    sync = js_function(page, "syncPoseCanvasSize")
    assert "if (!cssW || !cssH) return false;" in sync
    assert "if (poseCanvas.width !== w || poseCanvas.height !== h) {" in sync
    assert sync.rstrip().endswith("return true;")


def test_the_scan_line_sweeps_with_transform_not_top(page):
    """`top` re-lays-out and repaints on the main thread every frame, over a
    video being decoded; transform runs on the compositor."""
    keyframes = re.search(r"@keyframes scan \{(.*?)\n  \}", page, re.S)
    assert keyframes, "the scan keyframes are missing"
    assert "transform: translateY" in keyframes.group(1)
    assert "top:" not in keyframes.group(1)
    # translateY(100%) is relative to the moving element's own height, so it
    # is the stage-sized wrapper that moves, carrying the 2px line.
    # The line's thickness lives in one custom property, used by both the
    # line and the sweep's end point.
    assert "transform: translateY(calc(100% - var(--scan-line-height)));" in keyframes.group(1)
    wrapper = css_rule(page, ".scan-line")
    assert "animation: scan" in wrapper
    assert "inset: 0;" in wrapper and "position: absolute;" in wrapper and "pointer-events: none;" in wrapper


def test_the_scan_line_glow_is_painted_once_not_filtered_every_frame(page):
    """A filter on the moving layer is re-applied by the compositor every
    frame over the whole stage; a box-shadow on the 2px line is painted once
    into the layer and only the transform changes per frame."""
    line = css_rule(page, ".scan-line::before")
    assert "height: var(--scan-line-height);" in line
    assert "--scan-line-height: 2px;" in css_rule(page, ".scan-line")
    assert "box-shadow:" in line
    assert "filter:" not in line
    assert "filter:" not in css_rule(page, ".scan-line")


# ---------- Second review round ----------


def test_the_analyzing_clip_is_played_inside_the_tap_gesture(page):
    """autoplay alone is not enough on iOS: a src swapped in after load does
    not always autoplay, Low Power Mode refuses outright, and stopPoseLoop()
    has explicitly paused this element after the previous analysis. Without
    play() the analyzing view is a frozen frame under a moving scan line."""
    body = submit_handler(page)
    assert re.search(r"previewVideo\.play\(\)\s*\.catch\(", body)
    assert body.index("previewVideo.src = URL.createObjectURL(file);") < body.index("previewVideo.play()")


def test_a_result_arriving_after_a_tab_swap_never_touches_the_live_document(page):
    """showResult() adds a results-only class to <html> that hides the tab
    bar, and only resetToCapture() removes it -- unreachable once the page is
    gone. A fetch resolving after a swap must be dropped, both branches."""
    body = submit_handler(page)
    assert "const generation = ++analysisGeneration;" in body
    assert body.count("if (generation !== analysisGeneration) return;") == 2
    # Both guards come before anything that touches the document.
    assert body.index("if (generation !== analysisGeneration) return;") < body.index("showResult(data);")
    teardown = js_function(page, "teardownPose")
    assert "analysisGeneration++;" in teardown
    assert "stopCycleStatus();" in teardown


def test_a_result_is_only_accepted_for_the_frame_being_waited_on(page):
    """The first detection can take seconds; a result for the previous clip
    must not be drawn over the next one, nor lower the flag for a frame it
    does not own."""
    handler = js_function(page, "onPoseWorkerMessage")
    assert "if (msg.ts !== poseFrameTs) return;" in handler
    assert handler.index("if (msg.ts !== poseFrameTs) return;") < handler.index("poseFrameInFlight = false;")


def test_the_result_deadline_survives_a_background_suspend(page):
    """iOS suspends page and worker in the background; on return the
    in-flight frame would look overdue and a healthy worker would be demoted
    for the rest of the session."""
    assert re.search(
        r'document\.addEventListener\("visibilitychange", \(\) => \{\s*'
        r"if \(!document\.hidden && poseFrameInFlight\) poseFrameDeadlineAt = performance\.now\(\);",
        page,
    )
    # And ONLY the clock: the frame the result is matched against must keep
    # its name, or its own result comes back unrecognisable, the in-flight
    # flag stays up, and this very deadline then drops a healthy worker.
    listener = re.search(
        r'document\.addEventListener\("visibilitychange", \(\) => \{(.*?)\n  \}\);', page, re.S
    ).group(1)
    identity = re.search(r"if \(msg\.ts !== ([A-Za-z_$][\w$]*)\) return;", js_function(page, "onPoseWorkerMessage")).group(1)
    assert f"{identity} =" not in listener, (
        "resetting the deadline must not rename the frame the page is waiting for"
    )
    # The deadline the loop reads is the one the listener resets.
    assert "now - poseFrameDeadlineAt > POSE_RESULT_TIMEOUT_MS" in js_function(page, "startPoseLoop")
    send = js_function(page, "sendPoseFrame")
    assert "poseFrameTs = ts;" in send and "poseFrameDeadlineAt = ts;" in send


def test_a_page_swap_releases_the_main_thread_landmarker_and_the_clips_too(page):
    teardown = js_function(page, "teardownPose")
    assert "poseTornDown = true;" in teardown
    assert "poseLandmarker.close()" in teardown
    assert "poseLandmarker = null;" in teardown and "poseLandmarkerPromise = null;" in teardown
    assert "releaseVideo(previewVideo);" in teardown
    assert "releaseVideo(reviewVideo);" in teardown and "reviewUrl = null;" in teardown
    # The results-only chrome (tab bar hidden, full-bleed) is removed by
    # resetToCapture alone, which the next page can never reach.
    assert 'document.documentElement.classList.remove("an-result");' in teardown
    assert "window.__agCleanup()" in teardown and "window.__anBarCleanup()" in teardown
    release = js_function(page, "releaseVideo")
    for line in ("video.pause();", "URL.revokeObjectURL(video.src);", 'video.removeAttribute("src");', "video.load();"):
        assert line in release
    # A landmarker that finishes loading after the swap is closed, not cached.
    loader = js_function(page, "getPoseLandmarker")
    assert re.search(r"if \(poseTornDown\) \{.*?landmarker\.close\(\);.*?return null;", loader, re.S)
    assert loader.index("if (poseTornDown)") < loader.index("poseLandmarker = landmarker;")


def test_grab_failures_only_count_for_a_live_analysis_on_this_worker(page):
    send = js_function(page, "sendPoseFrame")
    rejection = re.search(r"\(err\) => \{(.*?)\n      \}", send, re.S).group(1)
    assert rejection.index("if (poseWorker !== worker) return;") < rejection.index("poseFrameInFlight = false;")
    assert rejection.index("if (!poseWanted) return;") < rejection.index("++poseGrabFailures")


def test_the_skeleton_is_drawn_onto_the_fitted_frame_not_the_whole_box(page):
    """The video is contain-fitted inside a width-100%, max-70vh box, so a
    portrait clip on a phone is pillar-boxed; landmarks are normalized to
    the frame, and drawing them against the box squashes the skeleton."""
    video_css = css_rule(page, ".video-wrap video")
    assert "max-height: 70vh;" in video_css
    assert "max-height" not in css_rule(page, ".video-wrap"), "the cap belongs on the video, not the wrap"
    rect = js_function(page, "poseFrameRect")
    assert "Math.min(boxW / vw, boxH / vh)" in rect
    assert "x: (boxW - w) / 2, y: (boxH - h) / 2" in rect
    draw = js_function(page, "drawPose")
    assert "const frame = poseFrameRect();" in draw
    assert "frame.x + p1.x * frame.w, frame.y + p1.y * frame.h" in draw
    assert "p.x * poseCanvas.width" not in draw


def test_the_scan_line_respects_reduced_motion(page):
    assert re.search(
        r"@media \(prefers-reduced-motion: reduce\) \{\s*\.scan-line \{ display: none; \}", page
    )


def test_the_worker_path_needs_both_workers_and_createimagebitmap(page):
    """sendPoseFrame calls createImageBitmap bare. On a browser with Worker
    but no createImageBitmap (Safari before 15) that throws inside the rAF
    callback, before the next frame is scheduled -- so poseRafId stays
    non-null and `if (poseRafId) return;` kills the overlay for good."""
    body = js_function(page, "poseWorkerSupported")
    assert 'typeof window.Worker === "function"' in body
    assert 'typeof window.createImageBitmap === "function"' in body


def test_downscaling_is_only_abandoned_when_the_plain_grab_is_what_worked(page):
    """A transient rejection (the clip released mid-grab) must not disable
    downscaling for the page-load and ship every later frame full size."""
    send = js_function(page, "sendPoseFrame")
    assert re.search(
        r"createImageBitmap\(previewVideo\)\.then\(\(bitmap\) => \{\s*poseResizeUnsupported = true;\s*return bitmap;",
        send,
    ), "the flag must be set on the retry's success, not on the first call's rejection"


def test_a_history_detail_arriving_after_a_swap_is_dropped_too(page):
    """Same hazard as the submit path: showResult() against detached nodes,
    and results-only chrome on whatever page the user is now looking at."""
    start = page.index("async function openHistoryDetail")
    body = page[start:page.index("\n  }\n", page.index("catch", start))]
    assert "const generation = analysisGeneration;" in body
    assert "if (generation !== analysisGeneration) return;" in body
