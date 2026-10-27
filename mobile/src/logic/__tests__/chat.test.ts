import fs from 'fs';
import path from 'path';

import {
  ANALYSIS_CHAT_WINDOW_MS,
  COACH_KEEP,
  MAX_SOURCES,
  analysisChatClosed,
  chatBlocks,
  cleanSources,
  formatCountdown,
  historyForServer,
  parseChatReply,
  safeUrl,
  todaysCoachTurns,
  type ChatTurn,
} from '../chat';
import { parseRichText, plainText } from '../richText';

const turn = (over: Partial<ChatTurn> = {}): ChatTurn => ({ id: 'a', role: 'user', text: 'hi', sources: null, date: '2026-10-27', ...over });

describe('against the website’s own formatBubble', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../../../static/analyze_chat_widget.js'), 'utf8');
  const start = source.indexOf('function formatBubble(');
  let depth = 0;
  let i = source.indexOf('{', start);
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) break;
  }
  const body = source.slice(start, i + 1);
  // The widget escapes through a detached element; this stand-in escapes the same three characters the browser does.
  const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // eslint-disable-next-line no-new-func
  const website = new Function('escapeHtml', `${body}; return formatBubble;`)(escapeHtml) as (text: string) => string;

  const shape = (blocks: ReturnType<typeof chatBlocks>) => blocks.map((b) => ({ kind: b.kind, text: plainText([b]), bold: b.runs.filter((r) => r.bold).map((r) => r.text) }));

  const samples = [
    'Hello there',
    'A **bold** word and **another**.',
    '- one\n- two\n\nthen a paragraph\n* star bullet\n  - indented bullet',
    'Mixed <b>tags</b> & ampersands > less < than',
    '**all bold**',
    '-not a bullet\n- real bullet',
    '  padded line  \n\n\n  second  ',
    '- **bold bullet** and text',
    '',
    '**',
    'a ** b ** c',
  ];

  it.each(samples.map((s) => [JSON.stringify(s), s]))('%s reads the same', (_label, text) => {
    expect(shape(chatBlocks(text))).toEqual(shape(parseRichText(website(text))));
  });

  it('agrees on 400 random messages that never leave a **bold** open across a line', () => {
    let seed = 20261027;
    const next = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const pieces = ['word', 'Squat', '**strong**', '&', '<', '>', '"', "'", ' ', '-', '* ', '- ', 'a-b', '1.', 'x**y**z'];
    for (let n = 0; n < 400; n++) {
      const lines = Array.from({ length: 1 + Math.floor(next() * 5) }, () => Array.from({ length: Math.floor(next() * 6) }, () => pieces[Math.floor(next() * pieces.length)]).join(' '));
      if (lines.some((line) => ((line.match(/\*\*/g) ?? []).length % 2) === 1)) continue;
      const text = lines.join('\n');
      expect(shape(chatBlocks(text))).toEqual(shape(parseRichText(website(text))));
    }
  });
});

describe('chatBlocks', () => {
  it('a line is a paragraph, a "- " or "* " line a bullet, blank lines nothing', () => {
    expect(chatBlocks('a\n\n- b\n* c\n-d').map((b) => [b.kind, plainText([b])])).toEqual([['paragraph', 'a'], ['bullet', 'b'], ['bullet', 'c'], ['paragraph', '-d']]);
  });

  it('only **bold** is styled; markup characters are text', () => {
    const [block] = chatBlocks('x **y** <i>z</i>');
    expect(block.runs).toEqual([
      { text: 'x ', bold: false, italic: false, code: false },
      { text: 'y', bold: true, italic: false, code: false },
      { text: ' <i>z</i>', bold: false, italic: false, code: false },
    ]);
  });

  it('a lone ** stays as written', () => {
    expect(plainText(chatBlocks('a ** b'))).toBe('a ** b');
  });
});

describe('citations', () => {
  const good = { title: 'ACSM position stand', publisher: 'ACSM', url: 'https://example.org/a' };

  it('keeps a title with a plain https link, and the publisher when there is one', () => {
    expect(cleanSources([good, { title: 'No publisher', url: 'https://example.org/b' }])).toEqual([
      good,
      { title: 'No publisher', publisher: null, url: 'https://example.org/b' },
    ]);
  });

  it.each([
    ['http link', { title: 't', url: 'http://example.org' }],
    ['javascript link', { title: 't', url: 'javascript:alert(1)' }],
    ['link with a quote', { title: 't', url: 'https://example.org/"x' }],
    ['link with a space', { title: 't', url: 'https://example.org/a b' }],
    ['link with an angle bracket', { title: 't', url: 'https://example.org/<x' }],
    ['no title', { title: '', url: 'https://example.org' }],
    ['title not text', { title: 5, url: 'https://example.org' }],
    ['no link', { title: 't' }],
    ['null', null],
    ['text', 'https://example.org'],
  ])('drops a %s', (_name, item) => {
    expect(cleanSources([item])).toEqual([]);
  });

  it('shows at most three, counting only the good ones', () => {
    const many = [{ title: 'bad' }, ...Array.from({ length: 5 }, (_, i) => ({ title: `s${i}`, url: `https://example.org/${i}` }))];
    expect(MAX_SOURCES).toBe(3);
    expect(cleanSources(many).map((s) => s.title)).toEqual(['s0', 's1', 's2']);
  });

  it('anything but a list is nothing', () => {
    for (const raw of [null, undefined, 'x', 3, {}]) expect(cleanSources(raw)).toEqual([]);
  });

  it('safeUrl is https only', () => {
    expect(safeUrl('https://a.b/c?d=e#f')).toBe('https://a.b/c?d=e#f');
    expect(safeUrl('http://a.b')).toBeNull();
    expect(safeUrl('HTTPS://a.b')).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});

describe('parseChatReply', () => {
  it('reads an answer', () => {
    expect(parseChatReply({ ok: true, reply: 'Yes.', sources: [{ title: 't', url: 'https://x.org' }], limited: false, retry_after_seconds: 0 })).toEqual({
      reply: 'Yes.',
      sources: [{ title: 't', publisher: null, url: 'https://x.org' }],
      limited: false,
      retryAfterSeconds: 0,
    });
  });

  it('a limit notice carries the wait', () => {
    expect(parseChatReply({ ok: true, reply: 'Come back later.', sources: [], limited: true, retry_after_seconds: 3600 })).toMatchObject({ limited: true, retryAfterSeconds: 3600 });
  });

  it('odd fields are safe defaults', () => {
    expect(parseChatReply({ reply: '', sources: 'x', limited: 'yes', retry_after_seconds: -4 })).toEqual({ reply: '', sources: [], limited: false, retryAfterSeconds: 0 });
    expect(parseChatReply({ reply: 'a', retry_after_seconds: NaN })?.retryAfterSeconds).toBe(0);
  });

  it.each([[null], [undefined], ['x'], [{}], [{ reply: 3 }]])('not an answer: %j', (body) => {
    expect(parseChatReply(body)).toBeNull();
  });
});

describe('formatCountdown', () => {
  it.each([[0, '1m'], [59, '1m'], [60, '1m'], [119, '1m'], [120, '2m'], [3599, '59m'], [3600, '1h 0m'], [7500, '2h 5m'], [-5, '1m']])('%i s is %s', (s, text) => {
    expect(formatCountdown(s)).toBe(text);
  });
});

describe('history sent to the server', () => {
  it('names the assistant side the way each module expects', () => {
    const turns = [turn({ text: 'q' }), turn({ id: 'b', role: 'assistant', text: 'a' })];
    expect(historyForServer(turns, 'coach')).toEqual([{ role: 'user', text: 'q' }, { role: 'coach', text: 'a' }]);
    expect(historyForServer(turns, 'assistant')).toEqual([{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }]);
  });

  it('sends only role and text, never citations', () => {
    const sent = historyForServer([turn({ role: 'assistant', sources: [{ title: 't', publisher: null, url: 'https://x.org' }] })], 'coach');
    expect(Object.keys(sent[0])).toEqual(['role', 'text']);
  });
});

describe('the coach’s day', () => {
  it('shows today’s turns only, newest sixty at most', () => {
    const many = Array.from({ length: 70 }, (_, i) => turn({ id: String(i), text: String(i) }));
    const kept = todaysCoachTurns([turn({ id: 'old', date: '2026-10-26' }), ...many], '2026-10-27');
    expect(kept).toHaveLength(COACH_KEEP);
    expect(kept[0].text).toBe('10');
    expect(kept.at(-1)?.text).toBe('69');
    expect(kept.some((t) => t.id === 'old')).toBe(false);
  });
});

describe('an analysis’s chat closes a day after it was made', () => {
  const made = Date.UTC(2026, 9, 26, 12);
  it('open up to and including 24 hours, closed after', () => {
    expect(analysisChatClosed(made, made + ANALYSIS_CHAT_WINDOW_MS)).toBe(false);
    expect(analysisChatClosed(made, made + ANALYSIS_CHAT_WINDOW_MS + 1)).toBe(true);
    expect(analysisChatClosed(made, made)).toBe(false);
  });

  it('an unreadable date never closes it', () => {
    expect(analysisChatClosed(NaN, made)).toBe(false);
  });
});
