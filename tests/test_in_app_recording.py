"""Recording a set inside the app, rather than leaving for the camera app.

The analyze page used to be a form whose only control was an
<input type="file">, so "record a set" meant leaving RepCheck, filming in
the system camera app, and coming back through the photo picker. It is now
a viewfinder: the camera opens on arrival, the only controls are the shutter
and the lens switch, and finishing a take lands on the clip looping while
the exercise gets picked from the shared bottom sheet.

Two halves are pinned here.

The server half is behavioural: /analyze must accept .webm on top of the
upload-from-file formats. It rejected it before, which would have failed
every recording made on Android or on the desktop web with an "Unsupported
file type" message pointing at a file the user never chose.

The page half is source-level regex, the same tradeoff
tests/test_native_bridge_wiring.py makes -- the recorder's own behaviour is
covered properly against the real file in tests-js/videoRecorder.test.js, so
what's left here is textual: does the camera open by itself, are the
controls the two they are meant to be, does a finished take reach the
looping review, and is the camera let go of when it is not filming.

Mutation-checked: dropping RECORDED_EXTENSIONS from either route, removing
the load-time openCamera(), adding a third control to the capture row,
dropping loop/muted from the review video, or sending a failed analysis back
to the camera instead of the clip all fail this file.
"""

import io
import re
from pathlib import Path

import pytest

import app as app_module
import database
from database import create_local_user

ROOT = Path(__file__).resolve().parent.parent


def read(relative):
    return (ROOT / relative).read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def page():
    return read("templates/index.html")


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    app_module.app.config["TESTING"] = True
    client = app_module.app.test_client()
    # The whole app is behind require_login (app.py), so a logged-out POST
    # never reaches the extension check at all -- it just redirects.
    user_id = create_local_user("recorder@test.local", "irrelevant-password", "Test User")
    with client.session_transaction() as sess:
        sess["user_id"] = user_id
    return client


class _ReachedThePipeline(Exception):
    """Sentinel: the upload passed every gate and would have been analyzed.

    Raised instead of running the real pipeline, which shells out to ffmpeg
    and calls Gemini -- neither belongs in a test of which extensions get
    through.
    """


@pytest.fixture
def pipeline_sentinel(monkeypatch):
    def explode(*args, **kwargs):
        raise _ReachedThePipeline()

    monkeypatch.setattr(app_module, "run_pipeline", explode)


def post_video(client, filename):
    return client.post(
        "/analyze",
        data={
            "video": (io.BytesIO(b"not really a video"), filename),
            "exercise": "bicep_curl",
        },
        content_type="multipart/form-data",
        headers={"Accept": "application/json"},
    )


# ---------- The server half ----------


def test_webm_from_the_in_app_recorder_is_accepted(client, pipeline_sentinel):
    """MediaRecorder writes webm everywhere but iOS Safari, so rejecting it
    would have broken recording for every Android and desktop user."""
    with pytest.raises(_ReachedThePipeline):
        post_video(client, "recording.webm")


def test_mp4_from_an_ios_recording_is_accepted(client, pipeline_sentinel):
    with pytest.raises(_ReachedThePipeline):
        post_video(client, "recording.mp4")


def test_a_genuinely_unsupported_format_is_still_rejected(client, pipeline_sentinel):
    """Widening the gate for recordings must not open it to anything."""
    response = post_video(client, "notes.txt")

    assert response.status_code == 400
    assert "Unsupported file type" in response.get_json()["error"]


def test_the_error_message_still_names_only_uploadable_formats(client, pipeline_sentinel):
    """.webm is accepted, not advertised -- nobody picking a file by hand has
    one, so listing it would only make the message harder to act on."""
    error = post_video(client, "notes.txt").get_json()["error"]

    assert ".webm" not in error
    assert ".mp4" in error


def test_both_video_routes_gate_on_the_same_two_sets():
    """The challenge route already allowed recordings; the analyze route now
    shares the constant instead of carrying a second literal that can drift."""
    source = read("app.py")

    assert source.count("ALLOWED_EXTENSIONS | RECORDED_EXTENSIONS") == 2
    assert ".webm" in app_module.RECORDED_EXTENSIONS
    # Kept apart on purpose: ALLOWED_EXTENSIONS is what the upload copy and
    # the error message describe.
    assert not app_module.ALLOWED_EXTENSIONS & app_module.RECORDED_EXTENSIONS


# ---------- The page half ----------


def test_the_analyze_page_opens_the_camera_on_arrival(page):
    """A viewfinder, not a form with a camera button on it: the thing people
    come here to do is film the set they are in the middle of, and every step
    before the preview is a step spent not filming."""
    assert "asset_url('video_recorder.js')" in page, (
        "the analyze page must load static/video_recorder.js"
    )
    assert "RepCheckRecorder.createSession()" in page
    # Called at the top level of the module script, not from a click.
    assert re.search(r"^  openCamera\(\);$", page, re.M), (
        "the viewfinder must open on load, not wait for a button"
    )


def test_the_capture_screen_carries_exactly_two_controls(page):
    """Record and switch lens. Anything else on this screen is something
    standing between the user and the set they are filming."""
    row = page[page.index('<div class="an-cam-controls"'):page.index('id="an-cam-fallback"')]
    buttons = re.findall(r'<button[^>]*id="([^"]+)"', row)

    assert buttons == ["an-shutter", "an-cam-flip"]


def test_one_shutter_toggles_between_record_and_stop(page):
    """Separate start/stop buttons would leave a dead control on screen in
    each state; the shutter is the state indicator as well as the control
    (.is-recording turns the disc into the stop square)."""
    assert 'shutter.addEventListener("click"' in page
    assert "if (camSession.isRecording()) stopRecording();" in page
    assert "else startRecording();" in page
    assert ".an-shutter.is-recording .an-shutter-core" in page


def test_finishing_a_recording_lands_on_the_looping_review(page):
    """The clip plays on repeat while the exercise is picked, so the <video>
    has to carry loop/autoplay/muted/playsinline -- iOS refuses to autoplay
    inline without muted and playsinline both present."""
    tag = re.search(r'<video id="an-review-video"[^>]*>', page)
    assert tag, "the review view must have a video element"
    for attribute in ("autoplay", "loop", "muted", "playsinline"):
        assert attribute in tag.group(0), f"review video is missing {attribute}"
    assert "if (file) showReview(file);" in page


def test_the_exercise_is_chosen_from_the_bottom_sheet_under_the_clip(page):
    review = page[page.index('id="review-view"'):page.index('id="analyzing-view"')]

    assert 'id="ex-picker-btn"' in review, (
        "the exercise picker button belongs on the review screen, under the clip"
    )
    assert 'id="submit-btn"' in review
    # The picker itself is the shared bottom sheet, not a new control.
    assert 'class="log-sheet-overlay" id="ex-modal-overlay"' in page


def test_analyze_with_no_exercise_opens_the_picker_instead_of_doing_nothing(page):
    """Nothing can be graded without knowing the movement, and a button that
    silently does nothing reads as broken."""
    assert re.search(
        r"if \(!exerciseInput\.value\) \{\s*\n\s*openExerciseModal\(\);", page
    ), "Analyze workout must open the picker when no exercise is set"


def test_the_camera_is_released_when_it_is_not_being_used(page):
    """A page holding the camera open behind another screen keeps the
    indicator light on over something that is not filming."""
    assert 'document.addEventListener("visibilitychange"' in page
    assert 'window.addEventListener("pagehide", closeCamera)' in page
    # And for the length of the analysis, the longest the page ever spends
    # not filming.
    analyze = page[page.index('submitBtn.addEventListener("click"'):]
    assert "closeCamera();" in analyze


def test_only_the_preview_is_mirrored_never_the_recording(page):
    """A front-camera preview has to mirror or people correct their position
    the wrong way -- but mirroring the recorded file would flip every
    left/right note in the analysis."""
    assert ".an-cam.is-front .an-cam-video { transform: scaleX(-1); }" in page
    # Exactly once, in that CSS rule: nothing touches the recorded File.
    assert page.count("scaleX(-1)") == 1


def test_upload_survives_as_the_camera_unavailable_fallback(page):
    """Denied permission, or a browser with no MediaRecorder, would otherwise
    leave the user unable to analyze anything at all."""
    assert 'id="an-cam-fallback" style="display:none;"' in page
    assert 'showCameraFallback("analyze.cameraUnsupported")' in page
    assert 'showCameraFallback("analyze.cameraDenied")' in page
    # It reaches the same review screen, so there is one path from "we have
    # a video" to "it got analyzed".
    assert "if (file) showReview(file);" in page


def test_a_new_clip_clears_the_previous_one_s_error(page):
    """Otherwise a failure message from the last take sits over a video it
    has nothing to do with."""
    body = re.search(r"function showReview\(file\) \{(.*?)\n  \}", page, re.S)
    assert body, "showReview() not found"
    assert 'reviewView.querySelector(".error")' in body.group(1)
    assert "staleError.remove()" in body.group(1)


def test_a_failed_analysis_returns_to_the_clip_not_to_the_camera(page):
    """The recording is still good -- sending the user back to a viewfinder
    would ask them to film the set again just to retry."""
    body = re.search(r"function showAnalyzeError\(message\) \{(.*?)\n  \}", page, re.S)
    assert body, "showAnalyzeError() not found"
    assert 'reviewView.style.display = "block"' in body.group(1)
    assert 'captureView.style.display = "block"' not in body.group(1)


def test_a_late_finishing_take_cannot_tear_down_a_newer_session(page):
    """closeCamera() during a take resolves the capture promise afterwards.
    Without pinning the session, that late handler would null out whichever
    session openCamera() had since put in its place, leaving a live preview
    with a dead shutter."""
    body = re.search(r"function startRecording\(\) \{(.*?)\n  \}", page, re.S)
    assert body, "startRecording() not found"
    assert "const session = camSession;" in body.group(1)
    assert "if (camSession !== session) return;" in body.group(1)


def test_the_product_tour_points_at_the_shutter():
    """The tour's analyze step used to point at #file-drop, which is now the
    camera-unavailable fallback and hidden on the happy path -- a tour step
    with an invisible target silently highlights nothing."""
    tour = read("static/tour.js")

    analyze_step = tour[tour.index('key: "analyze"'):]
    targets = re.search(r"targets: \[(.*?)\]", analyze_step, re.S)
    assert targets, "the analyze tour step has no targets"
    assert '"#an-shutter"' in targets.group(1)
    assert targets.group(1).index('"#an-shutter"') < targets.group(1).index('"#file-drop"'), (
        "the shutter must be tried before the upload fallback"
    )
    # And the copy must not still say "upload".
    i18n = read("static/i18n.js")
    body = re.search(r'"tour\.analyze\.body": "([^"]+)"', i18n)
    assert body and "upload" not in body.group(1).lower()
