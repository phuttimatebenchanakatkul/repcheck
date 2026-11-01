"""Generate mobile/src/legal/pages.generated.json: the website's policy pages as data the native app draws itself.

The Terms, Privacy, Sources, Support, Cookie and Refund pages are rendered by the website (templates/*.html). The app is moving off Render, so
it carries its own copy and shows it in screens instead of opening the website. This renders each page with the website's own app (so the
numbers it quotes, such as the 30-day deletion grace and the cookie lifetime, are the live ones) and turns the policy block into a small tree:

    {"type": "updated" | "h" | "p" | "ul", ...}   runs: {"t": text, "b": bold, "i": italic, "c": code, "link": {...}}

A link is {"page": "privacy", "section": "ai"} for another page of this set, or {"href": "https://..."} / {"href": "mailto:..."} for the outside.
Anything else (a link into the website's signed-in pages, an unknown tag) stops the generation instead of shipping something half right.

    python scripts/gen_mobile_legal.py            # rewrite the file
    python scripts/gen_mobile_legal.py --check    # exit 1 if it is stale (a test runs this)

This is a bridge: it exists while the website still renders these pages. When the website is retired the generated file becomes the source and
is edited by hand (delete this script and its test then).
"""

import json
import os
import re
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

TARGET = ROOT / "mobile" / "src" / "legal" / "pages.generated.json"
PAGES = {"privacy": "/privacy", "terms": "/terms", "support": "/support", "cookies": "/cookies", "refunds": "/refunds", "sources": "/sources"}
BY_PATH = {path: key for key, path in PAGES.items()}


class Collector(HTMLParser):
    """Walks the page, keeps the contents of the element with class `policy-page`, and builds blocks."""

    BLOCK_TAGS = {"p", "h2", "h3", "li"}

    def __init__(self, page):
        super().__init__(convert_charrefs=True)
        self.page = page
        self.depth = 0          # inside the policy element: nesting depth of its descendants (0 = outside)
        self.blocks = []
        self.runs = None        # the runs of the block being read
        self.kind = None
        self.block_id = None
        self.list_items = None
        self.styles = {"b": 0, "i": 0, "c": 0}
        self.link = None
        self.note = None        # text of a <span> inside a list item (a source's publisher)
        self.class_stack = []

    # -- structure ------------------------------------------------------------------------------------------------------------
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = (attrs.get("class") or "").split()
        if self.depth == 0:
            if tag == "div" and "policy-page" in classes:
                self.depth = 1
            return
        if tag not in {"br", "meta", "link"}:
            self.depth += 1
        if tag == "p":
            self.begin("updated" if "policy-updated" in classes else "p", attrs)
        elif tag in ("h2", "h3"):
            self.begin("h", attrs)
        elif tag in ("ul", "ol"):
            self.list_items = []
        elif tag == "li":
            self.begin("li", attrs)
        elif tag in ("strong", "b"):
            self.styles["b"] += 1
        elif tag in ("em", "i"):
            self.styles["i"] += 1
        elif tag == "code":
            self.styles["c"] += 1
        elif tag == "a":
            self.link = self.resolve(attrs.get("href") or "")
        elif tag == "span" and self.kind == "li":
            self.note = []
        elif tag == "br":
            self.add(" ")
        elif tag not in ("div", "section"):
            raise SystemExit(f"{self.page}: unhandled tag <{tag}>")

    def handle_endtag(self, tag):
        if self.depth == 0:
            return
        if tag not in {"br", "meta", "link"}:
            self.depth -= 1
        if tag in ("p", "h2", "h3"):
            self.end()
        elif tag == "li":
            self.end()
        elif tag in ("ul", "ol"):
            self.blocks.append({"type": "ul", "items": self.list_items})
            self.list_items = None
        elif tag in ("strong", "b"):
            self.styles["b"] -= 1
        elif tag in ("em", "i"):
            self.styles["i"] -= 1
        elif tag == "code":
            self.styles["c"] -= 1
        elif tag == "a":
            self.link = None
        elif tag == "span" and self.note is not None:
            text = re.sub(r"\s+", " ", "".join(self.note)).strip()
            self.item_note = text
            self.note = None

    def handle_data(self, data):
        if self.depth == 0:
            return
        if self.note is not None:
            self.note.append(data)
        elif self.runs is not None:
            self.add(data)
        elif data.strip():
            raise SystemExit(f"{self.page}: text outside a block: {data.strip()[:60]!r}")

    # -- blocks and runs ------------------------------------------------------------------------------------------------------
    def begin(self, kind, attrs):
        self.kind = kind
        self.runs = []
        self.block_id = attrs.get("id")
        self.item_note = None

    def add(self, text):
        if self.runs is None:
            return
        run = {"t": text}
        if self.styles["b"]:
            run["b"] = True
        if self.styles["i"]:
            run["i"] = True
        if self.styles["c"]:
            run["c"] = True
        if self.link:
            run["link"] = self.link
        self.runs.append(run)

    def end(self):
        runs = tidy(self.runs or [])
        kind, block_id, note = self.kind, self.block_id, self.item_note
        self.runs, self.kind, self.block_id, self.item_note = None, None, None, None
        if not runs:
            return
        if kind == "li":
            item = {"runs": runs}
            if note:
                item["note"] = note
            if block_id:
                item["id"] = block_id
            self.list_items.append(item)
            return
        block = {"type": kind, "runs": runs}
        if block_id:
            block["id"] = block_id
        self.blocks.append(block)

    def resolve(self, href):
        if href.startswith(("http://", "https://", "mailto:")):
            return {"href": href}
        path, _, fragment = href.partition("#")
        if path == "" and fragment:
            link = {"page": self.page, "section": fragment}
        elif path in BY_PATH:
            link = {"page": BY_PATH[path]}
            if fragment:
                link["section"] = fragment
        else:
            raise SystemExit(f"{self.page}: a link the app has no screen for: {href!r}")
        return link


def tidy(runs):
    """Collapse whitespace across runs, trim the block's ends, and merge neighbours that look the same."""
    out = []
    for run in runs:
        text = re.sub(r"\s+", " ", run["t"])
        if not text:
            continue
        run = {**run, "t": text}
        if out and out[-1].get("b") == run.get("b") and out[-1].get("i") == run.get("i") and out[-1].get("c") == run.get("c") and out[-1].get("link") == run.get("link"):
            out[-1]["t"] += text
        else:
            out.append(run)
    # a space at the very start or end of the block means nothing; between two runs it must stay
    while out and out[0]["t"].strip() == "":
        out.pop(0)
    while out and out[-1]["t"].strip() == "":
        out.pop()
    if out:
        out[0]["t"] = out[0]["t"].lstrip()
        out[-1]["t"] = out[-1]["t"].rstrip()
    return [r for r in out if r["t"]]


def website_client():
    """The website's own Flask app, with a throwaway database, set the way production is for the values these pages quote."""
    os.environ.setdefault("RENDER", "1")           # SESSION_COOKIE_SECURE is "on Render", and /cookies says so
    os.environ.setdefault("FLASK_SECRET_KEY", "renders-the-policy-pages-and-signs-nothing")   # production insists on one; no session is made here
    import app as website
    import database
    database.DB_PATH = Path(tempfile.mkdtemp(prefix="rc-legal-")) / "legal.db"
    database.init_db()
    website.app.config["TESTING"] = False
    return website.app.test_client()


def render():
    client = website_client()
    pages = {}
    for key, path in PAGES.items():
        response = client.get(path)
        if response.status_code != 200:
            raise SystemExit(f"{path} answered {response.status_code}")
        collector = Collector(key)
        collector.feed(response.get_data(as_text=True))
        if not collector.blocks:
            raise SystemExit(f"{path}: no policy block found")
        pages[key] = {"blocks": collector.blocks}
    return json.dumps({"pages": pages}, ensure_ascii=False, indent=1, sort_keys=True) + "\n"


if __name__ == "__main__":
    text = render()
    if "--check" in sys.argv:
        current = TARGET.read_text(encoding="utf-8").replace("\r\n", "\n") if TARGET.exists() else ""
        sys.exit(0 if current == text else 1)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {TARGET.relative_to(ROOT)} ({len(text) // 1024} KB)")
