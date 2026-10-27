import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { toIsoDate, addDays } from '@/logic/dates';
import { USER, dataHarness, nutritionRow } from '@/testing/dataHarness';

import NutritionScreen from '../NutritionScreen';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
const NOW = new Date();
const TODAY = toIsoDate(NOW);
const YESTERDAY = addDays(TODAY, -1);
const at = (hour: number, minute = 0) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), hour, minute).getTime();

async function open(h = dataHarness()) {
  await render(
    <h.Provider>
      <NutritionScreen />
    </h.Provider>,
  );
  return h;
}

const press = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};

const kcalIn = (testID: string) => Number(String(screen.getByTestId(testID).props.children));

afterEach(() => {
  jest.restoreAllMocks();
});

describe('an empty day', () => {
  it('says so, and the ring and goals are the defaults', async () => {
    await open();
    expect(await screen.findByText('Nothing logged yet')).toBeOnTheScreen();
    expect(screen.getByText('Today', { exact: true })).toBeOnTheScreen();
    expect(kcalIn('ring-consumed')).toBe(0);
    expect(kcalIn('ring-remaining')).toBe(1985);
    expect(screen.getByText('kcal left')).toBeOnTheScreen();
  });
});

describe('a day with food', () => {
  async function withFood() {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [
      nutritionRow('a', TODAY, at(8), { food: 'Oats', grams: 200, base_calories: 380, base_protein: 13, base_fat: 7, base_carbs: 66 }),
      nutritionRow('b', TODAY, at(13), { food: 'Chicken', grams: 150, base_calories: 165, base_protein: 31, base_fat: 3.6, base_carbs: 0 }),
      nutritionRow('y', YESTERDAY, at(9), { food: 'Toast' }),
      { ...nutritionRow('z', TODAY, at(9), { food: 'Someone else’s' }), user_id: 'user-2' },
    ]);
    await open(h);
    await screen.findByText('Oats');
    return h;
  }

  it('lists the foods in time order with their time, amount and calories', async () => {
    await withFood();
    const names = screen.getAllByText(/^(Oats|Chicken)$/).map((n) => n.props.children);
    expect(names).toEqual(['Oats', 'Chicken']);
    expect(screen.getByText(/• 200g • 760 kcal/)).toBeOnTheScreen();
    expect(screen.queryByText('Toast')).toBeNull();
    expect(screen.queryByText('Someone else’s')).toBeNull();
  });

  it('totals the day from the entries, each rounded first', async () => {
    await withFood();
    expect(kcalIn('ring-consumed')).toBe(760 + 248); // 380*2 + round(165*1.5=247.5 -> 248)
    expect(screen.getByText('2 items · 1008 kcal')).toBeOnTheScreen();
  });

  it('opens a food to its amount and macros', async () => {
    await withFood();
    await press(/^Oats, Show details/);
    expect(await screen.findByDisplayValue('200')).toBeOnTheScreen();
    expect(screen.getByTestId('entry-kcal').props.children).toBe(760);
    expect(screen.getByTestId('entry-macros').props.children).toBe('26P / 14F / 132C');
  });

  it('changing the amount updates the numbers as you type and saves when you leave the field', async () => {
    const h = await withFood();
    await press(/^Oats, Show details/);
    const field = await screen.findByDisplayValue('200');
    await fireEvent.changeText(field, '100');
    expect(screen.getByTestId('entry-kcal').props.children).toBe(380);
    expect(h.outbox.pending(USER)).toEqual([]); // typing alone saves nothing
    await fireEvent(field, 'endEditing');
    await waitFor(() => expect(h.outbox.pending(USER)).toHaveLength(1));
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('nutrition_entries').find((r) => r.id === 'a')).toMatchObject({ grams: 100, food: 'Oats' });
    await waitFor(() => expect(kcalIn('ring-consumed')).toBe(380 + 248));
  });

  it('a blank or zero amount keeps the last good one', async () => {
    const h = await withFood();
    await press(/^Oats, Show details/);
    const field = await screen.findByDisplayValue('200');
    await fireEvent.changeText(field, '');
    await fireEvent.changeText(field, '0');
    expect(screen.getByTestId('entry-kcal').props.children).toBe(760);
    await fireEvent(field, 'endEditing');
    expect(h.outbox.pending(USER)).toEqual([]);
  });

  it('opening and closing a food without changing it queues nothing', async () => {
    const h = await withFood();
    await press(/^Oats, Show details/);
    await press('Done');
    expect(h.outbox.pending(USER)).toEqual([]);
  });

  it('removing a food asks first, then deletes it', async () => {
    const h = await withFood();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await press(/^Oats, Show details/);
    await press('Remove food');
    expect(alert).toHaveBeenCalledWith('Delete this food?', 'Oats', expect.any(Array));
    expect(h.outbox.pending(USER)).toEqual([]); // not yet
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Remove food')?.onPress?.();
    });
    await waitFor(() => expect(screen.queryByText('Oats')).toBeNull());
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('nutrition_entries').map((r) => r.id).sort()).toEqual(['b', 'y', 'z']);
  });

  it('cancelling the confirmation keeps the food', async () => {
    const h = await withFood();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await press(/^Oats, Show details/);
    await press('Remove food');
    const buttons = alert.mock.calls[0][2] as { text: string; style?: string }[];
    expect(buttons.find((b) => b.style === 'cancel')?.text).toBe('Cancel');
    expect(screen.getByText('Oats')).toBeOnTheScreen();
    expect(h.outbox.pending(USER)).toEqual([]);
  });

  it('favouriting a food queues it and fills the heart', async () => {
    const h = await withFood();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Add to favorites' })[0]);
    await waitFor(() => expect(h.outbox.pending(USER).some((q) => q.op.table === 'nutrition_favorites')).toBe(true));
    expect(await screen.findAllByRole('button', { name: 'Remove from favorites' })).toHaveLength(1);
  });
});

describe('choosing another day', () => {
  it('shows that day’s foods, with its own title', async () => {
    const h = dataHarness();
    const other = addDays(TODAY, new Date().getDay() === 1 ? 6 : -1); // a different day of the same Monday-first week
    h.db.seed('nutrition_entries', [nutritionRow('a', TODAY, at(8), { food: 'Oats' }), nutritionRow('t', other, at(9), { food: 'Toast' })]);
    await open(h);
    await screen.findByText('Oats');
    const label = new Date(`${other}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
    await fireEvent.press(await screen.findByRole('button', { name: new RegExp(label) }));
    expect(await screen.findByText('Toast')).toBeOnTheScreen();
    expect(screen.queryByText('Oats')).toBeNull();
    expect(screen.queryByText('Today', { exact: true })).toBeNull();
  });

  it('a day with food has a dot in the strip', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [nutritionRow('a', TODAY, at(8), { food: 'Oats' })]);
    await open(h);
    await screen.findByText('Oats');
    expect(screen.getAllByRole('button', { name: /food logged/ })).toHaveLength(1);
  });

  it('the arrows step a week', async () => {
    await open();
    const before = screen.getAllByRole('button', { name: /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,/ }).map((b) => b.props.accessibilityLabel);
    await press('Next week');
    const after = screen.getAllByRole('button', { name: /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,/ }).map((b) => b.props.accessibilityLabel);
    expect(after).not.toEqual(before);
    await press('Previous week');
    await press('Previous week');
    const earlier = screen.getAllByRole('button', { name: /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,/ }).map((b) => b.props.accessibilityLabel);
    expect(earlier).not.toEqual(before);
  });
});

describe('logging a food', () => {
  it('search, pick, choose the amount, add: it is on the screen at once and reaches the server when there is signal', async () => {
    const h = await open();
    await press('Log a food');
    const search = await screen.findByPlaceholderText('Search for a food...');
    await fireEvent.changeText(search, 'banana');
    await press(/^Banana/);
    expect(await screen.findByDisplayValue('100')).toBeOnTheScreen();
    const kcal = String(screen.getByTestId('preview-kcal').props.children.join(''));
    expect(kcal).toMatch(/^\d+ kcal$/);
    await fireEvent.changeText(screen.getByDisplayValue('100'), '200');
    expect(Number.parseInt(String(screen.getByTestId('preview-kcal').props.children.join('')), 10)).toBeGreaterThan(Number.parseInt(kcal, 10));
    await press('Add');
    await waitFor(() => expect(h.outbox.pending(USER).length).toBeGreaterThan(0));
    expect(await screen.findByRole('button', { name: /^Banana.*Hide details/ })).toBeOnTheScreen(); // opened for adjusting
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('nutrition_entries')).toMatchObject([{ log_date: TODAY, grams: 200, user_id: USER }]);
  });

  it('works with no signal: the entry shows and waits in the queue', async () => {
    const h = dataHarness();
    h.goOffline();
    await open(h);
    await press('Log a food');
    await fireEvent.changeText(await screen.findByPlaceholderText('Search for a food...'), 'banana');
    await press(/^Banana/);
    await press('Add');
    expect(await screen.findByRole('button', { name: /^Banana/ })).toBeOnTheScreen();
    await act(async () => {
      const result = await h.flush();
      expect(result.retryInMs).not.toBeNull();
    });
    expect(h.outbox.pending(USER)).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Banana/ })).toBeOnTheScreen();
  });

  it('says so when nothing matches', async () => {
    await open();
    await press('Log a food');
    await fireEvent.changeText(await screen.findByPlaceholderText('Search for a food...'), 'zzzzqqqq');
    expect(await screen.findByText('Couldn\'t find "zzzzqqqq"')).toBeOnTheScreen();
  });

  it('offers what was logged lately, and logging it again copies it with its own macros', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [nutritionRow('r', YESTERDAY, at(9), { food: 'My scanned bowl', source: 'scan', grams: 300, base_calories: 150 })]);
    await open(h);
    await press('Log a food');
    expect(await screen.findByText('Recent')).toBeOnTheScreen();
    await press(/^My scanned bowl/);
    expect(await screen.findByDisplayValue('300')).toBeOnTheScreen();
    await press('Add');
    await waitFor(() => expect(h.outbox.pending(USER).length).toBeGreaterThan(0));
    await act(async () => {
      await h.flush();
    });
    const rows = h.db.rows('nutrition_entries');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id !== 'r')).toMatchObject({ food: 'My scanned bowl', source: 'scan', grams: 300, base_calories: 150, log_date: TODAY });
  });

  it('quick add logs a food from typed macros', async () => {
    const h = await open();
    await press('Log a food');
    await press('Quick add');
    await fireEvent.changeText(await screen.findByLabelText('Food name'), 'Mystery stew');
    await fireEvent.changeText(screen.getByLabelText('Protein (g)'), '20');
    await fireEvent.changeText(screen.getByLabelText('Fat (g)'), '10');
    await fireEvent.changeText(screen.getByLabelText('Carbs (g)'), '30');
    expect(screen.getByTestId('quick-calories').props.children.join('')).toBe('290 kcal');
    await press('Add');
    await waitFor(() => expect(h.outbox.pending(USER).length).toBeGreaterThan(0));
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('nutrition_entries')).toMatchObject([{ food: 'Mystery stew', source: 'quick', grams: 100, base_protein: 20, base_fat: 10, base_carbs: 30, base_calories: 290 }]);
  });

  it('quick add needs a name', async () => {
    const h = await open();
    await press('Log a food');
    await press('Quick add');
    await press('Add');
    expect(await screen.findByText('Enter a name for the food.')).toBeOnTheScreen();
    expect(h.outbox.pending(USER)).toEqual([]);
  });

  it('creating a food of your own goes through the server and then it can be logged', async () => {
    const created: unknown[] = [];
    const h = dataHarness({
      createCustomFood: async (food) => {
        created.push(food);
        return { id: 9, name: food.name, emoji: '🥣', calories: 300, protein: food.protein, fat: food.fat, carbs: food.carbs, barcode: null, servingLabel: food.servingLabel ?? '1 serving', servingGrams: food.servingGrams ?? 100, servings: [] };
      },
    });
    await open(h);
    await press('Log a food');
    await press('Create a food');
    await fireEvent.changeText(await screen.findByLabelText('Food name'), 'House shake');
    await fireEvent.changeText(screen.getByLabelText('Serving name'), '1 bottle');
    await fireEvent.changeText(screen.getByLabelText('Serving size (g)'), '400');
    await fireEvent.changeText(screen.getByLabelText('Protein (g)'), '30');
    await fireEvent.changeText(screen.getByLabelText('Fat (g)'), '5');
    await fireEvent.changeText(screen.getByLabelText('Carbs (g)'), '30');
    await press('Save food');
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ name: 'House shake', servingLabel: '1 bottle', servingGrams: 400, protein: 30, fat: 5, carbs: 30 });
  });

  it('shows the server’s reason when it refuses a food', async () => {
    const h = dataHarness({ createCustomFood: async () => { throw Object.assign(new Error('You already have a custom food saved for this barcode.'), { status: 409 }); } });
    await open(h);
    await press('Log a food');
    await press('Create a food');
    await fireEvent.changeText(await screen.findByLabelText('Food name'), 'Dup');
    await press('Save food');
    expect(await screen.findByText('You already have a custom food saved for this barcode.')).toBeOnTheScreen();
  });

  it('a food needs a name', async () => {
    const h = dataHarness();
    await open(h);
    await press('Log a food');
    await press('Create a food');
    await press('Save food');
    expect(await screen.findByText('Enter a name for the food.')).toBeOnTheScreen();
  });
});

describe('daily goals', () => {
  it('edits the macros and works the calories out from them', async () => {
    const h = await open();
    await press('Edit goals');
    expect(await screen.findByDisplayValue('150')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Protein (g)'), '100');
    await fireEvent.changeText(screen.getByLabelText('Fat (g)'), '50');
    await fireEvent.changeText(screen.getByLabelText('Carbs (g)'), '100');
    expect(screen.getByTestId('goals-calories').props.children).toBe(1250);
    await press('Save goals');
    await waitFor(() => expect(kcalIn('ring-remaining')).toBe(1250));
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('nutrition_goals')).toMatchObject([{ user_id: USER, protein: 100, fat: 50, carbs: 100 }]);
  });

  it('out-of-range goals are corrected the way the website corrects them', async () => {
    await open();
    await press('Edit goals');
    await fireEvent.changeText(await screen.findByLabelText('Protein (g)'), '5');
    await fireEvent.changeText(screen.getByLabelText('Fat (g)'), 'abc');
    expect(screen.getByTestId('goals-calories').props.children).toBe(20 * 4 + 65 * 9 + 200 * 4);
  });
});

describe('survivors: sheets close, ingredients, errors, wording', () => {
  it('a single food reads "1 item" with its calories', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [nutritionRow('a', TODAY, at(8), { food: 'Oats', grams: 100, base_calories: 100 })]);
    await open(h);
    expect(await screen.findByText('1 item · 100 kcal')).toBeOnTheScreen();
  });

  it('the totals read "eaten / goal g" for each macro', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [nutritionRow('a', TODAY, at(8), { grams: 100, base_protein: 20 })]);
    await open(h);
    expect(await screen.findByText('20 / 150 g')).toBeOnTheScreen();
  });

  it('the quick add, create-a-food and goals sheets close once they have done their job', async () => {
    const h = await open();
    await press('Log a food');
    await press('Quick add');
    await fireEvent.changeText(await screen.findByLabelText('Food name'), 'Stew');
    await press('Add');
    await waitFor(() => expect(screen.queryByLabelText('Food name')).toBeNull());
    expect(screen.queryByPlaceholderText('Search for a food...')).toBeNull();

    await press('Log a food');
    await press('Create a food');
    await fireEvent.changeText(await screen.findByLabelText('Food name'), 'Shake');
    await press('Save food');
    await waitFor(() => expect(screen.queryByLabelText('Serving name')).toBeNull());

    await press('Edit goals');
    await press('Save goals');
    await waitFor(() => expect(screen.queryByLabelText('Protein (g)')).toBeNull());
    expect(h.outbox.pending(USER).length).toBeGreaterThan(0);
  });

  it('the sheet Close button closes it', async () => {
    await open();
    await press('Edit goals');
    await fireEvent.press(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByLabelText('Protein (g)')).toBeNull());
    await press('Log a food');
    await fireEvent.press(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Search for a food...')).toBeNull());
  });

  it('adding an ingredient turns a food into a dish and keeps it open', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [nutritionRow('a', TODAY, at(8), { food: 'Oats', grams: 100, base_calories: 100 })]);
    await open(h);
    await press(/^Oats, Show details/);
    await press('+ Add ingredient');
    expect(await screen.findByText('Add ingredient')).toBeOnTheScreen();
    expect(screen.queryByText('Quick add')).toBeNull();
    await fireEvent.changeText(await screen.findByPlaceholderText('Search for a food...'), 'banana');
    await press(/^Banana/);
    expect(await screen.findByText(/Ingredients \(2\)/)).toBeOnTheScreen();
    await act(async () => {
      await h.flush();
    });
    const row = h.db.rows('nutrition_entries').find((r) => r.id === 'a');
    expect(row?.grams).toBeNull();
    expect((row?.ingredients as { name: string }[]).map((i) => i.name)).toEqual(['Oats', 'Banana']);
  });

  it('a dish total can be changed and an ingredient removed', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [
      nutritionRow('d', TODAY, at(8), {
        food: 'Bowl', grams: null, unit: null, base_calories: null, base_carbs: null, base_fat: null, base_protein: null,
        ingredients: [
          { name: 'Rice', grams: 100, unit: 'g', baseCalories: 130, baseCarbs: 28, baseFat: 0.3, baseProtein: 2.7 },
          { name: 'Egg', grams: 50, unit: 'g', baseCalories: 143, baseCarbs: 0.7, baseFat: 9.5, baseProtein: 12.6 },
        ],
      }),
    ]);
    await open(h);
    await press(/^Bowl, Show details/);
    const total = await screen.findByDisplayValue('150');
    await fireEvent.changeText(total, '300');
    await fireEvent(total, 'endEditing');
    await waitFor(() => expect(h.outbox.pending(USER).length).toBeGreaterThan(0));
    await press('Remove Egg');
    await act(async () => {
      await h.flush();
    });
    const saved = h.db.rows('nutrition_entries')[0].ingredients as { name: string; grams: number }[];
    expect(saved.map((i) => i.name)).toEqual(['Rice']);
    expect(saved[0].grams).toBeCloseTo(200, 6);
  });

  it('switching the unit keeps the amount and saves', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [nutritionRow('a', TODAY, at(8), { food: 'Oats', grams: 283.495 })]);
    await open(h);
    await press(/^Oats, Show details/);
    expect(await screen.findByDisplayValue('283.5')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'oz' }));
    expect(await screen.findByDisplayValue('10')).toBeOnTheScreen();
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('nutrition_entries')[0]).toMatchObject({ unit: 'oz' });
    expect(h.db.rows('nutrition_entries')[0].grams as number).toBeCloseTo(283.495, 3);
  });

  it('a change that cannot be queued (the queue is full) is reported and the sheet stays open', async () => {
    const h = await open();
    for (let i = 0; i < 500; i++) await h.outbox.enqueue(USER, { kind: 'upsert', table: 'weight_entries', key: 'user_id,log_date', row: { user_id: USER, log_date: `d${i}`, kg: 1 } });
    await press('Log a food');
    await fireEvent.changeText(await screen.findByPlaceholderText('Search for a food...'), 'banana');
    await press(/^Banana/);
    await press('Add');
    expect(await screen.findByText(/save that to your account/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Add' })).toBeOnTheScreen();
  });

  it('the custom scope says when you have no foods of your own', async () => {
    await open();
    await press('Log a food');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Custom' }));
    expect(await screen.findByText('Foods you build yourself show up here.')).toBeOnTheScreen();
    expect(screen.queryByText('Search for a food to add it.')).toBeNull();
  });

  it('your own foods are listed in the custom scope and can be logged by serving', async () => {
    const shake = { id: 1, name: 'House shake', emoji: '🥤', calories: 300, protein: 30, fat: 5, carbs: 30, barcode: null, servingLabel: '1 bottle', servingGrams: 400, servings: [{ label: 'half', grams: 200 }] };
    await open(dataHarness({ listCustomFoods: async () => [shake] }));
    await press('Log a food');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Custom' }));
    await press(/^House shake/);
    expect(await screen.findByDisplayValue('400')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'half · 200 g' }));
    expect(await screen.findByDisplayValue('200')).toBeOnTheScreen();
    expect(screen.getByTestId('preview-kcal').props.children.join('')).toBe('150 kcal');
    expect(screen.getByRole('button', { name: 'half · 200 g' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: '1 bottle · 400 g' }).props.accessibilityState.selected).toBe(false);
  });

  it('with no history and nothing typed the sheet says to search', async () => {
    await open();
    await press('Log a food');
    expect(await screen.findByText('Search for a food to add it.')).toBeOnTheScreen();
  });

  it('the amount step has a Back button that returns to the search', async () => {
    await open();
    await press('Log a food');
    await fireEvent.changeText(await screen.findByPlaceholderText('Search for a food...'), 'banana');
    await press(/^Banana/);
    await press('Back');
    expect(await screen.findByPlaceholderText('Search for a food...')).toBeOnTheScreen();
  });

  it('the amount step switches units without changing how much is logged', async () => {
    await open();
    await press('Log a food');
    await fireEvent.changeText(await screen.findByPlaceholderText('Search for a food...'), 'banana');
    await press(/^Banana/);
    const kcal = screen.getByTestId('preview-kcal').props.children.join('');
    await fireEvent.press(screen.getByRole('radio', { name: 'oz' }));
    expect(await screen.findByDisplayValue('3.5')).toBeOnTheScreen();
    expect(screen.getByTestId('preview-kcal').props.children.join('')).toBe(kcal);
  });
});

describe('the history pages and removing your own foods', () => {
  it('the history buttons open the two pages', async () => {
    await open();
    await press('Full stats');
    expect(mockPush).toHaveBeenCalledWith('/full-stats');
    await press('Logging History');
    expect(mockPush).toHaveBeenCalledWith('/logging-history');
  });

  it('a food of your own can be removed from the Custom list, after a confirmation', async () => {
    const shake = { id: 7, name: 'House shake', emoji: '🥤', calories: 300, protein: 30, fat: 5, carbs: 30, barcode: null, servingLabel: '1 bottle', servingGrams: 400, servings: [] };
    const deleted: number[] = [];
    const h = dataHarness({ listCustomFoods: async () => [shake], deleteCustomFood: async (id) => void deleted.push(id) });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await open(h);
    await press('Log a food');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Custom' }));
    await press('Remove House shake');
    expect(alert).toHaveBeenCalledWith('Delete this food?', 'House shake', expect.any(Array));
    expect(deleted).toEqual([]);
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Remove')?.onPress?.();
    });
    await waitFor(() => expect(deleted).toEqual([7]));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^House shake/ })).toBeNull());
  });

  it('cancelling the confirmation keeps the food', async () => {
    const shake = { id: 7, name: 'House shake', emoji: '🥤', calories: 300, protein: 30, fat: 5, carbs: 30, barcode: null, servingLabel: '1 bottle', servingGrams: 400, servings: [] };
    const deleted: number[] = [];
    const h = dataHarness({ listCustomFoods: async () => [shake], deleteCustomFood: async (id) => void deleted.push(id) });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await open(h);
    await press('Log a food');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Custom' }));
    await press('Remove House shake');
    expect((alert.mock.calls[0][2] as { style?: string }[]).some((b) => b.style === 'cancel')).toBe(true);
    expect(deleted).toEqual([]);
    expect(screen.getByRole('button', { name: /^House shake/ })).toBeOnTheScreen();
  });
});
