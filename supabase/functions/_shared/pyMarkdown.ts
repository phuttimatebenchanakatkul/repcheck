/** The slice of Python-Markdown the form reports use, and nothing else.
 *
 * The website turns the model's "## Heading" sections into HTML with the `markdown` package (api/feedback.py). The model is told to
 * write short bullet lists with bold and italics, so that is what this renders: paragraphs, top-level bullet and numbered lists (tight or loose, with
 * continuation lines), `**strong**`, `*em*`, `__strong__`, `_em_`, `***both***`, `code`, backslash escapes and the two-space line break.
 * The output is byte-for-byte Python-Markdown's for those shapes (tests/golden_feedback.test.ts runs thousands of them through both).
 *
 * Everything else Python-Markdown understands (links, images, headings, nested lists, block quotes, code blocks, rules,
 * reference definitions) is NOT interpreted: it comes out as plain text in a paragraph, escaped like all the rest. The app draws
 * only paragraphs, bullets, bold, italic and code from this HTML, so a link or a nested list would have been flattened there anyway.
 *
 * The input must already be HTML-escaped (the caller does what `html.escape` does), which is why `<` never reaches here.
 */

const STX = "\u0002";
const ETX = "\u0003";

const escapeCode = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Inline rendering. Finished pieces are parked behind placeholders so no later rule can touch them, then put back. */
class Inline {
  private stash: string[] = [];

  render(text: string): string {
    const parked = this.park(text);
    return this.unpark(parked);
  }

  private hold(html: string): string {
    this.stash.push(html);
    return `${STX}${this.stash.length - 1}${ETX}`;
  }

  private unpark(text: string): string {
    // an item may itself hold placeholders (a strong around a code span), so keep going until none are left
    let out = text;
    for (let guard = 0; guard < 50 && out.includes(STX); guard++) out = out.replace(new RegExp(`${STX}(\\d+)${ETX}`, "g"), (_m, i) => this.stash[Number(i)]);
    return out;
  }

  private park(input: string): string {
    let text = input;
    // 1. `code` (the longest run of backticks closes what it opened). Its contents are escaped once more, as Python-Markdown does.
    text = this.each(text, /(?<!\\)(`+)(.+?)(?<!`)\1(?!`)/s, (m) => `<code>${escapeCode(m[2].trim())}</code>`);
    // 2. backslash escapes
    text = this.each(text, /\\([\\`*_{}[\]()>#+\-.!])/, (m) => m[1]);
    // 3. two spaces at the end of a line
    text = this.each(text, / {2}\n/, () => "<br />\n");
    // 4. a lone * or _ between spaces is just a character
    text = this.each(text, /(?:^|(?<=\s))(\*{1,3}|_{1,3})(?=\s|$)/, (m) => m[1]);
    return this.emphasis(text);
  }

  /** `***a***`, `**a**`, `*a*`, then the underscore forms (which, unlike the asterisks, ignore underscores inside a word). */
  private emphasis(input: string): string {
    let text = input;
    text = this.each(text, /(\*)\1{2}(.+?)\1{3}/s, (m) => `<strong><em>${this.nested(m[2])}</em></strong>`);
    text = this.each(text, /(\*)\1(?!\1)([^*]+?)\1(?!\1)(.+?)\1{3}/s, (m) => `<strong>${this.nested(m[2])}<em>${this.nested(m[3])}</em></strong>`);
    text = this.each(text, /(\*{2})(.+?)\1/s, (m) => `<strong>${this.nested(m[2])}</strong>`);
    text = this.each(text, /(\*)([^*]+)\1/s, (m) => `<em>${this.nested(m[2])}</em>`);
    text = this.each(text, /(?<!\w)(_)\1{2}(?!_)(.+?)(?<!_)\1{3}(?!\w)/s, (m) => `<strong><em>${this.nested(m[2])}</em></strong>`);
    text = this.each(text, /(?<!\w)(_{2})(?!_)(.+?)(?<!_)\1(?!\w)/s, (m) => `<strong>${this.nested(m[2])}</strong>`);
    text = this.each(text, /(?<!\w)(_)(?!_)(.+?)(?<!_)\1(?!\w)/s, (m) => `<em>${this.nested(m[2])}</em>`);
    return text;
  }

  private nested(inner: string): string {
    return this.unpark(this.emphasis(inner));
  }

  /** Replace every match of `re`, leftmost first, with a placeholder for `build`'s HTML. */
  private each(text: string, re: RegExp, build: (m: RegExpExecArray) => string): string {
    let out = "";
    let rest = text;
    for (;;) {
      const m = re.exec(rest);
      if (!m) return out + rest;
      out += rest.slice(0, m.index) + this.hold(build(m));
      rest = rest.slice(m.index + m[0].length);
    }
  }
}

const inline = (text: string) => new Inline().render(text);

interface Item {
  /** Paragraphs inside the item; a tight item has just text. */
  text: string;
  loose: boolean;
}

const LIST_START = /^ {0,3}(?:[*+-]|\d+\.) +/;
const ITEM_LINE = /^ {0,3}(?:[*+-]|\d+\.) +(.*)/;

/** The lines of one block as list items: a marker starts one; any other line carries on the item before it. */
function itemsOf(block: string): string[] {
  const items: string[] = [];
  for (const line of block.split("\n")) {
    const m = ITEM_LINE.exec(line);
    if (m) items.push(m[1]);
    else items[items.length - 1] = `${items[items.length - 1]}\n${line}`;
  }
  return items;
}

/** Python's str.expandtabs(4): a tab pads to the next multiple of four columns, and a line break starts the count again. */
function expandTabs(text: string): string {
  let out = "";
  let column = 0;
  for (const ch of text) {
    if (ch === "\t") {
      const pad = 4 - (column % 4);
      out += " ".repeat(pad);
      column += pad;
    } else {
      out += ch;
      column = ch === "\n" || ch === "\r" ? 0 : column + 1;
    }
  }
  return out;
}

type Node = { kind: "p"; text: string } | { kind: "list"; tag: "ul" | "ol"; items: Item[] };

/** Markdown (already HTML-escaped) to HTML, as the `markdown` package writes it. */
export function renderMarkdown(source: string): string {
  const text = expandTabs(source.replaceAll("\r\n", "\n").replaceAll("\r", "\n")).replace(/(?<=\n) +\n/g, "\n");
  const nodes: Node[] = [];
  for (let block of `${text}\n\n`.split("\n\n")) {
    while (block.startsWith("\n")) block = block.slice(1); // a run of blank lines is one separation
    if (!block.trim()) continue;
    const last = nodes[nodes.length - 1];
    if (LIST_START.test(block)) {
      const items = itemsOf(block);
      if (last?.kind === "list") {
        // the same list carries on after a blank line: the item before it, and this block's first, become paragraphs
        last.items[last.items.length - 1].loose = true;
        last.items.push({ text: items[0], loose: true });
        for (const rest of items.slice(1)) last.items.push({ text: rest, loose: false });
      } else {
        nodes.push({ kind: "list", tag: /^ {0,3}\d/.test(block) ? "ol" : "ul", items: items.map((t) => ({ text: t, loose: false })) });
      }
    } else {
      nodes.push({ kind: "p", text: block.replace(/^\s+/, "") });
    }
  }
  return nodes.map((n) => {
    if (n.kind === "p") return `<p>${inline(n.text.replace(/\s+$/, ""))}</p>`;
    const lis = n.items.map((i) => {
      const body = inline(i.text.replace(/\s+$/, ""));
      return i.loose ? `<li>\n<p>${body}</p>\n</li>` : `<li>${body}</li>`;
    });
    return `<ul>\n${lis.join("\n")}\n</ul>`;
  }).join("\n");
}
