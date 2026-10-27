import { decodeEntities, parseRichText, plainText } from '../richText';

interface Section {
  summary_html: string;
  detail_html: string | null;
  summary_text: string;
  detail_text: string | null;
  bold: number;
  italic: number;
}
interface Case {
  name: string;
  sections: Section[];
}
const { cases } = require('./fixtures/feedback.json') as { cases: Case[] };

describe('against what the server really sends', () => {
  const all = cases.flatMap((c) => c.sections.map((s) => ({ name: c.name, s })));

  it('has real sections to check', () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it.each(all.map((x, i) => [`${x.name} #${i}`, x.s] as const))('%s: the same words, the same bold and italic', (_n, s) => {
    for (const [html, text] of [[s.summary_html, s.summary_text], [s.detail_html, s.detail_text]] as const) {
      expect(plainText(parseRichText(html))).toBe(text ?? '');
    }
    const blocks = [...parseRichText(s.summary_html), ...parseRichText(s.detail_html)];
    const runs = blocks.flatMap((b) => b.runs);
    // A styled stretch is one run, however the markdown nests it, so the counts match the tags.
    expect(runs.filter((r) => r.bold).length).toBe(s.bold);
    expect(runs.filter((r) => r.italic).length).toBe(s.italic);
  });

  it('a summary is a paragraph and the rest are bullets', () => {
    const mixed = cases[0].sections[0];
    expect(parseRichText(mixed.summary_html).map((b) => b.kind)).toEqual(['paragraph']);
    expect(parseRichText(mixed.detail_html).map((b) => b.kind)).toEqual(['bullet', 'bullet']);
  });
});

describe('entities', () => {
  it('decodes the named, decimal and hex references the server produces', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#x27;e&#x27; &#39;f&#39;')).toBe('a & b <c> "d" \'e\' \'f\'');
  });

  it('decodes once: an escaped ampersand does not become a second entity', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
  });

  it('leaves what it does not know exactly as written', () => {
    expect(decodeEntities('&bogus; &#0; &#x110000; &#xD800; & plain')).toBe('&bogus; &#0; &#x110000; &#xD800; & plain');
  });

  it('decodes astral code points', () => {
    expect(decodeEntities('&#x1F4AA;')).toBe('\u{1F4AA}');
  });
});

describe('markup', () => {
  it('reads nothing but text: a script tag becomes words and nothing runs', () => {
    const blocks = parseRichText('<p>hi <script>alert(1)</script> there <img src=x onerror=1></p>');
    expect(plainText(blocks)).toBe('hi alert(1) there');
  });

  it('text that merely looks like a tag, once decoded, stays text', () => {
    expect(plainText(parseRichText('<p>&lt;b&gt;not bold&lt;/b&gt;</p>'))).toBe('<b>not bold</b>');
    expect(parseRichText('<p>&lt;b&gt;x&lt;/b&gt;</p>')[0].runs[0].bold).toBe(false);
  });

  it('nests bold inside italic and keeps each run its own', () => {
    const [block] = parseRichText('<p>a <em>b <strong>c</strong></em> d</p>');
    expect(block.runs).toEqual([
      { text: 'a ', bold: false, italic: false, code: false },
      { text: 'b ', bold: false, italic: true, code: false },
      { text: 'c', bold: true, italic: true, code: false },
      { text: ' d', bold: false, italic: false, code: false },
    ]);
  });

  it('marks code, and a stray closing tag does not leave the style stuck on', () => {
    const [block] = parseRichText('</strong></em></code><p>x <code>y</code> z</p>');
    expect(block.runs.map((r) => [r.text, r.code, r.bold, r.italic])).toEqual([['x ', false, false, false], ['y', true, false, false], [' z', false, false, false]]);
  });

  it('an unclosed style ends with its block', () => {
    const blocks = parseRichText('<p>a <strong>b</p><p>c</p>');
    expect(blocks[0].runs.map((r) => r.bold)).toEqual([false, true]);
    expect(blocks[1].runs.map((r) => r.bold)).toEqual([false]);
    const items = parseRichText('<ul><li><em>a</li><li>b</li></ul>');
    expect(items.map((b) => b.runs[0].italic)).toEqual([true, false]);
  });

  it('b and i count as strong and em', () => {
    const [block] = parseRichText('<p><b>x</b><i>y</i></p>');
    expect(block.runs.map((r) => [r.text, r.bold, r.italic])).toEqual([['x', true, false], ['y', false, true]]);
  });

  it('bullets, ordered or not, come out one block each', () => {
    const blocks = parseRichText('<ul><li>a</li><li>b <em>c</em></li></ul><ol><li>d</li></ol>');
    expect(blocks.map((b) => [b.kind, plainText([b])])).toEqual([['bullet', 'a'], ['bullet', 'b c'], ['bullet', 'd']]);
  });

  it('a paragraph after a list is a paragraph again', () => {
    expect(parseRichText('<ul><li>a</li></ul><p>b</p>').map((b) => b.kind)).toEqual(['bullet', 'paragraph']);
  });

  it('a br splits a block, and runs of white space collapse', () => {
    expect(plainText(parseRichText('<p>a  \n  b<br/>c<br>d</p>'))).toBe('a b\nc\nd');
  });

  it('headings and tag case do not matter', () => {
    expect(plainText(parseRichText('<H2>Title</H2><P>Body</P>'))).toBe('Title\nBody');
  });

  it('nothing in, nothing out', () => {
    expect(parseRichText(null)).toEqual([]);
    expect(parseRichText(undefined)).toEqual([]);
    expect(parseRichText('')).toEqual([]);
    expect(parseRichText('<p> </p><ul></ul>')).toEqual([]);
  });

  it('plain text with no tags is one paragraph', () => {
    expect(parseRichText('Just words')).toEqual([{ kind: 'paragraph', runs: [{ text: 'Just words', bold: false, italic: false, code: false }] }]);
  });

  it('a < that opens no tag stays as text', () => {
    expect(plainText(parseRichText('<p>1 < 2 and 3 > 2</p>'))).toBe('1 < 2 and 3 > 2');
  });
});
