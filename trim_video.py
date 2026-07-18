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
DURATION_SECONDS = 75

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

    cmd = [
        ffmpeg_path,
        "-y",  # overwrite output without prompting
        "-ss", str(START_SECONDS),
        "-i", str(input_path),
        "-t", str(DURATION_SECONDS),
        "-c", "copy",
        str(output_path),
    ]

    print(f"Trimming {input_path} -> {output_path} "
          f"(skip first {START_SECONDS}s, keep {DURATION_SECONDS}s)")

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"ffmpeg failed:\n{result.stderr}")

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
        return None


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
