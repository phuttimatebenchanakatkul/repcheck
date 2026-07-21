"""Trims a video down to the first 25 seconds with ffmpeg — nothing else.

This is the dedicated trim step for the friends-challenge leaderboard
("as many reps as possible in 25 seconds"): whatever length clip a user
records or uploads, only the first 25 seconds are ever scored. Kept as
its own file with a single job (no Gemini calls, no rep-counting logic)
so the "cut the video" step and the "analyze the video" step are
genuinely separate, independently testable pieces — see
rep_form_analyzer.py, which imports trim_first_25_seconds() from here
and does the actual analysis on the file this produces.

Usage:
    python video_trimmer.py <input_video> [output_video]

Requires:
    ffmpeg installed and on PATH
"""

import subprocess
import sys
from pathlib import Path

from trim_video import find_ffmpeg

CHALLENGE_SECONDS = 25


class RepCountError(Exception):
    """Raised for any failure the web app should show to the user —
    defined here (not in rep_form_analyzer.py) since trimming is the
    first place in the pipeline that can fail (missing ffmpeg, bad
    input file), and the analyzer re-raises the same type for its own
    failures so callers only need to catch one exception class."""


def trim_first_25_seconds(input_path, output_path):
    """Keep only the first CHALLENGE_SECONDS of the clip, re-encoded small.

    Re-encoding (rather than `-c copy`) is deliberate: it guarantees a
    keyframe at t=0 for an exact cut, and shrinks the clip (480p, 15fps,
    no audio) so it's small enough to send to Gemini inline while still
    keeping enough real frames for accurate rep counting — a push-up/
    sit-up cadence of roughly one rep every 1-2.5 seconds needs
    noticeably more than a couple of frames per rep or the analysis step
    has nothing to actually see at the top/bottom of the movement.
    """
    ffmpeg_path = find_ffmpeg()
    if not ffmpeg_path:
        raise RepCountError("ffmpeg not found on PATH.")

    input_path = Path(input_path)
    if not input_path.exists():
        raise RepCountError(f"Video not found: {input_path}")

    cmd = [
        ffmpeg_path,
        "-y",
        "-i", str(input_path),
        "-t", str(CHALLENGE_SECONDS),
        "-vf", "scale=-2:480",
        "-r", "15",
        "-an",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "24",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        # Raw ffmpeg stderr is internal/developer jargon (codec build flags,
        # container-parsing internals) that a user can't act on -- log it
        # for debugging but never surface it in the app. In practice this
        # almost always means the recording was stopped before the
        # recorder produced a valid file (e.g. stopped within a second of
        # starting), so a plain, actionable message is far more useful here
        # than the stack of ffmpeg internals.
        print(f"ffmpeg failed to trim {input_path}:\n{result.stderr[-800:]}", file=sys.stderr)
        raise RepCountError(
            "That recording couldn't be processed — it may have been too short. "
            "Please record for at least a few seconds and try again."
        )


def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: python video_trimmer.py <input_video> [output_video]")
    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2]) if len(sys.argv) >= 3 else input_path.with_name(f"{input_path.stem}_25s.mp4")
    trim_first_25_seconds(input_path, output_path)
    print(f"Done: {output_path}")


if __name__ == "__main__":
    main()
