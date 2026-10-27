import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { Supabase } from '@/supabase/client';

import type { Race } from '../../logic/hyrox';
import { supabaseExecutor } from '../../store/executor';
import { Outbox, rowIdentity, type KeyValueStorage } from '../../store/outbox';
import { FakeDatabase } from '../../testing/fakeSupabase';
import { PAGE_SIZE, createData, type DataApi } from '../access';
import { DataContext, useHyroxPrefs, useHyroxRaces } from '../hooks';
import { keys } from '../keys';
import { hyroxPrefsFromRow, hyroxRaceFromRows, hyroxRaceToRow, hyroxSplitFromRow, hyroxSplitToRow, settingsRowWithHyrox, type Row } from '../mappers';
import { hyroxPrefsSave, hyroxRaceDelete, hyroxRaceSave } from '../ops';
import { overlayHyroxRaces } from '../overlay';

const U = 'user-1';

const race = (over: Partial<Race> = {}): Race => ({
  id: 'r1', date: '2026-10-20T08:00:00.000Z', category: 'open', format: 'singles', gender: 'men', scale: 'full', totalSeconds: 4000,
  splits: [{ key: 'run1', title: '1km Run', atSeconds: 300 }, { key: 'skierg', title: 'SkiErg', atSeconds: 540 }],
  flagged: false, isNewPb: true, analysis: null, ...over,
});
const raceRow = (over: Record<string, unknown> = {}) =>
  ({ user_id: U, id: 'r1', raced_at: '2026-10-20T08:00:00.000Z', category: 'open', format: 'singles', gender: 'men', scale: 'full', total_seconds: 4000, flagged: false, is_new_pb: true, analysis: null, extra: {}, ...over }) as Row<'hyrox_races'>;
const splitRow = (position: number, key: string, at: number, over: Record<string, unknown> = {}) =>
  ({ user_id: U, race_id: 'r1', position, key, title: key, at_seconds: at, extra: {}, ...over }) as Row<'hyrox_race_splits'>;

describe('the rows', () => {
  it('a race and its splits make a race, splits in order', () => {
    const made = hyroxRaceFromRows(raceRow(), [splitRow(1, 'skierg', 540), splitRow(0, 'run1', 300), splitRow(0, 'run1', 1, { race_id: 'other' })]);
    expect(made).toMatchObject({ id: 'r1', date: '2026-10-20T08:00:00.000Z', category: 'open', format: 'singles', gender: 'men', scale: 'full', totalSeconds: 4000, flagged: false, isNewPb: true, analysis: null });
    expect(made.splits.map((s) => [s.key, s.atSeconds])).toEqual([['run1', 300], ['skierg', 540]]);
  });

  it('a hand-built race has no format or gender', () => {
    expect(hyroxRaceFromRows(raceRow({ category: 'custom', format: null, gender: null }), [])).toMatchObject({ category: 'custom', format: null, gender: null });
  });

  it('a split with no title has an empty one', () => {
    expect(hyroxSplitFromRow(splitRow(0, 'run1', 5, { title: null })).title).toBe('');
  });

  it('what this version does not manage is carried through, on the race and on its splits', () => {
    const made = hyroxRaceFromRows(raceRow({ extra: { note: 'kept' }, analysis: { overall: 'ok' } }), [splitRow(0, 'run1', 5, { extra: { lap: 2 } })]);
    expect(made.extra).toEqual({ note: 'kept' });
    expect(made.analysis).toEqual({ overall: 'ok' });
    expect(made.splits[0].extra).toEqual({ lap: 2 });
    expect(hyroxRaceToRow(U, made).extra).toEqual({ note: 'kept' });
    expect(hyroxRaceToRow(U, made).analysis).toEqual({ overall: 'ok' });
    expect(hyroxSplitToRow(U, 'r1', 0, made.splits[0]).extra).toEqual({ lap: 2 });
  });

  it('is written whole, every column', () => {
    expect(hyroxRaceToRow(U, race())).toEqual(raceRow());
    expect(hyroxSplitToRow(U, 'r1', 3, { key: 'row', title: 'Rowing', atSeconds: 1200 })).toEqual({ user_id: U, race_id: 'r1', position: 3, key: 'row', title: 'Rowing', at_seconds: 1200, extra: {} });
  });
});

describe('the preferences', () => {
  const settings = (over: Record<string, unknown> = {}) =>
    ({ user_id: U, theme: 'dark', language: 'th', units_weight: 'lb', units_height: 'ftin', units_distance: 'm', units_clock: '24h', hyrox_leaderboard_gender: 'women', hyrox_facility_lane_m: 20, hyrox_history_backfilled: true, extra: { a: 1 }, ...over }) as Row<'user_settings'>;

  it('are the lane and the leaderboard gender', () => {
    expect(hyroxPrefsFromRow(settings())).toEqual({ laneM: 20, leaderboardGender: 'women' });
    expect(hyroxPrefsFromRow(null)).toEqual({ laneM: null, leaderboardGender: null });
    expect(hyroxPrefsFromRow(undefined)).toEqual({ laneM: null, leaderboardGender: null });
  });

  it.each([[0], [-1], [NaN], [null]])('a lane of %j is none', (lane) => {
    expect(hyroxPrefsFromRow(settings({ hyrox_facility_lane_m: lane })).laneM).toBeNull();
  });

  it('a gender that is not one is none', () => {
    expect(hyroxPrefsFromRow(settings({ hyrox_leaderboard_gender: 'x' })).leaderboardGender).toBeNull();
    expect(hyroxPrefsFromRow(settings({ hyrox_leaderboard_gender: 'men' })).leaderboardGender).toBe('men');
  });

  it('changing them leaves the rest of the settings row as it was', () => {
    const row = settingsRowWithHyrox(U, { laneM: 8, leaderboardGender: 'men' }, settings());
    expect(row).toMatchObject({ user_id: U, theme: 'dark', language: 'th', units_weight: 'lb', units_height: 'ftin', units_distance: 'm', units_clock: '24h', hyrox_facility_lane_m: 8, hyrox_leaderboard_gender: 'men', hyrox_history_backfilled: true, extra: { a: 1 } });
  });

  it('with no settings row yet, the rest is the defaults', () => {
    expect(settingsRowWithHyrox(U, { laneM: null, leaderboardGender: 'women' }, null)).toMatchObject({ user_id: U, theme: null, units_weight: 'kg', hyrox_leaderboard_gender: 'women', hyrox_facility_lane_m: null });
  });
});

describe('the operations', () => {
  it('a race is the race, its old splits cleared, then every split by position', () => {
    const ops = hyroxRaceSave(U, race());
    expect(ops.map((o) => [o.kind, o.table])).toEqual([['upsert', 'hyrox_races'], ['delete', 'hyrox_race_splits'], ['upsert', 'hyrox_race_splits'], ['upsert', 'hyrox_race_splits']]);
    expect(ops[1]).toMatchObject({ match: { user_id: U, race_id: 'r1' } });
    expect(ops.slice(2).map((o) => (o.kind === 'upsert' ? o.row.position : null))).toEqual([0, 1]);
  });

  it('removing a race is one delete (the splits go with it)', () => {
    expect(hyroxRaceDelete(U, 'r1')).toEqual({ kind: 'delete', table: 'hyrox_races', key: 'user_id,id', match: { user_id: U, id: 'r1' } });
  });

  it('saving the preferences is the same waiting write as saving the settings', () => {
    const op = hyroxPrefsSave(U, { laneM: 9, leaderboardGender: null }, null);
    expect(op).toMatchObject({ kind: 'upsert', table: 'user_settings', key: 'user_id' });
    expect(rowIdentity(op)).toBe(rowIdentity({ kind: 'upsert', table: 'user_settings', key: 'user_id', row: { user_id: U } }));
  });
});

describe('the overlay', () => {
  const other = race({ id: 'r2', date: '2026-10-25T08:00:00.000Z', splits: [{ key: 'run1', title: '1km Run', atSeconds: 100 }] });

  it('with nothing waiting is the races, newest first', () => {
    expect(overlayHyroxRaces([race(), other], []).map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('a waiting save files a new race', () => {
    const out = overlayHyroxRaces([race()], hyroxRaceSave(U, other));
    expect(out.map((r) => r.id)).toEqual(['r2', 'r1']);
    expect(out[0].splits).toEqual(other.splits);
  });

  it('a waiting save replaces a race and its splits, not adding to them', () => {
    const shorter = race({ totalSeconds: 3900, splits: [{ key: 'run1', title: '1km Run', atSeconds: 280 }] });
    const out = overlayHyroxRaces([race()], hyroxRaceSave(U, shorter));
    expect(out).toHaveLength(1);
    expect(out[0].totalSeconds).toBe(3900);
    expect(out[0].splits).toEqual([{ key: 'run1', title: '1km Run', atSeconds: 280 }]);
  });

  it('a waiting delete removes it', () => {
    expect(overlayHyroxRaces([race(), other], [hyroxRaceDelete(U, 'r1')]).map((r) => r.id)).toEqual(['r2']);
  });

  it('a save then a delete leaves nothing; a delete of what is not there changes nothing', () => {
    expect(overlayHyroxRaces([], [...hyroxRaceSave(U, other), hyroxRaceDelete(U, 'r2')])).toEqual([]);
    expect(overlayHyroxRaces([race()], [hyroxRaceDelete(U, 'nope')])).toHaveLength(1);
  });

  it('splits that arrive out of order are put in position order', () => {
    const [raceOp, clear, a, b] = hyroxRaceSave(U, other);
    void a;
    void b;
    const late = { kind: 'upsert' as const, table: 'hyrox_race_splits' as const, key: 'user_id,race_id,position', row: { user_id: U, race_id: 'r2', position: 2, key: 'row', title: 'Rowing', at_seconds: 300, extra: {} } };
    const early = { ...late, row: { ...late.row, position: 1, key: 'skierg', title: 'SkiErg', at_seconds: 200 } };
    const first = { ...late, row: { ...late.row, position: 0, key: 'run1', title: '1km Run', at_seconds: 100 } };
    expect(overlayHyroxRaces([], [raceOp, clear, late, first, early])[0].splits.map((s) => s.key)).toEqual(['run1', 'skierg', 'row']);
  });

  it('a split with no race is ignored', () => {
    const [, , split] = hyroxRaceSave(U, other);
    expect(overlayHyroxRaces([race()], [split])).toEqual([race()]);
  });
});

function memoryStorage(): KeyValueStorage {
  const store = new Map<string, string>();
  return { getItem: async (k) => store.get(k) ?? null, setItem: async (k, v) => void store.set(k, v), removeItem: async (k) => void store.delete(k) };
}

function setup() {
  const db = new FakeDatabase();
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  const outbox = new Outbox(memoryStorage(), supabaseExecutor(db.client() as unknown as Supabase));
  const api: DataApi = {
    listCustomFoods: async () => [], createCustomFood: jest.fn(), deleteCustomFood: jest.fn(), listCustomExercises: async () => [],
    createCustomExercise: jest.fn(), deleteCustomExercise: jest.fn(), activityDates: async () => ({}),
  };
  const layer = createData({ userId: U, reader: db.client(), outbox, queryClient, api, tzOffsetMinutes: () => 0, now: () => new Date(2026, 9, 27, 12) });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <DataContext.Provider value={{ data: layer, queue: outbox.pending() }}>{children}</DataContext.Provider>
    </QueryClientProvider>
  );
  return { db, queryClient, outbox, data: layer, wrapper };
}

describe('reading', () => {
  it('only this person’s races, with their splits, newest first', async () => {
    const { db, data } = setup();
    db.seed('hyrox_races', [raceRow(), raceRow({ id: 'r2', raced_at: '2026-10-25T08:00:00.000Z' }), raceRow({ user_id: 'user-2', id: 'x' })]);
    db.seed('hyrox_race_splits', [splitRow(0, 'run1', 300), splitRow(1, 'skierg', 540), splitRow(0, 'run1', 7, { user_id: 'user-2', race_id: 'x' })]);
    const races = await data.fetch.hyroxRaces();
    expect(races.map((r) => r.id)).toEqual(['r2', 'r1']);
    expect(races[1].splits.map((s) => s.key)).toEqual(['run1', 'skierg']);
    expect(races[0].splits).toEqual([]);
  });

  it('a long history is read a page at a time, not cut at one request', async () => {
    const { db, data } = setup();
    const total = PAGE_SIZE + 5;
    db.seed('hyrox_races', Array.from({ length: total }, (_, i) => raceRow({ id: `r${String(i).padStart(4, '0')}`, raced_at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString() })));
    db.seed('hyrox_race_splits', Array.from({ length: total }, (_, i) => splitRow(0, 'run1', i, { race_id: `r${String(i).padStart(4, '0')}` })));
    const races = await data.fetch.hyroxRaces();
    expect(races).toHaveLength(total);
    expect(races.every((r) => r.splits.length === 1)).toBe(true);
  });

  it('no races is an empty list', async () => {
    expect(await setup().data.fetch.hyroxRaces()).toEqual([]);
  });
});

describe('saving and removing', () => {
  it('a finished race is shown at once and then sent as the race and its splits', async () => {
    const { db, queryClient, outbox, data } = setup();
    queryClient.setQueryData<Race[]>(keys.hyroxRaces(U), []);
    await data.actions.saveHyroxRace(race());
    expect(queryClient.getQueryData<Race[]>(keys.hyroxRaces(U))?.map((r) => r.id)).toEqual(['r1']);
    await outbox.flush(U);
    expect(db.rows('hyrox_races')).toEqual([expect.objectContaining({ user_id: U, id: 'r1', total_seconds: 4000, is_new_pb: true })]);
    expect(db.rows('hyrox_race_splits').map((r) => [r.position, r.key])).toEqual([[0, 'run1'], [1, 'skierg']]);
  });

  it('a save made again before it was sent replaces the first, with no leftover splits', async () => {
    const { db, outbox, data } = setup();
    await data.actions.saveHyroxRace(race());
    await data.actions.saveHyroxRace(race({ splits: [{ key: 'run1', title: '1km Run', atSeconds: 250 }] }));
    await outbox.flush(U);
    expect(db.rows('hyrox_race_splits')).toHaveLength(1);
    expect(db.rows('hyrox_race_splits')[0].at_seconds).toBe(250);
  });

  it('a removed race leaves the cache, and the server', async () => {
    const { db, queryClient, outbox, data } = setup();
    db.seed('hyrox_races', [raceRow()]);
    db.seed('hyrox_race_splits', [splitRow(0, 'run1', 300)]);
    queryClient.setQueryData<Race[]>(keys.hyroxRaces(U), await data.fetch.hyroxRaces());
    await data.actions.deleteHyroxRace('r1');
    expect(queryClient.getQueryData<Race[]>(keys.hyroxRaces(U))).toEqual([]);
    await outbox.flush(U);
    expect(db.rows('hyrox_races')).toEqual([]);
  });

  it('removing a race that was never sent cancels its waiting save', async () => {
    const { db, outbox, data } = setup();
    await data.actions.saveHyroxRace(race());
    await data.actions.deleteHyroxRace('r1');
    await outbox.flush(U);
    expect(db.rows('hyrox_races')).toEqual([]);
    expect(db.rows('hyrox_race_splits')).toEqual([]);
  });

  it('saving the preferences changes two columns of the settings row and no more', async () => {
    const { db, queryClient, outbox, data } = setup();
    const row = { user_id: U, theme: 'dark', language: 'th', units_weight: 'lb', units_height: 'cm', units_distance: 'km', units_clock: '12h', hyrox_leaderboard_gender: null, hyrox_facility_lane_m: null, hyrox_history_backfilled: true, extra: {} };
    db.seed('user_settings', [row]);
    queryClient.setQueryData(keys.settings(U), row);
    await data.actions.saveHyroxPrefs({ laneM: 9 });
    await data.actions.saveHyroxPrefs({ leaderboardGender: 'women' });
    expect(queryClient.getQueryData<Row<'user_settings'>>(keys.settings(U))).toMatchObject({ hyrox_facility_lane_m: 9, hyrox_leaderboard_gender: 'women', theme: 'dark' });
    await outbox.flush(U);
    expect(db.rows('user_settings')[0]).toMatchObject({ theme: 'dark', language: 'th', units_weight: 'lb', hyrox_facility_lane_m: 9, hyrox_leaderboard_gender: 'women', hyrox_history_backfilled: true });
  });
});

describe('the hooks', () => {
  it('races: the server’s, then a save waiting over them', async () => {
    const h = setup();
    h.db.seed('hyrox_races', [raceRow()]);
    h.db.seed('hyrox_race_splits', [splitRow(0, 'run1', 300)]);
    const hook = await renderHook(() => useHyroxRaces(), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.data).toHaveLength(1));
    expect(hook.result.current.data[0].splits).toHaveLength(1);
    await act(async () => {
      await h.data.actions.saveHyroxRace(race({ id: 'r9', date: '2026-10-26T08:00:00.000Z' }));
    });
    await hook.rerender({});
    expect(hook.result.current.data.map((r) => r.id)).toEqual(['r9', 'r1']);
  });

  it('races: none yet is an empty list that has loaded', async () => {
    const h = setup();
    const hook = await renderHook(() => useHyroxRaces(), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.data).toEqual([]);
  });

  it('preferences: none until set, then the waiting change', async () => {
    const h = setup();
    const hook = await renderHook(() => useHyroxPrefs(), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.data).toEqual({ laneM: null, leaderboardGender: null });
    await act(async () => {
      await h.data.actions.saveHyroxPrefs({ laneM: 15, leaderboardGender: 'men' });
    });
    await hook.rerender({});
    expect(hook.result.current.data).toEqual({ laneM: 15, leaderboardGender: 'men' });
  });
});
