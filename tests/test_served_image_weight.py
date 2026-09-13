"""Nothing under static/ should be a full-resolution master.

static/ is the directory a browser downloads from. A file there is sized for
the screen, not for archiving, and the difference is not subtle: the app used
to serve a 1254x1254 / 700KB PNG as its 16px favicon and a 1774x887 / 376KB
PNG as an 88x44 wordmark. 1,076KB of images delivering about 230px of actual
rendered width, on every cold load.

Both were masters that had simply been dropped into the served directory --
`static/logo-mark.png` was byte-identical to `RepCheck.png` at the repo root.
That is an easy mistake to repeat: you export a logo, you put it where the
templates can see it, and nothing complains.

So this file draws the line at the directory boundary. Masters live outside
static/ (the repo root, or native/ which .dockerignore excludes from the
production image); static/ carries the sized-for-the-browser copy.

Deliberately a WEIGHT cap rather than a dimension cap: the thing that hurts a
user is bytes over the wire, and a cap in KB keeps working if someone switches
a PNG to WebP or AVIF. The fonts are exempt -- they are binary by nature and
have their own rules in tests/test_font_cache_headers.py.
"""

import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

# Measured headroom, not an arbitrary round number. The heaviest legitimately
# served image today is static/logo-mark.png at 27.7KB (a 256px favicon, which
# also serves as the web-notification icon). 60KB leaves room to add a
# retina-scale illustration without editing this test, and still fails the
# hundreds-of-KB masters this exists to catch.
MAX_SERVED_IMAGE_KB = 60

# Rendered sizes are measured from the live app, so the intrinsic size a file
# needs is knowable rather than guessed. 3x covers the densest phone.
#   .auth-logo / .brand-logo / .ob-logo render logo-full.png at 88x44
#   the favicon renders logo-mark.png at 16-32px; 256 also covers the
#   web-notification icon in static/coaching.js
MAX_DIMENSION = {
    "logo-full.png": (264 * 2, 132 * 2),
    "logo-mark.png": (256 * 2, 256 * 2),
}


def _served_images():
    return [
        p for p in sorted(STATIC.rglob("*"))
        if p.is_file()
        and p.suffix.lower() in IMAGE_SUFFIXES
        and "fonts" not in p.relative_to(STATIC).parts
    ]


def test_no_served_image_is_master_sized():
    images = _served_images()

    # Guard the guard: an empty sweep would make the assertion below vacuous.
    assert len(images) > 100, (
        "the image sweep found only " + str(len(images)) + " files under "
        "static/ -- it has stopped working, or the icon packs moved"
    )

    heavy = [
        (p.relative_to(ROOT).as_posix(), round(p.stat().st_size / 1024, 1))
        for p in images
        if p.stat().st_size / 1024 > MAX_SERVED_IMAGE_KB
    ]

    assert heavy == [], (
        "these images under static/ are over " + str(MAX_SERVED_IMAGE_KB)
        + "KB: " + repr(heavy) + "\n"
        "static/ is what the browser downloads. Keep the master outside it "
        "(the repo root, or native/ which is excluded from the Docker image) "
        "and serve a copy sized for where it actually renders."
    )


@pytest.mark.parametrize("name", sorted(MAX_DIMENSION))
def test_the_logos_are_not_far_larger_than_they_render(name):
    """A file can be under the weight cap and still be pointlessly huge --
    a 4000px logo that happens to compress well is still decoded at full size
    in memory on every page. Pin the pixels too."""
    from PIL import Image

    path = STATIC / name
    assert path.is_file(), name + " is gone from static/"

    with Image.open(path) as im:
        w, h = im.size

    max_w, max_h = MAX_DIMENSION[name]

    assert w <= max_w and h <= max_h, (
        name + " is " + str(w) + "x" + str(h) + ", over the "
        + str(max_w) + "x" + str(max_h) + " ceiling for where it renders. "
        "If the design genuinely needs it bigger, raise the ceiling here "
        "deliberately -- do not drop the master in."
    )


def test_the_masters_still_exist_outside_static():
    """The point of shrinking the served copies is that the originals are
    kept somewhere else. If a master goes missing, the next person who needs
    a 1024px App Store icon has nothing to regenerate it from -- and
    codemagic.yaml's icon step names RepCheck.png specifically."""
    masters = {
        "RepCheck.png": "the 1254px mark; codemagic regenerates the iOS icon from it",
        "native/logo-full-master.png": "the full-resolution transparent wordmark",
    }

    missing = [
        name + " (" + why + ")"
        for name, why in masters.items()
        if not (ROOT / name).is_file()
    ]

    assert missing == [], (
        "these master files are gone: " + repr(missing) + "\n"
        "They are the originals the served copies in static/ were reduced "
        "from. Losing them means the reduction is irreversible."
    )


def test_the_icon_build_step_points_at_a_master_not_a_served_copy():
    """codemagic.yaml regenerates the 1024px App Store icon. It must name a
    master, not something under static/ -- which is now sized for a browser
    and far too small to scale an app icon up from."""
    codemagic = (ROOT / "codemagic.yaml").read_text(encoding="utf-8")

    icon_step = codemagic.split("Install the App Store icon", 1)
    assert len(icon_step) == 2, "the App Store icon step was renamed"
    body = icon_step[1][:2000]

    assert "RepCheck.png" in body, (
        "the icon step no longer names RepCheck.png as the source"
    )
    assert "generated from\n          # static/" not in body, (
        "the icon step points at a file under static/, which holds "
        "browser-sized copies -- point it at a master"
    )
