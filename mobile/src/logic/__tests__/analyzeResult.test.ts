import { ALWAYS_VISIBLE, STATUS_KEYS, createdMs, favoredNote, groupByMonth, parseAnalysis, parseHistory, relativeDay, scoreTone, splitSections, statusKeyAt, tutorialLink, verdictKey, type FormSection, type HistoryEntry } from '../analyzeResult';

const section = (css_class: string, extra: object = {}) => ({ heading: css_class, css_class, emphasis: 'featured', title_key: `analyze.section.${css_class}`, summary_html: '<p>x</p>', detail_html: null, ...extra });
const ok = (extra: object = {}) => ({ ok: true, id: 7, exercise_label: 'Flat Bench Press', overall_score: 72, stretch_score: 70, squeeze_score: 80, favored: 'squeeze', reps: 8, sections: [section('positives')], created_at: '2026-10-27T10:00:00+00:00', video_url: 'https://x/v.mp4', ...extra });

describe('parseAnalysis', () => {
  it('reads a full answer', () => {
    expect(parseAnalysis(ok())).toEqual({
      id: 7,
      exercise_label: 'Flat Bench Press',
      overall_score: 72,
      stretch_score: 70,
      squeeze_score: 80,
      favored: 'squeeze',
      reps: 8,
      sections: [{ heading: 'positives', css_class: 'positives', emphasis: 'featured', title_key: 'analyze.section.positives', summary_html: '<p>x</p>', detail_html: null }],
      created_at: '2026-10-27T10:00:00+00:00',
      video_url: 'https://x/v.mp4',
    });
  });

  it.each([[null], [undefined], ['x'], [[]], [{}], [ok({ id: '7' })], [ok({ exercise_label: '' })], [ok({ exercise_label: 3 })]])('refuses %j', (raw) => {
    expect(parseAnalysis(raw)).toBeNull();
  });

  it('a missing or odd field is null, never a crash', () => {
    const a = parseAnalysis(ok({ overall_score: 'high', stretch_score: NaN, squeeze_score: undefined, favored: 'both', reps: null, video_url: '', sections: 'no' }))!;
    expect([a.overall_score, a.stretch_score, a.squeeze_score, a.favored, a.reps, a.video_url, a.sections]).toEqual([null, null, null, null, null, null, []]);
  });

  it('a count of zero is hidden, as on the website', () => {
    expect(parseAnalysis(ok({ reps: 0 }))!.reps).toBeNull();
    expect(parseAnalysis(ok({ reps: -2 }))!.reps).toBeNull();
    expect(parseAnalysis(ok({ reps: 1 }))!.reps).toBe(1);
  });

  it('keeps the score zero: it is a grade, not a missing one', () => {
    expect(parseAnalysis(ok({ overall_score: 0 }))!.overall_score).toBe(0);
  });

  it('skips a section it cannot show and keeps the rest', () => {
    const a = parseAnalysis(ok({ sections: [section('positives'), section('weird'), { css_class: 'injury' }, null, 'x', section('progress', { emphasis: 'muted', detail_html: '<ul><li>a</li></ul>' }), section('negatives', { detail_html: '' })] }))!;
    expect(a.sections.map((s) => s.css_class)).toEqual(['positives', 'progress', 'negatives']);
    expect(a.sections[1]).toMatchObject({ emphasis: 'muted', detail_html: '<ul><li>a</li></ul>' });
    expect(a.sections[2].detail_html).toBeNull();
  });

  it('takes the title from the class, so a bad title cannot point anywhere', () => {
    expect(parseAnalysis(ok({ sections: [section('injury', { title_key: 'evil.key' })] }))!.sections[0].title_key).toBe('analyze.section.injury');
  });

  it('an emphasis it does not know is shown as featured', () => {
    expect(parseAnalysis(ok({ sections: [section('summary', { emphasis: 'hidden' })] }))!.sections[0].emphasis).toBe('featured');
  });
});

describe('parseHistory', () => {
  it('reads the entries and drops what is not one', () => {
    const body = { ok: true, entries: [{ id: 2, exercise_label: 'Squat', overall_score: 90, reps: 5, created_at: '2026-10-27T10:00:00+00:00', has_video: true }, { id: 'x' }, null, { id: 1, exercise_label: 'Row', overall_score: null, reps: 0, created_at: 5, has_video: 'yes' }] };
    expect(parseHistory(body)).toEqual([
      { id: 2, exercise_label: 'Squat', overall_score: 90, reps: 5, created_at: '2026-10-27T10:00:00+00:00', has_video: true },
      { id: 1, exercise_label: 'Row', overall_score: null, reps: 0, created_at: '', has_video: false },
    ]);
  });

  it.each([[null], [{}], [{ entries: 'x' }], [[]]])('nothing from %j', (raw) => {
    expect(parseHistory(raw)).toEqual([]);
  });
});

describe('the score', () => {
  it.each([[100, 'good'], [80, 'good'], [79, 'ok'], [50, 'ok'], [49, 'bad'], [0, 'bad']] as const)('%i is %s', (score, tone) => {
    expect(scoreTone(score)).toBe(tone);
  });

  it('no score, no tone, no verdict', () => {
    expect(scoreTone(null)).toBeNull();
    expect(verdictKey(null)).toBeNull();
  });

  it('a verdict per bucket', () => {
    expect(verdictKey(95)).toBe('analyze.verdictGood');
    expect(verdictKey(60)).toBe('analyze.verdictOk');
    expect(verdictKey(10)).toBe('analyze.verdictBad');
    expect(verdictKey(0)).toBe('analyze.verdictBad');
  });
});

describe('stretch against squeeze', () => {
  it('names the stronger half and the one to focus on', () => {
    expect(favoredNote('stretch')).toEqual({ key: 'analyze.favorsNote', favored: 'analyze.stretch', other: 'analyze.squeeze' });
    expect(favoredNote('squeeze')).toEqual({ key: 'analyze.favorsNote', favored: 'analyze.squeeze', other: 'analyze.stretch' });
    expect(favoredNote('balanced')).toEqual({ key: 'analyze.balancedNote' });
    expect(favoredNote(null)).toBeNull();
  });
});

describe('splitSections', () => {
  const all = (['summary', 'positives', 'negatives', 'improvements', 'injury', 'progress'] as const).map((c) => parseAnalysis(ok({ sections: [section(c)] }))!.sections[0]);

  it('positives and progress lead; the rest wait behind the full report; order is kept', () => {
    const { primary, secondary } = splitSections(all);
    expect(primary.map((s) => s.css_class)).toEqual(['positives', 'progress']);
    expect(secondary.map((s) => s.css_class)).toEqual(['summary', 'negatives', 'improvements', 'injury']);
    expect(ALWAYS_VISIBLE).toEqual(['positives', 'progress']);
  });

  it('nothing in, nothing out', () => {
    expect(splitSections([] as FormSection[])).toEqual({ primary: [], secondary: [] });
  });
});

describe('relativeDay', () => {
  const now = Date.UTC(2026, 9, 27, 12, 0, 0);
  const at = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();

  it('counts whole 24-hour blocks, like the website', () => {
    expect(relativeDay(at(0), now)).toEqual({ kind: 'today' });
    expect(relativeDay(at(23), now)).toEqual({ kind: 'today' });
    expect(relativeDay(at(24), now)).toEqual({ kind: 'yesterday' });
    expect(relativeDay(at(47), now)).toEqual({ kind: 'yesterday' });
    expect(relativeDay(at(48), now)).toEqual({ kind: 'days', n: 2 });
    expect(relativeDay(at(24 * 6 + 23), now)).toEqual({ kind: 'days', n: 6 });
    expect(relativeDay(at(24 * 7), now)).toEqual({ kind: 'date', ms: now - 24 * 7 * 3_600_000 });
  });

  it('a clock a little ahead of the server is still today', () => {
    expect(relativeDay(at(-3), now)).toEqual({ kind: 'today' });
  });

  it('no date, no label', () => {
    expect(relativeDay('', now)).toBeNull();
    expect(relativeDay('soon', now)).toBeNull();
  });
});

describe('groupByMonth', () => {
  const entry = (id: number, created_at: string): HistoryEntry => ({ id, exercise_label: 'x', overall_score: 1, reps: 1, created_at, has_video: false });
  // Mid-month noon UTC so no timezone moves a date into another month.
  const a = entry(1, '2026-10-15T12:00:00+00:00');
  const b = entry(2, '2026-10-02T12:00:00+00:00');
  const c = entry(3, '2026-08-20T12:00:00+00:00');
  const d = entry(4, '2025-10-10T12:00:00+00:00');

  it('one group per run of the same month, newest first, skipping empty months', () => {
    const groups = groupByMonth([a, b, c, d]);
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([[1, 2], [3], [4]]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(3);
  });

  it('the same month in another year is its own group', () => {
    expect(groupByMonth([a, d]).length).toBe(2);
  });

  it('names the month from the first entry', () => {
    expect(groupByMonth([a, b])[0].ms).toBe(createdMs(a.created_at));
  });

  it('an entry with no date gets its own unknown group', () => {
    const groups = groupByMonth([a, entry(9, 'nope'), entry(10, '')]);
    expect(groups.map((g) => [g.key === 'unknown', g.ms, g.entries.length])).toEqual([[false, createdMs(a.created_at), 1], [true, null, 2]]);
  });

  it('nothing in, nothing out', () => {
    expect(groupByMonth([])).toEqual([]);
  });
});

describe('tutorialLink', () => {
  it('a library exercise links to its video', () => {
    expect(tutorialLink('Flat Bench Press')).toEqual({ url: 'https://www.youtube.com/watch?v=hWbUlkb5Ms4', known: true });
  });

  it('anything else searches for its form, with the name safely encoded', () => {
    expect(tutorialLink('My lift & "press"')).toEqual({
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent('My lift & "press" proper form tutorial')}`,
      known: false,
    });
  });
});

describe('the status lines', () => {
  it('step every 2.2 s and stay on the last', () => {
    expect(statusKeyAt(0)).toBe('analyze.status1');
    expect(statusKeyAt(2199)).toBe('analyze.status1');
    expect(statusKeyAt(2200)).toBe('analyze.status2');
    expect(statusKeyAt(2200 * 6)).toBe('analyze.status7');
    expect(statusKeyAt(2200 * 6 - 1)).toBe('analyze.status6');
    expect(statusKeyAt(10 * 60_000)).toBe('analyze.status7');
    expect(statusKeyAt(-5)).toBe('analyze.status1');
    expect(STATUS_KEYS.length).toBe(7);
  });

  it('a custom step', () => {
    expect(statusKeyAt(1000, 500)).toBe('analyze.status3');
  });
});
