"""Trim a video with ffmpeg: skip the first 5 seconds, keep the next 75.

Usage:
    python trim_video.py <input_video> [output_video]

    output_video defaults to "<input_stem>_trimmed<input_suffix>" next to
    the input file if not given.

Example:
    python trim_video.py IMG_5896.MOV
    python trim_video.py IMG_5896.MOV clips/bicep_curl_trimmed.mp4

Requires:
    ffmpeg installed and available on PATH
    (https://ffmpeg.org/download.html)
"""

import glob
import os
import shutil
import subprocess
import sys
from pathlib import Path

START_SECONDS = 5
# Caps how much footage is graded. Set to cover a whole working set rather
# than the first part of one: the rep count is read straight off the clip,
# so anything trimmed away is simply never counted, and a lifter doing a
# long set would watch their rep total drop for no reason they can see.
# 60s costs roughly double the video tokens of 30s but only ~4s more wall
# clock (measured 21.5s vs 17.4s mean), so the coverage is nearly free in
# latency terms -- see ANALYSIS_BUDGET_SECONDS for the ceiling that still
# bounds it.
DURATION_SECONDS = 60
# Below this, there isn't enough footage to judge a set -- grading it would
# mean inventing a score from almost nothing (see trim_video()).
MIN_USABLE_SECONDS = 3
# Tool-free sanity floor, used ONLY when ffprobe can't measure a duration.
# A frameless/header-only container runs ~1-2KB (measured), so this sits
# just above that -- low enough that a real but small/low-bitrate clip is
# never wrongly rejected, since a false reject blocks a legitimate upload.
MIN_USABLE_BYTES = 5_000

# Extra places to look for ffmpeg.exe if it's not resolvable via PATH yet
# (e.g. it was just installed and this process's PATH hasn't refreshed).
_FALLBACK_GLOBS = [
    os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_*\ffmpeg-*\bin\ffmpeg.exe"),
    r"C:\ffmpeg\bin\ffmpeg.exe",
    r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
    os.path.expandvars(r"%USERPROFILE%\scoop\shims\ffmpeg.exe"),
]


def find_ffmpeg():
    on_path = shutil.which("ffmpeg")
    if on_path:
        return on_path

    for pattern in _FALLBACK_GLOBS:
        matches = glob.glob(pattern)
        if matches:
            return matches[0]

    return None


def trim_video(input_path, output_path):
    ffmpeg_path = find_ffmpeg()
    if not ffmpeg_path:
        sys.exit("ffmpeg not found on PATH. Install it from https://ffmpeg.org/download.html")

    if not Path(input_path).exists():
        sys.exit(f"Input video not found: {input_path}")

    # Only skip the lead-in if doing so actually leaves a usable clip.
    # Skipping unconditionally silently destroys short uploads: ffmpeg
    # given `-ss 5` on a 3-second source writes a valid-but-FRAMELESS
    # container and still exits 0, so nothing downstream noticed and the
    # analysis ran against no video at all -- which is exactly how a
    # bad-form set could come back with a confident, invented score.
    source_duration = get_video_duration(input_path)
    start_seconds = START_SECONDS
    if source_duration is not None and source_duration < START_SECONDS + MIN_USABLE_SECONDS:
        start_seconds = 0

    cmd = [
        ffmpeg_path,
        "-y",  # overwrite output without prompting
        "-ss", str(start_seconds),
        "-i", str(input_path),
        "-t", str(DURATION_SECONDS),
        "-c", "copy",
        str(output_path),
    ]

    print(f"Trimming {input_path} -> {output_path} "
          f"(skip first {start_seconds}s, keep {DURATION_SECONDS}s)")

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"ffmpeg failed:\n{result.stderr}")

    # ffmpeg's exit code alone is not proof the clip is usable (see above),
    # so verify the output independently before anything grades it.
    if not Path(output_path).exists():
        sys.exit("Couldn't process that video. Please try uploading it again.")

    trimmed_duration = get_video_duration(output_path)
    if trimmed_duration is None:
        # ffprobe couldn't measure it (missing, or the file is unreadable).
        # Fall back to a tool-free size floor so a corrupt/frameless output
        # can't slip past unchecked -- without it, an unmeasurable clip
        # skipped this guard entirely and got graded as a full-length lift.
        # Deliberately low: it should only catch header-only containers
        # (~1-2KB), never a real, legitimately short set.
        if Path(output_path).stat().st_size < MIN_USABLE_BYTES:
            sys.exit("Couldn't read that video. Please upload a clear clip of your full set.")
    elif trimmed_duration < MIN_USABLE_SECONDS:
        sys.exit(
            "That clip is too short to analyze. Please upload a video of at "
            f"least {MIN_USABLE_SECONDS:g} seconds showing your full set."
        )

    print(f"Done: {output_path}")


def get_video_duration(path):
    """Returns a clip's duration in seconds via ffprobe, or None if ffprobe
    can't be found/run. ffprobe ships alongside ffmpeg in every distribution
    this app's find_ffmpeg() already looks for, so it's expected to sit
    right next to whatever ffmpeg.exe find_ffmpeg() found.

    Used by the analysis pipeline to tell Gemini the real trimmed-clip
    length -- trim_video() targets DURATION_SECONDS, but a short source
    upload produces a shorter trimmed clip than that, and the analysis
    prompt should state the actual length, not the target."""
    ffmpeg_path = find_ffmpeg()
    ffprobe_path = None
    if ffmpeg_path:
        candidate = Path(ffmpeg_path).with_name("ffprobe" + Path(ffmpeg_path).suffix)
        if candidate.exists():
            ffprobe_path = str(candidate)
    if not ffprobe_path:
        ffprobe_path = shutil.which("ffprobe")
    if not ffprobe_path:
        return None

    result = subprocess.run(
        [ffprobe_path, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    try:
        return round(float(result.stdout.strip()), 1)
    except (ValueError, TypeError):
        return _duration_from_packets(ffprobe_path, path)


def _duration_from_packets(ffprobe_path, path):
    """Duration read off the video stream's packet timestamps, or None.

    MediaRecorder -- the in-app recorder in static/video_recorder.js -- writes
    a *streaming* container, so a recorded clip carries no duration in its
    header at all and `format=duration` above comes back "N/A". That mattered
    twice over: trim_video() skips its 5-second lead-in unless it can see the
    source is too short for that, and run_pipeline() tells Gemini the clip is
    a full DURATION_SECONDS long when nothing could measure it -- both of
    which quietly mis-handle a perfectly good recording.

    Walking the packet index is slower than reading a header, but it decodes
    nothing and it works on exactly the files the header can't describe.
    """
    result = subprocess.run(
        [ffprobe_path, "-v", "error", "-select_streams", "v:0",
         "-show_entries", "packet=pts_time", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    latest = None
    for line in result.stdout.splitlines():
        try:
            pts = float(line.strip().rstrip(","))
        except ValueError:
            continue  # "N/A" for a packet with no timestamp -- skip, don't fail
        if latest is None or pts > latest:
            latest = pts
    return None if latest is None else round(latest, 1)


def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: python trim_video.py <input_video> [output_video]")

    input_path = Path(sys.argv[1])

    if len(sys.argv) >= 3:
        output_path = Path(sys.argv[2])
    else:
        output_path = input_path.with_name(f"{input_path.stem}_trimmed{input_path.suffix}")

    trim_video(input_path, output_path)


if __name__ == "__main__":
    main()
