import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { USER, dataHarness } from '@/testing/dataHarness';

import NutritionScreen from '../NutritionScreen';

const mockApi = { analyzeFood: jest.fn(), lookupBarcode: jest.fn(), setAiConsent: jest.fn() };
const mockCamera = { lastProps: null as Record<string, any> | null };

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ state: { status: 'ready', profile: { ai_consent: true } }, refreshProfile: async () => undefined }) }));
jest.mock('@/ui/photos', () => ({
  takePhoto: async () => ({ kind: 'photo', image: { uri: 'file:///meal.jpg', name: 'meal.jpg', mimeType: 'image/jpeg' } }),
  choosePhoto: async () => ({ kind: 'cancelled' }),
}));
jest.mock('expo-camera', () => {
  const { View } = require('react-native');
  return {
    CameraView: (props: Record<string, any>) => {
      mockCamera.lastProps = props;
      return <View testID="camera" />;
    },
    useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
  };
});

const PLATE = {
  food_name: 'Pad kra pao',
  confidence: 'medium' as const,
  note: '',
  ingredients: [{ name: 'Rice', grams: 300, calories: 130, protein: 2.7, fat: 0.3, carbs: 28 }],
  calories: 390,
  protein: 8.1,
  fat: 0.9,
  carbs: 84,
};

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

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.analyzeFood.mockResolvedValue(PLATE);
});

describe('scanning from the log sheet', () => {
  it('offers both scans, and opening one replaces the log sheet', async () => {
    await open();
    await press('Log a food');
    expect(await screen.findByRole('button', { name: 'Scan a meal' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Scan barcode' })).toBeOnTheScreen();
    await press('Scan a meal');
    expect(await screen.findByRole('button', { name: 'Take a photo' })).toBeOnTheScreen();
    expect(screen.queryByPlaceholderText('Search for a food...')).toBeNull();
  });

  it('a scanned meal is logged on the chosen day, shown open for adjusting, and sent when there is signal', async () => {
    const h = await open();
    await press('Log a food');
    await press('Scan a meal');
    await press('Take a photo');
    await press('Add to log');
    expect(await screen.findByRole('button', { name: /^Pad kra pao.*Hide details/ })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Take a photo' })).toBeNull(); // the scan sheet closed
    await act(async () => {
      await h.flush();
    });
    const rows = h.db.rows('nutrition_entries');
    expect(rows).toMatchObject([{ user_id: USER, food: 'Pad kra pao', source: 'scan', grams: null }]);
    expect((rows[0].ingredients as { name: string; grams: number }[])[0]).toMatchObject({ name: 'Rice', grams: 300 });
  });

  it('with no signal the scan itself needs the server, but what was logged still waits in the queue', async () => {
    const h = dataHarness();
    h.goOffline();
    await open(h);
    await press('Log a food');
    await press('Scan a meal');
    await press('Take a photo');
    await press('Add to log');
    expect(await screen.findByRole('button', { name: /^Pad kra pao/ })).toBeOnTheScreen();
    await act(async () => {
      expect((await h.flush()).retryInMs).not.toBeNull();
    });
    expect(h.outbox.pending(USER).length).toBeGreaterThan(0);
  });

  it('a barcode nobody knows leads to making the food with that barcode, which is sent to the server', async () => {
    mockApi.lookupBarcode.mockResolvedValue({ kind: 'not-found', barcode: '8850123456789', message: 'No product.' });
    const created: unknown[] = [];
    const h = dataHarness({
      createCustomFood: async (food) => {
        created.push(food);
        return { id: 1, name: food.name, emoji: '🥣', calories: 100, protein: food.protein, fat: food.fat, carbs: food.carbs, barcode: food.barcode ?? null, servingLabel: '1 serving', servingGrams: 100, servings: [] };
      },
    });
    await open(h);
    await press('Log a food');
    await press('Scan barcode');
    await screen.findByTestId('camera');
    await act(async () => mockCamera.lastProps?.onBarcodeScanned({ data: '8850123456789', type: 'ean13' }));
    await press('Create this food yourself');
    expect(await screen.findByText('Barcode 8850123456789')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Food name'), 'Crispy snack');
    await press('Save food');
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ name: 'Crispy snack', barcode: '8850123456789' });
    await waitFor(() => expect(screen.queryByText('Barcode 8850123456789')).toBeNull());
  });

  it('making a food by hand afterwards does not carry the old barcode', async () => {
    mockApi.lookupBarcode.mockResolvedValue({ kind: 'not-found', barcode: '111', message: 'No product.' });
    const created: any[] = [];
    const h = dataHarness({
      createCustomFood: async (food) => {
        created.push(food);
        return { id: 1, name: food.name, emoji: '🥣', calories: 0, protein: 0, fat: 0, carbs: 0, barcode: null, servingLabel: 'x', servingGrams: 100, servings: [] };
      },
    });
    await open(h);
    await press('Log a food');
    await press('Scan barcode');
    await screen.findByTestId('camera');
    await act(async () => mockCamera.lastProps?.onBarcodeScanned({ data: '111', type: 'ean13' }));
    await press('Create this food yourself');
    await fireEvent.press(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText('Barcode 111')).toBeNull());
    await press('Log a food');
    await press('Create a food');
    expect(screen.queryByText('Barcode 111')).toBeNull();
    await fireEvent.changeText(await screen.findByLabelText('Food name'), 'By hand');
    await press('Save food');
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].barcode).toBeUndefined();
  });
});
