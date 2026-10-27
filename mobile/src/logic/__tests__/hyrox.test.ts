import * as fs from 'fs';
import * as path from 'path';

import {
  CATEGORIES,
  DEFAULT_LANE_M,
  FLAG_THRESHOLD_SECONDS,
  FORMATS,
  GENDERS,
  PB_BOARD_LIMIT,
  RUN_DISTANCE_M,
  SCALES,
  STATIONS,
  STATION_KEYS,
  STATION_SPECS,
  BOARD_TABS,
  CUSTOM_KEYS,
  CUSTOM_PICKER,
  CUSTOM_ROUND_KEYS,
  CUSTOM_WALL_BALL_REPS,
  addBlock,
  cleanCustomAmount,
  customDefaultAmount,
  customLaps,
  customSequence,
  customTitle,
  defaultCustomRace,
  finishedCustomRace,
  formatCustomAmount,
  moveBlock,
  removeBlock,
  setBlockAmount,
  NO_PRACTICE,
  ROUND_STATIONS,
  cleanRounds,
  doublesShare,
  hasPractice,
  practiceAfter,
  practiceWeight,
  scaledDistanceM,
  sessionWeightKg,
  allPersonalBests,
  analysisFromJson,
  breakdownTotals,
  canAnalyze,
  cleanLane,
  finishedRace,
  flagKey,
  formatClock,
  formatClockPrecise,
  isFlagged,
  laneOrDefault,
  leaderboardResult,
  newestFirst,
  pbBoards,
  pbKey,
  personalBest,
  ratingsByKey,
  tipGroups,
  profileGender,
  roundsFor,
  roundsToDo,
  runDistanceM,
  runTitle,
  scaledStationDistanceM,
  scaledWallBallReps,
  segmentDurations,
  segmentTitle,
  splitIconKey,
  stationMeters,
  stationWeightKg,
  type Race,
  type Split,
} from '../hyrox';
import { DEFAULT_UNITS, resolveUnits } from '../units';

// -- the website's own code, run against ours ------------------------------------------------------------------------------------------

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'static', 'hyrox.js'), 'utf8');

/** The text of `source` from `from` up to (not including) `to`. */
function slice(from: string, to: string): string {
  const start = SOURCE.indexOf(from);
  const end = SOURCE.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`cannot find ${from} .. ${to} in static/hyrox.js`);
  return SOURCE.slice(start, end);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const site: any = new Function(
  't',
  `${slice('const STATIONS = [', '  // ---------- Custom race builder')}
   ${slice('const PRO_ADJUSTABLE_STATIONS', 'const FACILITY_LANE_KEY')}
   ${slice('const RUN_DISTANCE_M', '  // Distance/weight formatting below')}
   ${slice('const FLAG_THRESHOLD_SECONDS', 'const PB_BOARD_LIMIT')}
   ${slice('function formatClock(', '  function el(html)')}
   function profileGender(profile) { if (!profile || !profile.gender) return null; return profile.gender === "female" ? "women" : "men"; }
   return { STATIONS, STATION_SPECS, STATION_ORDER, PRO_ADJUSTABLE_STATIONS, RUN_DISTANCE_M, runDistanceM, scaledStationDistanceM, scaledWallBallReps, scaledDistanceM,
            totalRoundUnits, getDefaultStationWeightKg, FLAG_THRESHOLD_SECONDS, formatClock, formatClockPrecise, profileGender };`,
)((key: string) => key);

describe('against the website', () => {
  it('the race is the same sixteen segments in the same order', () => {
    expect(STATIONS).toEqual(site.STATIONS);
    expect(STATION_KEYS).toEqual(site.STATION_ORDER);
  });

  it('the standards are the same numbers', () => {
    // The website keeps a free-text note beside some of them (shown in its own page); the numbers are what is compared.
    const withoutNotes = Object.fromEntries(Object.entries(site.STATION_SPECS as Record<string, Record<string, unknown>>).map(([key, spec]) => [key, Object.fromEntries(Object.entries(spec).filter(([field]) => field !== 'note'))]));
    expect(STATION_SPECS).toEqual(withoutNotes);
  });

  it('a Half race halves distances and wall-ball reps, the same as the website', () => {
    expect(RUN_DISTANCE_M).toBe(site.RUN_DISTANCE_M);
    for (const scale of SCALES) {
      expect(runDistanceM(scale)).toBe(site.runDistanceM(scale));
      for (const key of STATION_KEYS) expect(scaledStationDistanceM(key, scale)).toBe(site.scaledStationDistanceM(key, scale) ?? null);
      for (const gender of GENDERS) expect(scaledWallBallReps(gender, scale)).toBe(site.scaledWallBallReps(gender, scale));
    }
  });

  it('weights and the number of rounds in a lane are the same', () => {
    for (const gender of GENDERS) for (const category of CATEGORIES) for (const key of STATION_KEYS) expect(stationWeightKg(key, gender, category)).toBe(site.getDefaultStationWeightKg(key, gender, category));
    for (const scale of SCALES) {
      for (const lane of [1, 2.5, 10, 12.5, 25, 33, 400]) {
        for (const key of site.PRO_ADJUSTABLE_STATIONS) expect(roundsFor(key, scale, lane)).toBe(site.totalRoundUnits(key, lane, scale));
      }
    }
  });

  it('a lighter weight scales the distance the same way, for every weight, with and without quantising', () => {
    expect([...ROUND_STATIONS]).toEqual(site.PRO_ADJUSTABLE_STATIONS);
    for (const [distance, standard] of [[50, 202], [50, 152], [200, 32], [100, 30], [25, 78]]) {
      for (let weight = 0; weight <= standard + 5; weight += 3.7) {
        expect(scaledDistanceM(distance, standard, weight, 12.5)).toBe(site.scaledDistanceM(distance, standard, weight, 12.5));
        expect(scaledDistanceM(distance, standard, weight, null)).toBe(site.scaledDistanceM(distance, standard, weight, null));
      }
    }
  });

  it('the flag thresholds are the same', () => {
    expect(FLAG_THRESHOLD_SECONDS).toEqual(site.FLAG_THRESHOLD_SECONDS);
  });

  it('clocks read the same for every second up to a day, and for odd numbers', () => {
    for (let s = 0; s <= 90_000; s += 37) {
      expect(formatClock(s)).toBe(site.formatClock(s));
      expect(formatClockPrecise(s)).toBe(site.formatClockPrecise(s));
    }
    for (const s of [-5, 0.9, 59.99, 3599.5, 3600, 359_999, NaN]) {
      expect(formatClock(s)).toBe(site.formatClock(s));
      expect(formatClockPrecise(s)).toBe(site.formatClockPrecise(s));
    }
  });

  it('the profile gender maps the same way', () => {
    expect(profileGender('female')).toBe(site.profileGender({ gender: 'female' }));
    expect(profileGender('male')).toBe(site.profileGender({ gender: 'male' }));
    expect(profileGender(null)).toBe(site.profileGender({}));
    expect(profileGender(undefined)).toBe(site.profileGender(null));
  });
});

// -- the rules ---------------------------------------------------------------------------------------------------------------------------

describe('the choices', () => {
  it('are the website’s', () => {
    expect([...CATEGORIES]).toEqual(['open', 'pro']);
    expect([...FORMATS]).toEqual(['singles', 'doubles']);
    expect([...GENDERS]).toEqual(['men', 'women']);
    expect([...SCALES]).toEqual(['full', 'half']);
    expect(PB_BOARD_LIMIT).toBe(5);
    expect(DEFAULT_LANE_M).toBe(12.5);
  });

  it('stations and runs alternate, a run first', () => {
    expect(STATIONS).toHaveLength(16);
    STATIONS.forEach((s, i) => expect(s.type).toBe(i % 2 === 0 ? 'run' : 'station'));
    expect(STATION_KEYS).toHaveLength(8);
  });
});

describe('what a station asks', () => {
  it('rounds are laps of the lane, at least one, rounded up', () => {
    expect(roundsFor('sledPush', 'full', 12.5)).toBe(4);
    expect(roundsFor('sledPush', 'half', 12.5)).toBe(2);
    expect(roundsFor('farmersCarry', 'full', 12.5)).toBe(16);
    expect(roundsFor('lunges', 'full', 33)).toBe(4);
    expect(roundsFor('sledPull', 'full', 500)).toBe(1);
    expect(roundsFor('wallBalls', 'full', 12.5)).toBeNull();
    expect(roundsFor('nope', 'full', 12.5)).toBeNull();
  });

  it('an odd number of rounds rounds up for you, as the website’s even split does', () => {
    expect(roundsFor('sledPush', 'full', 10)).toBe(5);
    expect(roundsToDo('sledPush', 'doubles', 'full', 10)).toBe(3);
    expect(roundsFor('lunges', 'full', 40)).toBe(3);
    expect(roundsToDo('lunges', 'doubles', 'full', 40)).toBe(2);
    expect(roundsToDo('sledPush', 'doubles', 'full', 50)).toBe(1);
    expect(roundsToDo('sledPush', 'doubles', 'full', 25)).toBe(1);
    expect(roundsToDo('sledPush', 'doubles', 'full', 20)).toBe(2);
  });

  it('a Doubles pair does the same total, so you do half, at least one', () => {
    expect(roundsToDo('sledPush', 'singles', 'full', 12.5)).toBe(4);
    expect(roundsToDo('sledPush', 'doubles', 'full', 12.5)).toBe(2);
    expect(roundsToDo('farmersCarry', 'doubles', 'full', 12.5)).toBe(8);
    expect(roundsToDo('sledPull', 'doubles', 'full', 500)).toBe(1);
    expect(roundsToDo('lunges', 'doubles', 'half', 12.5)).toBe(2);
  });

  it('a station that is not shared between partners is all yours, and wall balls have no rounds', () => {
    expect(roundsToDo('burpeeBroadJump', 'doubles', 'full', 12.5)).toBe(7);
    expect(roundsToDo('wallBalls', 'doubles', 'full', 12.5)).toBeNull();
    expect(roundsToDo('sledPush', null, 'full', 12.5)).toBe(4);
  });

  it('weights are per category and gender, none where there is nothing to carry', () => {
    expect(stationWeightKg('sledPush', 'men', 'pro')).toBe(202);
    expect(stationWeightKg('sledPull', 'women', 'open')).toBe(78);
    expect(stationWeightKg('farmersCarry', 'men', 'open')).toBe(24);
    expect(stationWeightKg('lunges', 'women', 'pro')).toBe(20);
    for (const key of ['skierg', 'row', 'burpeeBroadJump', 'wallBalls', 'nope']) expect(stationWeightKg(key, 'men', 'open')).toBeNull();
  });
});

describe('the lane', () => {
  it.each([
    ['12', 12],
    [12.456, 12.46],
    ['0.2', 1],
    ['9999', 500],
    [' 8 ', 8],
  ])('%j -> %j', (value, expected) => {
    expect(cleanLane(value)).toBe(expected);
  });

  it.each([[''], ['abc'], [0], [-3], [NaN], [null], [undefined], [Infinity]])('%j is the default lane', (value) => {
    expect(cleanLane(value)).toBeNull();
  });

  it('the default is used until there is one', () => {
    expect(laneOrDefault(null)).toBe(12.5);
    expect(laneOrDefault(undefined)).toBe(12.5);
    expect(laneOrDefault(0)).toBe(12.5);
    expect(laneOrDefault(20)).toBe(20);
    expect(laneOrDefault(0.5)).toBe(0.5);
  });
});

describe('titles', () => {
  it('a run is its distance in the person’s unit', () => {
    expect(runTitle('full', DEFAULT_UNITS)).toBe('1km Run');
    expect(runTitle('half', DEFAULT_UNITS)).toBe('0.5km Run');
    expect(runTitle('full', resolveUnits({ distance: 'm' }))).toBe('1000m Run');
  });

  it('a station is its name', () => {
    expect(segmentTitle(STATIONS[1], 'full', DEFAULT_UNITS)).toBe('SkiErg');
    expect(segmentTitle(STATIONS[0], 'half', DEFAULT_UNITS)).toBe('0.5km Run');
    expect(segmentTitle({ type: 'station', key: 'mystery' }, 'full', DEFAULT_UNITS)).toBe('mystery');
  });

  it('station distances are always metres', () => {
    expect(stationMeters(50)).toBe('50m');
    expect(stationMeters(12.5)).toBe('12.5m');
  });

  it('every run shares one pictogram', () => {
    expect(splitIconKey('run3')).toBe('run');
    expect(splitIconKey('run')).toBe('run');
    expect(splitIconKey('row')).toBe('row');
    expect(splitIconKey('skierg')).toBe('skierg');
  });
});

// -- races ---------------------------------------------------------------------------------------------------------------------------

const race = (over: Partial<Race> = {}): Race => ({
  id: 'r1', date: '2026-10-01T08:00:00.000Z', category: 'open', format: 'singles', gender: 'men', scale: 'full', totalSeconds: 4000, splits: [], flagged: false, isNewPb: false, analysis: null, ...over,
});

describe('flagging', () => {
  it('a time at or under the threshold is flagged', () => {
    expect(isFlagged(3000, 'singles', 'men')).toBe(true);
    expect(isFlagged(3001, 'singles', 'men')).toBe(false);
    expect(isFlagged(3180, 'singles', 'women')).toBe(true);
    expect(isFlagged(3181, 'singles', 'women')).toBe(false);
    expect(isFlagged(2820, 'doubles', 'men')).toBe(true);
    expect(isFlagged(3060, 'doubles', 'women')).toBe(true);
    expect(isFlagged(3061, 'doubles', 'women')).toBe(false);
  });

  it('the key is gender | format', () => {
    expect(flagKey('singles', 'men')).toBe('men|singles');
  });
});

describe('personal bests', () => {
  const history = [
    race({ id: 'a', totalSeconds: 4200 }),
    race({ id: 'b', totalSeconds: 3900, date: '2026-10-05T08:00:00.000Z' }),
    race({ id: 'c', totalSeconds: 3500, flagged: true }),
    race({ id: 'd', totalSeconds: 3000, category: 'custom', format: null, gender: null }),
    race({ id: 'e', totalSeconds: 4500, category: 'pro' }),
    race({ id: 'f', totalSeconds: 2000, scale: 'half' }),
    race({ id: 'g', totalSeconds: 4100, format: 'doubles', date: '2026-10-09T08:00:00.000Z' }),
  ];

  it('the key includes the length, defaulting to full', () => {
    expect(pbKey('open', 'singles', 'men', 'half')).toBe('open|singles|men|half');
    expect(pbKey('open', 'singles', 'men', undefined)).toBe('open|singles|men|full');
    expect(pbKey('open', 'singles', 'men', '')).toBe('open|singles|men|full');
  });

  it('is the fastest of an exact combo, ignoring flagged and hand-built races', () => {
    expect(personalBest(history, 'open', 'singles', 'men', 'full')?.id).toBe('b');
    expect(personalBest(history, 'open', 'singles', 'men', 'half')?.id).toBe('f');
    expect(personalBest(history, 'pro', 'singles', 'men', 'full')?.id).toBe('e');
    expect(personalBest(history, 'open', 'doubles', 'men', 'full')?.id).toBe('g');
    expect(personalBest(history, 'open', 'singles', 'women', 'full')).toBeNull();
    expect(personalBest(history, 'custom', null, null, 'full')).toBeNull();
  });

  it('all of them, fastest first', () => {
    expect(allPersonalBests(history).map((r) => r.id)).toEqual(['f', 'b', 'g', 'e']);
    expect(allPersonalBests([])).toEqual([]);
  });

  it('boards: one per combo, the one with most races first, then the most recent', () => {
    const boards = pbBoards(history);
    expect(boards.map((b) => b.key)).toEqual(['open|singles|men|full', 'open|doubles|men|full', 'pro|singles|men|full', 'open|singles|men|half']);
    expect(boards[0].entries.map((r) => r.id)).toEqual(['b', 'a']);
    expect(boards[0].latest).toBe(new Date('2026-10-05T08:00:00.000Z').getTime());
    expect(boards[1].latest).toBeGreaterThan(boards[2].latest); // the doubles board was raced most recently
    expect(boards[2].latest).toBe(boards[3].latest); // an exact tie keeps the order the races were first seen in
  });

  it('a board is made of what counts only', () => {
    expect(pbBoards([race({ flagged: true }), race({ category: 'custom' })])).toEqual([]);
  });

  it('at the same time, the race that set it first keeps the record', () => {
    const early = race({ id: 'early', totalSeconds: 4000, date: '2026-09-01T08:00:00.000Z' });
    const late = race({ id: 'late', totalSeconds: 4000, date: '2026-10-01T08:00:00.000Z' });
    expect(personalBest([late, early], 'open', 'singles', 'men', 'full')?.id).toBe('early');
    expect(personalBest([early, late], 'open', 'singles', 'men', 'full')?.id).toBe('early');
    expect(allPersonalBests([late, early])[0].id).toBe('early');
    expect(pbBoards([late, early])[0].entries.map((r) => r.id)).toEqual(['early', 'late']);
  });

  it('a board names a missing length "full", and a date it cannot read counts as the oldest', () => {
    const [board] = pbBoards([race({ scale: '', date: 'garbage' })]);
    expect(board.scale).toBe('full');
    expect(board.latest).toBe(0);
    expect(pbBoards([race({ date: 'garbage' }), race({ id: 'x', date: '2026-10-05T08:00:00.000Z' })])[0].latest).toBe(new Date('2026-10-05T08:00:00.000Z').getTime());
  });

  it('newest first', () => {
    expect(newestFirst(history).map((r) => r.id)).toEqual(['g', 'b', 'a', 'c', 'd', 'e', 'f']);
  });
});

describe('a race just finished', () => {
  const setup = { category: 'open', format: 'singles', gender: 'men', scale: 'full' } as const;
  const splits: Split[] = [{ key: 'run1', title: '1km Run', atSeconds: 300 }];

  it('is the first of its combo: a new best', () => {
    const done = finishedRace(setup, splits, 4000, [], 'id1', '2026-10-27T08:00:00.000Z');
    expect(done).toEqual({ id: 'id1', date: '2026-10-27T08:00:00.000Z', category: 'open', format: 'singles', gender: 'men', scale: 'full', totalSeconds: 4000, splits, flagged: false, isNewPb: true, analysis: null });
  });

  it('is a new best only when faster than the old one', () => {
    const history = [race({ totalSeconds: 4000 })];
    expect(finishedRace(setup, splits, 3999, history, 'i', 'd').isNewPb).toBe(true);
    expect(finishedRace(setup, splits, 4000, history, 'i', 'd').isNewPb).toBe(false);
    expect(finishedRace(setup, splits, 4500, history, 'i', 'd').isNewPb).toBe(false);
  });

  it('another combo’s best does not count', () => {
    expect(finishedRace(setup, splits, 4500, [race({ category: 'pro', totalSeconds: 3600 })], 'i', 'd').isNewPb).toBe(true);
    expect(finishedRace(setup, splits, 4500, [race({ scale: 'half', totalSeconds: 2000 })], 'i', 'd').isNewPb).toBe(true);
  });

  it('a flagged time is kept but is never a best, nor compared against', () => {
    const flagged = finishedRace(setup, splits, 2000, [], 'i', 'd');
    expect(flagged).toMatchObject({ flagged: true, isNewPb: false });
    expect(finishedRace(setup, splits, 4000, [flagged], 'i2', 'd').isNewPb).toBe(true);
  });
});

describe('where the time went', () => {
  const splits: Split[] = [
    { key: 'run1', title: '1km Run', atSeconds: 300 },
    { key: 'skierg', title: 'SkiErg', atSeconds: 540 },
    { key: 'run2', title: '1km Run', atSeconds: 850 },
    { key: 'sledPush', title: 'Sled Push', atSeconds: 960 },
  ];

  it('is the gap from the segment before', () => {
    expect(segmentDurations({ splits })).toEqual([
      { key: 'run1', title: '1km Run', type: 'run', seconds: 300 },
      { key: 'skierg', title: 'SkiErg', type: 'station', seconds: 240 },
      { key: 'run2', title: '1km Run', type: 'run', seconds: 310 },
      { key: 'sledPush', title: 'Sled Push', type: 'station', seconds: 110 },
    ]);
    expect(segmentDurations({ splits: [] })).toEqual([]);
  });

  it('totals the runs and the stations', () => {
    expect(breakdownTotals(segmentDurations({ splits }))).toEqual({ running: 610, stations: 350 });
    expect(breakdownTotals([])).toEqual({ running: 0, stations: 0 });
  });

  it('a hand-built race’s plain "run" is a run too', () => {
    expect(segmentDurations({ splits: [{ key: 'run', title: 'Run', atSeconds: 60 }] })[0].type).toBe('run');
  });
});

describe('what goes on the leaderboard', () => {
  it('a full race that counts', () => {
    expect(leaderboardResult(race())).toEqual({ gender: 'men', category: 'open', format: 'singles', total_seconds: 4000 });
  });

  it.each([
    ['flagged', { flagged: true }],
    ['half length', { scale: 'half' }],
    ['hand built', { category: 'custom' }],
    ['no gender', { gender: null }],
    ['no format', { format: null }],
  ])('not a %s race', (_name, over) => {
    expect(leaderboardResult(race(over as Partial<Race>))).toBeNull();
  });
});

describe('the boards', () => {
  it('are Open and Pro, Singles and Doubles, Singles first', () => {
    expect(BOARD_TABS.map((t) => `${t.category}|${t.format}`)).toEqual(['open|singles', 'pro|singles', 'open|doubles', 'pro|doubles']);
  });
});

describe('the AI’s read, as kept on a race', () => {
  const stored = {
    overall: 'Strong runs.',
    overallDetail: ['Even pacing.', '', 7, 'Sled cost time.'],
    tips: [
      { key: 'sledPush', tip: 'Drive lower.', rating: 'focus', detail: ['Hips down.'] },
      { key: 'skierg', tip: 'Great pacing.', rating: 'strong' },
      { key: 'row', tip: 'Fine.', rating: 'weird', detail: 'not a list' },
      { key: 'lunges', tip: '   ', rating: 'focus' },
      { key: 5, tip: 'no key', rating: 'focus' },
      { tip: 'no key either' },
      null,
    ],
  };

  it('is read as the website stores it: bullets that are text, tips that say something, ratings it knows', () => {
    expect(analysisFromJson(stored)).toEqual({
      overall: 'Strong runs.',
      overallDetail: ['Even pacing.', 'Sled cost time.'],
      tips: [
        { key: 'sledPush', tip: 'Drive lower.', rating: 'focus', detail: ['Hips down.'] },
        { key: 'skierg', tip: 'Great pacing.', rating: 'strong', detail: [] },
        { key: 'row', tip: 'Fine.', rating: 'solid', detail: [] },
      ],
    });
  });

  it('an overall of nothing is still a read, so long as it is text', () => {
    expect(analysisFromJson({ overall: '' })).toEqual({ overall: '', overallDetail: [], tips: [] });
    expect(analysisFromJson({ overall: 'x', tips: 'nope' })).toEqual({ overall: 'x', overallDetail: [], tips: [] });
  });

  it.each([[null], [undefined], ['x'], [5], [[]], [{}], [{ overall: 3 }]])('%j is not a read', (value) => {
    expect(analysisFromJson(value)).toBeNull();
  });

  it('groups the tips with the biggest gains first, leaving out an empty group', () => {
    const tips = analysisFromJson(stored)?.tips ?? [];
    expect(tipGroups(tips).map((g) => [g.rating, g.tips.map((t) => t.key)])).toEqual([['focus', ['sledPush']], ['strong', ['skierg']], ['solid', ['row']]]);
    expect(tipGroups(tips.filter((t) => t.rating === 'strong')).map((g) => g.rating)).toEqual(['strong']);
    expect(tipGroups([])).toEqual([]);
  });

  it('ratings by station, none without a read', () => {
    expect(ratingsByKey(analysisFromJson(stored))).toEqual({ sledPush: 'focus', skierg: 'strong', row: 'solid' });
    expect(ratingsByKey(null)).toEqual({});
  });

  it('only a real, counting race can be coached', () => {
    expect(canAnalyze({ flagged: false, category: 'open' })).toBe(true);
    expect(canAnalyze({ flagged: true, category: 'open' })).toBe(false);
    expect(canAnalyze({ flagged: false, category: 'custom' })).toBe(false);
  });
});

describe('practice: a lighter weight in Pro Singles', () => {
  it('is whatever was typed, held between a tenth of the standard and the standard, to 0.1 kg', () => {
    expect(practiceWeight('150', 202)).toBe(150);
    expect(practiceWeight('150.46', 202)).toBe(150.5);
    expect(practiceWeight('250', 202)).toBe(202);
    expect(practiceWeight('5', 202)).toBe(20.2);
    expect(practiceWeight(30, 152)).toBe(30);
  });

  it('a weight under a tenth of the standard is held at a tenth of it, one just above zero too', () => {
    expect(practiceWeight('0.5', 202)).toBe(20.2);
    expect(practiceWeight('0.01', 152)).toBe(15.2);
  });

  it.each([[''], ['abc'], [0], [-5], [NaN], [null], [undefined]])('%j is the standard', (raw) => {
    expect(practiceWeight(raw, 152)).toBe(152);
  });

  it('applies only to Pro Singles, and only to a weight lighter than the standard that was chosen', () => {
    const practice = { weights: { sledPush: 100, lunges: 40, farmersCarry: 0, sledPull: -3 }, doubles: {} };
    expect(sessionWeightKg('sledPush', 'men', 'pro', 'singles', practice)).toBe(100);
    expect(sessionWeightKg('sledPush', 'men', 'pro', 'doubles', practice)).toBe(202);
    expect(sessionWeightKg('sledPush', 'men', 'open', 'singles', practice)).toBe(152);
    expect(sessionWeightKg('lunges', 'men', 'pro', 'singles', practice)).toBe(30); // heavier than the standard: ignored
    expect(sessionWeightKg('farmersCarry', 'men', 'pro', 'singles', practice)).toBe(32);
    expect(sessionWeightKg('sledPull', 'men', 'pro', 'singles', practice)).toBe(152);
    expect(sessionWeightKg('skierg', 'men', 'pro', 'singles', practice)).toBeNull();
    expect(sessionWeightKg('sledPush', 'men', 'pro', 'singles', NO_PRACTICE)).toBe(202);
  });

  it('a chosen weight just above zero is still the chosen weight', () => {
    expect(sessionWeightKg('sledPush', 'men', 'pro', 'singles', { weights: { sledPush: 0.5 }, doubles: {} })).toBe(0.5);
    expect(sessionWeightKg('sledPush', 'men', 'pro', 'singles', { weights: { sledPush: 202 }, doubles: {} })).toBe(202);
  });

  it('makes the laps longer to match: half the weight, about double the laps', () => {
    expect(roundsFor('sledPush', 'full', 12.5, { standardKg: 202, currentKg: 202 })).toBe(4);
    expect(roundsFor('sledPush', 'full', 12.5, { standardKg: 202, currentKg: 101 })).toBe(8);
    expect(roundsFor('farmersCarry', 'full', 12.5, { standardKg: 32, currentKg: 16 })).toBe(32);
    expect(roundsFor('lunges', 'full', 12.5, { standardKg: 30, currentKg: 20 })).toBe(12);
    expect(roundsFor('sledPush', 'full', 12.5, { standardKg: 202, currentKg: 250 })).toBe(4); // heavier never shortens it
  });

  it('keeps a sled to whole segments but not a carry: the odd weights where that matters', () => {
    expect(roundsFor('sledPush', 'full', 10, { standardKg: 202, currentKg: 150 })).toBe(8); // 67.3 m -> 75 m of segments -> 8 laps of 10 m
    expect(roundsFor('lunges', 'full', 10, { standardKg: 30, currentKg: 17 })).toBe(18); // 176.5 m exact -> 18 laps of 10 m
    expect(roundsFor('sledPull', 'full', 10, { standardKg: 152, currentKg: 101 })).toBe(9); // 75.25 m -> 87.5 m of segments, where exact would be 8
    expect(roundsFor('farmersCarry', 'full', 10, { standardKg: 32, currentKg: 21 })).toBe(31);
  });

  it('is shown as the rounds to do', () => {
    const practice = { weights: { sledPush: 101 }, doubles: {} };
    expect(roundsToDo('sledPush', 'singles', 'full', 12.5, practice, 'men', 'pro')).toBe(8);
    expect(roundsToDo('sledPush', 'singles', 'full', 12.5, NO_PRACTICE, 'men', 'pro')).toBe(4);
    expect(roundsToDo('sledPush', 'singles', 'full', 12.5, practice)).toBe(4); // without who it is for, the standard
    expect(roundsToDo('sledPush', 'singles', 'full', 12.5, practice, 'men')).toBe(4); // half of who it is for is not enough either
    expect(roundsToDo('sledPush', 'singles', 'full', 12.5, practice, undefined, 'pro')).toBe(4);
  });
});

describe('practice: a Doubles split', () => {
  it('starts as half, the partner has the rest', () => {
    expect(doublesShare('sledPush', 'full', 12.5, undefined)).toEqual({ total: 4, mine: 2, partner: 2 });
    expect(doublesShare('farmersCarry', 'full', 12.5, undefined)).toEqual({ total: 16, mine: 8, partner: 8 });
    expect(doublesShare('lunges', 'full', 40, undefined)).toEqual({ total: 3, mine: 2, partner: 1 });
  });

  it('is the person’s own when it is a number from none to all', () => {
    expect(doublesShare('sledPush', 'full', 12.5, 3)).toEqual({ total: 4, mine: 3, partner: 1 });
    expect(doublesShare('sledPush', 'full', 12.5, 0)).toEqual({ total: 4, mine: 0, partner: 4 });
    expect(doublesShare('sledPush', 'full', 12.5, 4)).toEqual({ total: 4, mine: 4, partner: 0 });
    expect(doublesShare('sledPush', 'full', 12.5, 5)).toEqual({ total: 4, mine: 2, partner: 2 });
    expect(doublesShare('sledPush', 'full', 12.5, -1)).toEqual({ total: 4, mine: 2, partner: 2 });
  });

  it('follows the length of the race and the lane', () => {
    expect(doublesShare('sledPush', 'half', 12.5, undefined)).toEqual({ total: 2, mine: 1, partner: 1 });
    expect(doublesShare('sledPush', 'full', 500, undefined)).toEqual({ total: 1, mine: 1, partner: 0 });
  });

  it('only for the stations that are done in rounds', () => {
    for (const key of ['skierg', 'row', 'burpeeBroadJump', 'wallBalls', 'nope']) expect(doublesShare(key, 'full', 12.5, undefined)).toBeNull();
  });

  it('numbers as typed: whole, from none to the total', () => {
    expect(cleanRounds('3', 4)).toBe(3);
    expect(cleanRounds('2.6', 4)).toBe(3);
    expect(cleanRounds('9', 4)).toBe(4);
    expect(cleanRounds('-2', 4)).toBe(0);
    expect(cleanRounds('abc', 4)).toBe(0);
    expect(cleanRounds('', 4)).toBe(0);
  });

  it('your share of the rounds is what the race shows, never fewer than one', () => {
    expect(roundsToDo('sledPush', 'doubles', 'full', 12.5, { weights: {}, doubles: { sledPush: 3 } })).toBe(3);
    expect(roundsToDo('sledPush', 'doubles', 'full', 12.5, { weights: {}, doubles: { sledPush: 0 } })).toBe(1);
    expect(roundsToDo('farmersCarry', 'doubles', 'full', 12.5, { weights: {}, doubles: { farmersCarry: 12 } })).toBe(12);
    expect(roundsToDo('sledPush', 'singles', 'full', 12.5, { weights: {}, doubles: { sledPush: 3 } })).toBe(4); // a Singles race ignores a split
  });
});

describe('practice follows the setup', () => {
  const was = { category: 'pro', format: 'singles', gender: 'men', scale: 'full' };
  const practice = { weights: { sledPush: 100 }, doubles: { sledPush: 3 } };

  it('is kept while nothing it depends on changes', () => {
    expect(practiceAfter(was, { ...was }, practice)).toBe(practice);
  });

  it('weights go with a change of category or gender, not of format or length', () => {
    expect(practiceAfter(was, { ...was, category: 'open' }, practice).weights).toEqual({});
    expect(practiceAfter(was, { ...was, gender: 'women' }, practice).weights).toEqual({});
    expect(practiceAfter(was, { ...was, format: 'doubles' }, practice).weights).toEqual({ sledPush: 100 });
    expect(practiceAfter(was, { ...was, scale: 'half' }, practice).weights).toEqual({ sledPush: 100 });
  });

  it('the split goes with a change of format or length, not of category or gender', () => {
    expect(practiceAfter(was, { ...was, format: 'doubles' }, practice).doubles).toEqual({});
    expect(practiceAfter(was, { ...was, scale: 'half' }, practice).doubles).toEqual({});
    expect(practiceAfter(was, { ...was, category: 'open' }, practice).doubles).toEqual({ sledPush: 3 });
    expect(practiceAfter(was, { ...was, gender: 'women' }, practice).doubles).toEqual({ sledPush: 3 });
  });

  it('has practice once anything has been moved', () => {
    expect(hasPractice(NO_PRACTICE)).toBe(false);
    expect(hasPractice({ weights: { a: 1 }, doubles: {} })).toBe(true);
    expect(hasPractice({ weights: {}, doubles: { a: 1 } })).toBe(true);
  });
});

describe('a race built by hand', () => {
  let counter = 0;
  const id = () => `b${(counter += 1)}`;
  const three = () => [
    { id: 'a', key: 'run' as const, amount: 1000 },
    { id: 'b', key: 'sledPush' as const, amount: 50 },
    { id: 'c', key: 'wallBalls' as const, amount: 75 },
  ];

  it('has nine kinds of block, in four groups', () => {
    expect([...CUSTOM_KEYS]).toEqual(['run', 'skierg', 'sledPush', 'sledPull', 'burpeeBroadJump', 'row', 'farmersCarry', 'lunges', 'wallBalls']);
    expect(CUSTOM_PICKER.map((g) => g.key)).toEqual(['cardio', 'sled', 'carry', 'explosive']);
    expect(CUSTOM_PICKER.flatMap((g) => [...g.keys]).sort()).toEqual([...CUSTOM_KEYS].sort());
    expect([...CUSTOM_ROUND_KEYS]).toEqual(['sledPush', 'sledPull', 'burpeeBroadJump', 'farmersCarry', 'lunges']);
  });

  it('a block starts at a kilometre, the real distance, or 75 reps', () => {
    expect(customDefaultAmount('run')).toBe(1000);
    expect(customDefaultAmount('skierg')).toBe(1000);
    expect(customDefaultAmount('sledPush')).toBe(50);
    expect(customDefaultAmount('farmersCarry')).toBe(200);
    expect(customDefaultAmount('burpeeBroadJump')).toBe(80);
    expect(customDefaultAmount('wallBalls')).toBe(CUSTOM_WALL_BALL_REPS);
    expect(CUSTOM_WALL_BALL_REPS).toBe(75);
  });

  it('is named as the website names it', () => {
    expect(customTitle('run')).toBe('Run');
    expect(customTitle('wallBalls')).toBe('Wall Balls');
    expect(customTitle('row')).toBe('Rowing');
    expect(customTitle('mystery')).toBe('mystery');
  });

  it('starts as the whole standard race, a block each, with its own ids', () => {
    const race = defaultCustomRace(id);
    expect(race).toHaveLength(16);
    expect(race.map((b) => b.key).slice(0, 4)).toEqual(['run', 'skierg', 'run', 'sledPush']);
    expect(new Set(race.map((b) => b.id)).size).toBe(16);
    expect(race[15]).toMatchObject({ key: 'wallBalls', amount: 75 });
    expect(race[0]).toMatchObject({ key: 'run', amount: 1000 });
  });

  it('amounts as typed: the default for nothing sensible, reps whole, distances to a tenth', () => {
    expect(cleanCustomAmount('run', '5000')).toBe(5000);
    expect(cleanCustomAmount('run', '1.26')).toBe(1.3);
    expect(cleanCustomAmount('wallBalls', '30.6')).toBe(31);
    expect(cleanCustomAmount('wallBalls', '0.4')).toBe(1);
    expect(cleanCustomAmount('skierg', '0.01')).toBe(0.1);
    for (const raw of ['', 'abc', 0, -4, NaN, null, undefined]) {
      expect(cleanCustomAmount('sledPull', raw)).toBe(50);
      expect(cleanCustomAmount('wallBalls', raw)).toBe(75);
    }
  });

  it('blocks are added at the end, removed by id, and an amount is set on one', () => {
    expect(addBlock(three(), 'lunges', 'z').map((b) => [b.id, b.key, b.amount]).slice(3)).toEqual([['z', 'lunges', 100]]);
    expect(removeBlock(three(), 'b').map((b) => b.id)).toEqual(['a', 'c']);
    expect(removeBlock(three(), 'nope')).toHaveLength(3);
    expect(setBlockAmount(three(), 'b', '75').map((b) => b.amount)).toEqual([1000, 75, 75]);
    expect(setBlockAmount(three(), 'b', 'x')[1].amount).toBe(50);
    expect(setBlockAmount(three(), 'nope', '9').map((b) => b.amount)).toEqual([1000, 50, 75]);
  });

  it('a block moves one place and stops at the ends', () => {
    expect(moveBlock(three(), 'b', -1).map((b) => b.id)).toEqual(['b', 'a', 'c']);
    expect(moveBlock(three(), 'b', 1).map((b) => b.id)).toEqual(['a', 'c', 'b']);
    expect(moveBlock(three(), 'a', -1).map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(moveBlock(three(), 'c', 1).map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(moveBlock(three(), 'nope', 1).map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });

  it('moving does not change what it was given', () => {
    const before = three();
    moveBlock(before, 'b', 1);
    removeBlock(before, 'b');
    setBlockAmount(before, 'b', '9');
    expect(before.map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(before[1].amount).toBe(50);
  });

  it('is run as segments carrying their amounts, runs as runs', () => {
    expect(customSequence(three())).toEqual([
      { type: 'run', key: 'run', title: 'Run', amount: 1000 },
      { type: 'station', key: 'sledPush', title: 'Sled Push', amount: 50 },
      { type: 'station', key: 'wallBalls', title: 'Wall Balls', amount: 75 },
    ]);
  });

  it('laps are of the lane, at least one', () => {
    expect(customLaps(50, 12.5)).toBe(4);
    expect(customLaps(60, 12.5)).toBe(5);
    expect(customLaps(1, 500)).toBe(1);
  });

  it('an amount is shown as reps or as metres', () => {
    expect(formatCustomAmount('wallBalls', 75)).toBe('75');
    expect(formatCustomAmount('sledPush', 50)).toBe('50m');
    expect(formatCustomAmount('run', 2500)).toBe('2500m');
  });

  it('when finished is never flagged, a best, or on a board', () => {
    const race = finishedCustomRace([{ key: 'run', title: 'Run', atSeconds: 60 }], 60, 'r1', '2026-10-28T08:00:00.000Z');
    expect(race).toEqual({ id: 'r1', date: '2026-10-28T08:00:00.000Z', category: 'custom', format: null, gender: null, scale: 'full', totalSeconds: 60, splits: [{ key: 'run', title: 'Run', atSeconds: 60 }], flagged: false, isNewPb: false, analysis: null });
    expect(leaderboardResult(race)).toBeNull();
    expect(canAnalyze(race)).toBe(false);
    expect(personalBest([race], 'custom', null, null, 'full')).toBeNull();
  });
});
