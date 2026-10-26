"""The API's own container (Dockerfile.api) and dependency file: the deploy contract, checked without Docker.
The website's image and requirements.txt must not change when the API does (a merge to main deploys the website)."""

import ast
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
DOCKERFILE = (ROOT / "Dockerfile.api").read_text(encoding="utf-8")
WEBSITE_DOCKERFILE = (ROOT / "Dockerfile").read_text(encoding="utf-8")


def requirement_names(filename, seen=None):
    """Distribution names (lower-case, `_`->`-`) a requirements file pulls in, following `-r` includes."""
    seen = seen if seen is not None else set()
    for line in (ROOT / filename).read_text(encoding="utf-8").splitlines():
        line = line.split("#")[0].strip()
        if line.startswith("-r "):
            requirement_names(line[3:].strip(), seen)
        elif line:
            seen.add(re.split(r"[\[=<>~ ]", line, maxsplit=1)[0].lower().replace("_", "-"))
    return seen


# import name -> the distribution that provides it
DISTRIBUTION = {"flask": "flask", "werkzeug": "werkzeug", "jwt": "pyjwt", "psycopg": "psycopg", "psycopg_pool": "psycopg-pool",
                "requests": "requests", "PIL": "pillow", "markdown": "markdown"}


def third_party_imports():
    website_modules = {p.stem for p in ROOT.glob("*.py")}
    found = {}
    for path in (ROOT / "api").rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            names = [a.name for a in node.names] if isinstance(node, ast.Import) else \
                [node.module] if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module else []
            for name in names:
                top = name.split(".")[0]
                if top not in sys.stdlib_module_names and top not in website_modules and top != "api":
                    found.setdefault(top, path.name)
    return found


def test_every_third_party_module_the_api_imports_is_in_requirements_api():
    have = requirement_names("requirements-api.txt")
    for module, where in sorted(third_party_imports().items()):
        assert module in DISTRIBUTION, f"{where} imports {module!r}: add it to DISTRIBUTION here and to requirements-api.txt"
        assert DISTRIBUTION[module] in have, f"{where} imports {module!r} but requirements-api.txt does not install {DISTRIBUTION[module]}"


def test_the_apis_requirements_extend_the_websites_and_pin_exactly():
    assert "flask" in requirement_names("requirements-api.txt") and requirement_names("requirements.txt") <= requirement_names("requirements-api.txt")
    for line in (ROOT / "requirements-api.txt").read_text(encoding="utf-8").splitlines():
        line = line.split("#")[0].strip()
        if line and not line.startswith("-r "):
            assert "==" in line, f"{line!r} is not pinned exactly"


def test_the_api_image_installs_the_api_requirements_and_the_system_tools_the_reused_modules_shell_out_to():
    assert re.search(r"pip install[^\n]*-r requirements-api\.txt", DOCKERFILE)
    assert "COPY requirements.txt requirements-api.txt" in DOCKERFILE
    apt = re.search(r"apt-get install[^\n]*\\\n((?:\s+\S+ \\\n)+)", DOCKERFILE).group(0)
    assert "ffmpeg" in apt and "libzbar0" in apt, "video trimming needs ffmpeg and the barcode decoder needs zbar"


def command(dockerfile):
    return re.search(r"^CMD (.+)$", dockerfile, re.M).group(1)


def test_the_api_image_runs_the_app_factory_on_the_port_render_hands_it():
    cmd = command(DOCKERFILE)
    assert '"api.app:create_app()"' in cmd and "--bind 0.0.0.0:$PORT" in cmd


def test_grading_happens_inside_the_request_so_the_worker_timeout_is_far_above_gunicorns_default():
    assert int(re.search(r"--timeout (\d+)", command(DOCKERFILE)).group(1)) >= 300


def test_the_worker_count_matches_the_proxy_and_memory_assumptions():
    cmd = command(DOCKERFILE)
    assert "--workers 1" in cmd and int(re.search(r"--threads (\d+)", cmd).group(1)) >= 4


def test_the_websites_image_and_requirements_are_untouched_by_the_api():
    assert "requirements-api" not in WEBSITE_DOCKERFILE and "api.app" not in WEBSITE_DOCKERFILE
    assert "psycopg" not in (ROOT / "requirements.txt").read_text(encoding="utf-8")


@pytest.mark.parametrize("excluded", [".env", "tests/", "node_modules/", "repcheck.db", ".git/"])
def test_the_build_context_keeps_secrets_and_bulk_out_of_both_images(excluded):
    assert excluded in (ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()


def test_the_api_image_does_not_set_any_secret():
    assert not re.search(r"^(ENV|ARG)\s+\w*(KEY|SECRET|PASSWORD|TOKEN|DB_URL)\w*", DOCKERFILE, re.M | re.I)
