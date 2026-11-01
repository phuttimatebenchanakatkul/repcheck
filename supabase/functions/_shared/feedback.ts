/** Turn the model's "## Heading" markdown into the sections a result screen shows: `api/feedback.py` on the Edge runtime.
 *
 * Like the Python, no `icon` field (the app draws its own from `css_class`). The markdown itself is `pyMarkdown.ts`.
 */
import { PY_CLASSES } from "./analyzeForm.ts";
import { pyStrip } from "./nameFilter.ts";
import { renderMarkdown } from "./pyMarkdown.ts";

export const SECTION_STYLES: Readonly<Record<string, string>> = {
  "movement summary": "summary",
  "positives": "positives",
  "negatives": "negatives",
  "improvements": "improvements",
  "injury prevention": "injury",
  "how to progress": "progress",
};

export interface Section {
  heading: string;
  css_class: string;
  emphasis: "featured" | "muted";
  title_key: string;
  summary_html: string;
  detail_html: string | null;
}

/** The first bullet as a paragraph that is always shown, every other bullet as a list revealed on expand (null when there is only one).
 *  A section that is not a bullet list becomes the summary whole. */
export function splitSummaryAndDetail(rendered: string): [string, string | null] {
  const items = rendered.match(/<li>[\s\S]*?<\/li>/g);
  if (!items) return [rendered, null];
  const summary = `<p>${items[0].replace(/<\/?li>/g, "")}</p>`;
  return items.length === 1 ? [summary, null] : [summary, `<ul>${items.slice(1).join("")}</ul>`];
}

/** How prominently to show a section: a poor set (<50) confronts the lifter with what went wrong and how to avoid injury, so only those two show;
 *  a strong set (>=80) leads with what they nailed and how to progress; a middling set shows everything. */
export function sectionEmphasis(cssClass: string, overall: number | null): "featured" | "muted" | "hidden" {
  if (overall === null) return "featured";
  if (overall < 50) return cssClass === "negatives" || cssClass === "injury" ? "featured" : "hidden";
  if (overall >= 80) return cssClass === "positives" || cssClass === "progress" ? "featured" : "muted";
  return "featured";
}

/** Python's html.escape(text): & < > " ' (in that order, the ampersand first). */
export const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");

// `^` and `$` here mean what Python's MULTILINE ones do: only "\n" is a line break.
const HEADING = new RegExp(`(?<![^\\n])##${PY_CLASSES.space}+([^\\n]+)(?![^\\n])`);

export function splitFeedbackSections(feedbackMarkdown: string, overall: number | null = null): Section[] {
  const parts = feedbackMarkdown.split(new RegExp(HEADING.source, "g"));
  const sections: Section[] = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const heading = parts[i];
    const body = parts[i + 1];
    const known = pyStrip(heading).toLowerCase();
    const cssClass = Object.hasOwn(SECTION_STYLES, known) ? SECTION_STYLES[known] : "improvements";
    const emphasis = sectionEmphasis(cssClass, overall);
    if (emphasis === "hidden") continue;
    // Markdown passes literal HTML in its source through unescaped, and clients render this as HTML. Escaping first inerts any < > & " '
    // in the model's text without touching the markdown syntax.
    const [summary, detail] = splitSummaryAndDetail(renderMarkdown(escapeHtml(pyStrip(body))));
    sections.push({ heading: pyStrip(heading), css_class: cssClass, emphasis, title_key: "analyze.section." + cssClass, summary_html: summary, detail_html: detail });
  }
  return sections.map((s, i) => [s, i] as const).sort((a, b) => (a[0].emphasis === "featured" ? 0 : 1) - (b[0].emphasis === "featured" ? 0 : 1) || a[1] - b[1]).map(([s]) => s);
}
