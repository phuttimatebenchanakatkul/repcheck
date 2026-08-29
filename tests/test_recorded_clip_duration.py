"""Measuring the length of a clip the in-app recorder produced.

MediaRecorder (static/video_recorder.js) writes a *streaming* container: the
header carries no duration at all, so `ffprobe -show_entries format=duration`
answers "N/A" for every clip recorded in the app. That mattered twice over,
and both failures were silent:

  - trim_video() skips a 5-second lead-in unless it can see the source is too
    short for that, so an unmeasurable 6-second set lost most of itself.
  - run_pipeline() tells Gemini the clip is a full DURATION_SECONDS long when
    nothing could measure it -- asking the model to grade 60 seconds of a set
    that lasted 8.

_duration_from_packets() walks the video stream's packet timestamps instead,
which needs no header and decodes nothing. These tests drive it through
get_video_duration()'s real fallback path with ffprobe stubbed, since the
whole point is what happens when the header has no answer.
"""

import subprocess

import pytest

import trim_video


class _FakeCompleted:
    def __init__(self, stdout):
        self.stdout = stdout
        self.returncode = 0


@pytest.fixture
def ffprobe(monkeypatch):
    """Stub ffprobe. Yields a dict the test fills in with the two answers:
    `format` (what the header query returns) and `packets` (what the packet
    walk returns), so each test states only what it cares about."""
    answers = {"format": "", "packets": ""}
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        wants_packets = any("packet=pts_time" in str(part) for part in cmd)
        return _FakeCompleted(answers["packets"] if wants_packets else answers["format"])

    # No ffmpeg on PATH in CI, so route resolution through shutil.which and
    # answer that instead of depending on a real install.
    monkeypatch.setattr(trim_video, "find_ffmpeg", lambda: None)
    monkeypatch.setattr(trim_video.shutil, "which", lambda name: "ffprobe")
    monkeypatch.setattr(subprocess, "run", fake_run)
    answers["calls"] = calls
    return answers


def test_a_container_with_a_duration_is_read_straight_from_the_header(ffprobe):
    """An ordinary upload still costs one cheap ffprobe call, not a packet
    walk -- the fallback must not become the default path."""
    ffprobe["format"] = "42.37\n"

    assert trim_video.get_video_duration("upload.mp4") == 42.4
    assert len(ffprobe["calls"]) == 1


def test_a_recorded_clip_falls_back_to_its_packet_timestamps(ffprobe):
    """This is the in-app recording case: header says N/A, so the length has
    to come from the last packet's timestamp."""
    ffprobe["format"] = "N/A\n"
    ffprobe["packets"] = "0.000000,\n3.400000,\n7.960000,\n"

    assert trim_video.get_video_duration("recording.webm") == 8.0
    assert len(ffprobe["calls"]) == 2


def test_packets_arriving_out_of_order_still_give_the_real_length(ffprobe):
    """Packet order is decode order, not presentation order -- B-frames put a
    later pts_time before an earlier one, so the last line is not necessarily
    the largest."""
    ffprobe["format"] = "N/A\n"
    ffprobe["packets"] = "0.000000,\n9.500000,\n8.000000,\n"

    assert trim_video.get_video_duration("recording.webm") == 9.5


def test_timestampless_packets_are_skipped_not_fatal(ffprobe):
    """ffprobe prints N/A for a packet with no timestamp. One of those must
    not throw away the measurement the other packets can still give."""
    ffprobe["format"] = "N/A\n"
    ffprobe["packets"] = "N/A\n0.000000,\nN/A\n5.250000,\n"

    assert trim_video.get_video_duration("recording.webm") == 5.2


def test_a_clip_with_no_readable_timestamps_measures_as_unknown(ffprobe):
    """None, not 0.0. run_pipeline() branches on `is None` precisely because a
    0.0-second clip is falsy and was once reported to Gemini as a full-length
    lift -- an unmeasurable clip must stay unmeasurable, not become empty."""
    ffprobe["format"] = "N/A\n"
    ffprobe["packets"] = ""

    assert trim_video.get_video_duration("broken.webm") is None


def test_no_ffprobe_at_all_measures_as_unknown(monkeypatch):
    """Same contract as before this change: without the tool there is no
    measurement, and callers fall back rather than fail."""
    monkeypatch.setattr(trim_video, "find_ffmpeg", lambda: None)
    monkeypatch.setattr(trim_video.shutil, "which", lambda name: None)

    assert trim_video.get_video_duration("recording.webm") is None
