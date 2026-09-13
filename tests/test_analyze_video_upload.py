"""Uploading an existing clip has to be reachable while the camera works.

The analyze page has always been able to accept a video file -- POST /analyze
takes one, and there is an `<input type="file" accept="video/*">` in the
markup. But that input lived inside `#an-cam-fallback`, which is display:none
and, in its own words, "only ever shown when the viewfinder above cannot run".
`showCameraFallback()` is called from exactly two places: cameraUnsupported and
cameraDenied.

So the feature existed and was unreachable. If your camera worked you could
only record, and a lift you had already filmed -- on a tripod, on a gym camera,
by a training partner -- could not be analysed at all. The fix is an upload
button in the camera controls, which is why these tests are about REACHABILITY
rather than about the upload mechanism.

The camera-release assertion is the other half. Recording tore its own session
down before calling showReview(); the upload and drag-drop routes did not,
because until the button existed they only ever ran with no camera to release.
Left as it was, picking a file with the viewfinder live would hold the camera
open behind the review pane -- indicator light on, battery draining -- which is
the exact thing the page's visibilitychange handler exists to prevent.
"""

import re
from pathlib import Path

import pytest

import database
from app import app as flask_app

ROOT = Path(__file__).resolve().parent.parent
ANALYZE = ROOT / "templates" / "index.html"


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    flask_app.config["TESTING"] = True
    return database


@pytest.fixture
def page(db):
    """The analyze page as a signed-in user actually receives it.

    Rendered through the real template rather than read off disk, so a Jinja
    error or a block that stops emitting is a failure here rather than a blank
    area nobody notices.
    """
    user_id = database.create_local_user("analyze@example.com", "irrelevant", "Analyze")
    database.mark_onboarding_completed(user_id)
    client = flask_app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user_id
    response = client.get("/analyze")
    assert response.status_code == 200, "the analyze page did not render"
    return response.get_data(as_text=True)


# ---------- The control exists, and not in the fallback ----------

def test_the_upload_button_renders(page):
    assert 'id="an-cam-upload"' in page, (
        "the upload button is gone from the analyze page -- a user whose "
        "camera works can no longer analyse a clip they already have"
    )


def test_the_upload_button_is_in_the_camera_controls_not_the_fallback(page):
    """This is the whole point of the change.

    The file input has always existed inside #an-cam-fallback, which only
    appears when the camera CANNOT run. A button placed in there would be just
    as unreachable as the input was. It has to sit in the camera controls,
    which render before the fallback in the document.
    """
    upload_at = page.find('id="an-cam-upload"')
    fallback_at = page.find('id="an-cam-fallback"')

    assert upload_at != -1 and fallback_at != -1, "an expected element is missing"
    assert upload_at < fallback_at, (
        "the upload button is inside (or after) #an-cam-fallback, which is "
        "display:none unless the camera fails -- so it is unreachable for "
        "exactly the users this feature is for"
    )


def test_the_upload_button_is_labelled_for_assistive_tech(page):
    """It is an icon-only button, so the accessible name is the only name."""
    match = re.search(r'<button[^>]*id="an-cam-upload"[^>]*>', page)
    assert match, "could not find the upload button tag"
    tag = match.group(0)

    assert "aria-label=" in tag, "an icon-only button needs an aria-label"
    assert 'data-i18n-aria-label="analyze.uploadInstead"' in tag, (
        "the label must come from i18n, or it stays English in Thai"
    )


def test_the_label_is_translated_in_both_dictionaries():
    """t() falls back to the raw key, which would put 'analyze.uploadInstead'
    on screen as a literal accessible name."""
    i18n = (ROOT / "static" / "i18n.js").read_text(encoding="utf-8")

    assert i18n.count('"analyze.uploadInstead"') >= 2, (
        "analyze.uploadInstead is missing from one of the two dictionaries"
    )


# ---------- It is wired to the input that already exists ----------

def test_the_button_opens_the_existing_file_input(page):
    """Deliberately the SAME input the dropzone uses. A second input would
    mean two sources of truth for selectedVideo(), which returns
    `recordedFile || videoInput.files[0]` -- a file in the wrong one would
    silently never be submitted."""
    assert re.search(
        r"camUploadBtn\.addEventListener\(\s*[\"']click[\"'][^)]*\)\s*=>\s*\{[^}]*videoInput\.click\(\)",
        page,
        re.S,
    ), "the upload button is not wired to videoInput.click()"

    inputs = re.findall(r'<input[^>]*type="file"[^>]*>', page)
    video_inputs = [i for i in inputs if "video/" in i]

    assert len(video_inputs) == 1, (
        "expected exactly one video file input, found " + str(len(video_inputs))
        + ": " + repr(video_inputs) + ". Two inputs means selectedVideo() can "
        "read the empty one."
    )


def test_the_file_input_still_accepts_video(page):
    match = re.search(r'<input[^>]*id="video"[^>]*>', page)
    assert match, "the video file input is gone"
    assert 'accept="video/*"' in match.group(0)


# ---------- Picking a file must not leave the camera running ----------

def test_every_route_into_review_releases_the_camera():
    """showReview() is the one place all three routes converge (recording,
    the upload button, drag-drop), so the release belongs there rather than
    at each call site.

    Source-level because the camera block cannot run in jsdom -- it needs
    getUserMedia, MediaRecorder and a live stream. The property is still worth
    pinning: without it, picking a file with the viewfinder live holds the
    camera open behind the review pane.
    """
    source = ANALYZE.read_text(encoding="utf-8")

    body = re.search(
        r"function showReview\(file\)\s*\{(.*?)\n  \}", source, re.S
    )
    assert body, "could not find showReview() -- it was renamed or restructured"

    stripped = re.sub(r"//.*$", "", body.group(1), flags=re.MULTILINE)

    assert "closeCamera()" in stripped, (
        "showReview() no longer releases the camera. Recording tears its own "
        "session down, but the upload and drag-drop routes do not -- so "
        "picking a file while the viewfinder is live leaves the stream open "
        "behind the review pane, with the indicator light on."
    )


def test_showreview_releases_the_camera_before_it_takes_the_file():
    """Ordering matters: closeCamera() resets shutter state and clears the
    preview, so it must not run after recordedFile is set and the review view
    is on screen, where it would be tearing down around a live UI."""
    source = ANALYZE.read_text(encoding="utf-8")
    body = re.search(r"function showReview\(file\)\s*\{(.*?)\n  \}", source, re.S).group(1)
    stripped = re.sub(r"//.*$", "", body, flags=re.MULTILINE)

    assert stripped.index("closeCamera()") < stripped.index("recordedFile = file"), (
        "closeCamera() must run before showReview() adopts the file"
    )


# ---------- The iOS permission string has to cover what we now ask for ----------

def test_the_photo_library_permission_mentions_video():
    """Picking an existing clip reads the photo library, and iOS shows
    NSPhotoLibraryUsageDescription when it does. That string used to talk only
    about meal photos, which is a permission prompt whose stated reason does
    not match what the app is doing -- and App Review reads these.
    """
    codemagic = (ROOT / "codemagic.yaml").read_text(encoding="utf-8")

    strings = re.findall(
        r"NSPhotoLibraryUsageDescription (?:string )?'([^']+)'", codemagic
    )
    assert strings, "NSPhotoLibraryUsageDescription is not set in codemagic.yaml"

    # PlistBuddy needs a Set and an Add branch; both must say the same thing.
    assert len(set(strings)) == 1, (
        "the Set and Add branches disagree: " + repr(set(strings))
    )

    assert "video" in strings[0].lower(), (
        "the photo-library reason says " + repr(strings[0]) + ", which does "
        "not mention video -- but the analyze page now picks videos from the "
        "library"
    )
