"""Pins the Info.plist keys the Capacitor Camera plugin will not work without.

App Review rejected 0.10.2 (build 34) under 2.1(a) on 2026-09-15: on their
iPad, "Take photo" did nothing. Build 34's own App.ipa (pulled from Codemagic
and read, not assumed) has NSCameraUsageDescription and
NSPhotoLibraryUsageDescription but NOT NSPhotoLibraryAddUsageDescription --
and the Camera plugin's getPhoto() checks for all three of its
CameraPropertyListKeys before showing any UI, rejecting every call when one
is missing ("You are missing NSPhotoLibraryAddUsageDescription in your
Info.plist file"). static/native.js reads that as a failure and resolves
null, so the button simply did nothing. Neither of Capacitor 8's iOS
templates ships any usage string, so codemagic.yaml is the only place these
can come from.

Two layers, both here:
  - codemagic.yaml sets the key (source-level, like
    tests/test_ios_scroll_indicators_hidden.py -- ios/ is regenerated every
    build and only exists on the Mac runner).
  - the build's own verification step, extracted from codemagic.yaml and RUN
    against a real plist, fails on a missing key and passes on a full one.
"""

import plistlib
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
YAML = (ROOT / "codemagic.yaml").read_text(encoding="utf-8")

REQUIRED = [
    "NSCameraUsageDescription",
    "NSPhotoLibraryUsageDescription",
    "NSPhotoLibraryAddUsageDescription",
]


def _verify_script():
    step = YAML.find("- name: Verify every usage string the plugins require")
    assert step != -1, "codemagic.yaml lost its usage-string verification step"
    match = re.search(r"python3 - <<'PYEOF'\n(.*?)\n\s*PYEOF\n", YAML[step:], re.S)
    assert match, "could not extract the verification script from codemagic.yaml"
    lines = match.group(1).splitlines()
    indent = min(len(l) - len(l.lstrip()) for l in lines if l.strip())
    return "\n".join(l[indent:] for l in lines)


@pytest.mark.parametrize("key", REQUIRED)
def test_codemagic_sets_every_key_the_camera_plugin_requires(key):
    assert re.search(rf"PlistBuddy -c \"Add :{key} string '[^']+'\"", YAML), (
        f"codemagic.yaml never adds {key}; the Camera plugin rejects every call without it"
    )


def test_the_keys_are_verified_after_they_are_set():
    set_at = YAML.find("- name: Set the Info.plist usage strings")
    verify_at = YAML.find("- name: Verify every usage string the plugins require")
    assert set_at != -1 and verify_at != -1
    assert set_at < verify_at, "the verification must run after the keys are written"


def _run_verify(tmp_path, plist_keys):
    plugin_dir = tmp_path / "node_modules/@capacitor/camera/ios/Sources/CameraPlugin"
    plugin_dir.mkdir(parents=True)
    real = ROOT / "node_modules/@capacitor/camera/ios/Sources/CameraPlugin/CameraTypes.swift"
    if real.exists():
        (plugin_dir / "CameraTypes.swift").write_text(real.read_text(encoding="utf-8"), encoding="utf-8")
    else:
        # The shape of @capacitor/camera 8.x's enum, for checkouts without
        # node_modules.
        (plugin_dir / "CameraTypes.swift").write_text(
            "internal enum CameraPropertyListKeys: String, CaseIterable {\n"
            + "".join(f'    case k{i} = "{k}"\n' for i, k in enumerate(REQUIRED))
            + "\n    var link: String { return \"\" }\n}\n",
            encoding="utf-8",
        )
    plist_dir = tmp_path / "ios/App/App"
    plist_dir.mkdir(parents=True)
    with open(plist_dir / "Info.plist", "wb") as f:
        plistlib.dump({k: "why" for k in plist_keys}, f)
    return subprocess.run(
        [sys.executable, "-c", _verify_script()], cwd=tmp_path, capture_output=True, text=True
    )


def test_the_build_fails_on_build_34s_plist(tmp_path):
    result = _run_verify(tmp_path, ["NSCameraUsageDescription", "NSPhotoLibraryUsageDescription"])
    assert result.returncode != 0
    assert "NSPhotoLibraryAddUsageDescription" in (result.stdout + result.stderr)


def test_the_build_passes_with_every_key(tmp_path):
    result = _run_verify(tmp_path, REQUIRED)
    assert result.returncode == 0, result.stdout + result.stderr
