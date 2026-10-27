/**
 * The small HTML the server sends for a form report (`api/feedback.py`: markdown rendered after html.escape, then split into a
 * summary paragraph and a bullet list), turned into runs the app draws as native <Text>. The website puts that HTML in innerHTML;
 * the app has no HTML renderer and must not grow one, so this reads only the handful of tags the markdown library can produce
 * and treats everything else as plain text with its tags dropped. Nothing here can run or fetch anything.
 */

export interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
}

export interface Block {
  kind: 'paragraph' | 'bullet';
  runs: Run[];
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** &amp; &lt; &gt; &quot; &#x27; &#39; and friends. Unknown or out-of-range references stay as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body] ?? whole;
  });
}

/** Paragraphs and bullets, in order, each as styled runs. Blank blocks are dropped. */
export function parseRichText(html: string | null | undefined): Block[] {
  if (!html) return [];
  const blocks: Block[] = [];
  let runs: Run[] = [];
  let kind: Block['kind'] = 'paragraph';
  let bold = 0;
  let italic = 0;
  let code = 0;
  let inItem = false;

  const flush = () => {
    const trimmed = trimRuns(runs);
    if (trimmed.length) blocks.push({ kind, runs: trimmed });
    runs = [];
  };

  for (const token of html.split(/(<[^>]*>)/)) {
    if (token === '') continue;
    const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>$/.exec(token);
    if (tag) {
      const closing = tag[1] === '/';
      const name = tag[2].toLowerCase();
      if (name === 'strong' || name === 'b') bold = Math.max(0, bold + (closing ? -1 : 1));
      else if (name === 'em' || name === 'i') italic = Math.max(0, italic + (closing ? -1 : 1));
      else if (name === 'code') code = Math.max(0, code + (closing ? -1 : 1));
      else if (name === 'li') {
        flush();
        bold = italic = code = 0;
        inItem = !closing;
        kind = closing ? 'paragraph' : 'bullet';
      } else if (name === 'p' || name === 'ul' || name === 'ol' || name === 'br' || /^h[1-6]$/.test(name)) {
        flush();
        if (name !== 'br') bold = italic = code = 0; // a style left open never runs past its block
        kind = inItem ? 'bullet' : 'paragraph';
      }
      continue;
    }
    const text = decodeEntities(token).replace(/\s+/g, ' ');
    if (text) runs.push({ text, bold: bold > 0, italic: italic > 0, code: code > 0 });
  }
  flush();
  return blocks;
}

/** Trim the block's outer whitespace and merge neighbours that look the same. */
function trimRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (last && last.bold === run.bold && last.italic === run.italic && last.code === run.code) last.text += run.text;
    else out.push({ ...run });
  }
  if (out.length) out[0].text = out[0].text.replace(/^\s+/, '');
  if (out.length) out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '');
  return out.filter((run) => run.text !== '');
}

/** The words alone, one line per block: what a screen reader would be given, and what the tests compare. */
export function plainText(blocks: Block[]): string {
  return blocks.map((block) => block.runs.map((run) => run.text).join('')).join('\n');
}
