import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import type { BarcodeOutcome } from '@/api/scan';
import type { ScanResult } from '@/logic/scan';
import { entryTotals } from '@/logic/macros';

import { ScanSheet } from '../ScanSheet';

const mockApi = {
  analyzeFood: jest.fn(),
  lookupBarcode: jest.fn(),
  setAiConsent: jest.fn(),
};
const mockAuth = { state: { status: 'ready', profile: { ai_consent: true } } as { status: string; profile: { ai_consent: boolean } }, refreshProfile: jest.fn(async () => undefined) };
const mockPhotos = { takePhoto: jest.fn(), choosePhoto: jest.fn() };
const mockCamera = { permission: { granted: true, canAskAgain: true } as { granted: boolean; canAskAgain: boolean } | null, request: jest.fn(), lastProps: null as Record<string, any> | null };

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/ui/photos', () => ({ takePhoto: (...a: unknown[]) => mockPhotos.takePhoto(...a), choosePhoto: (...a: unknown[]) => mockPhotos.choosePhoto(...a) }));
jest.mock('expo-camera', () => {
  const { View } = require('react-native');
  return {
    CameraView: (props: Record<string, any>) => {
      mockCamera.lastProps = props;
      return <View testID="camera" />;
    },
    useCameraPermissions: () => [mockCamera.permission, mockCamera.request],
  };
});

const PLATE: ScanResult = {
  food_name: 'Pad kra pao',
  confidence: 'medium',
  note: 'A fair estimate.',
  ingredients: [
    { name: 'Rice', grams: 150, calories: 130, protein: 2.7, fat: 0.3, carbs: 28 },
    { name: 'Pork', grams: 150, calories: 250, protein: 20, fat: 18, carbs: 1 },
  ],
  calories: 570,
  protein: 34,
  fat: 27,
  carbs: 43.5,
};
const PHOTO = { kind: 'photo', image: { uri: 'file:///meal.jpg', name: 'meal.jpg', mimeType: 'image/jpeg' } } as const;
const found = (result: ScanResult): BarcodeOutcome => ({ kind: 'found', result });

const onAdd = jest.fn();
const onCreateFood = jest.fn();
const onClose = jest.fn();

async function open(mode: 'meal' | 'barcode') {
  await render(<ScanSheet visible mode={mode} day="2026-10-25" onAdd={onAdd} onCreateFood={onCreateFood} onClose={onClose} />);
}

const press = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.state = { status: 'ready', profile: { ai_consent: true } };
  mockCamera.permission = { granted: true, canAskAgain: true };
  mockCamera.lastProps = null;
  mockApi.analyzeFood.mockResolvedValue(PLATE);
  mockApi.setAiConsent.mockResolvedValue(true);
  mockPhotos.takePhoto.mockResolvedValue(PHOTO);
  mockPhotos.choosePhoto.mockResolvedValue(PHOTO);
});

describe('scanning a meal', () => {
  it('take a photo, see the estimate, add it: a dish of the ingredients marked as a scan', async () => {
    await open('meal');
    await press('Take a photo');
    expect(await screen.findByTestId('scan-kcal')).toHaveTextContent('570 kcal');
    expect(mockApi.analyzeFood).toHaveBeenCalledWith(PHOTO.image);
    expect(screen.getByTestId('scan-macros')).toHaveTextContent('34P / 27F / 44C');
    expect(screen.getByText('Medium confidence')).toBeOnTheScreen();
    expect(screen.getByText('A fair estimate.')).toBeOnTheScreen();
    expect(screen.getByText(/AI estimate from your photo/)).toBeOnTheScreen();
    await press('Add to log');
    expect(onAdd).toHaveBeenCalledTimes(1);
    const entry = onAdd.mock.calls[0][0];
    expect(entry).toMatchObject({ food: 'Pad kra pao', source: 'scan' });
    expect(entry.ingredients.map((i: { name: string; grams: number }) => [i.name, i.grams])).toEqual([['Rice', 150], ['Pork', 150]]);
    expect(entryTotals(entry).calories).toBeCloseTo(570, 6);
  });

  it('choosing from the library works the same way', async () => {
    await open('meal');
    await press('Choose from library');
    expect(await screen.findByTestId('scan-kcal')).toBeOnTheScreen();
    expect(mockPhotos.choosePhoto).toHaveBeenCalledTimes(1);
    expect(mockPhotos.takePhoto).not.toHaveBeenCalled();
  });

  it('the name can be edited before it is logged', async () => {
    await open('meal');
    await press('Take a photo');
    await fireEvent.changeText(await screen.findByLabelText('Food name'), 'Lunch at work');
    await press('Add to log');
    expect(onAdd.mock.calls[0][0].food).toBe('Lunch at work');
  });

  it('two servings double it, grams and ounces keep the amount the same, and the numbers follow', async () => {
    await open('meal');
    await press('Take a photo');
    const amount = await screen.findByLabelText('Amount');
    await fireEvent.changeText(amount, '2');
    expect(screen.getByTestId('scan-kcal')).toHaveTextContent('1140 kcal');
    await fireEvent.press(screen.getByRole('radio', { name: 'g' }));
    expect(screen.getByLabelText('Amount').props.value).toBe('600');
    expect(screen.getByTestId('scan-kcal')).toHaveTextContent('1140 kcal');
    await fireEvent.changeText(screen.getByLabelText('Amount'), '150');
    expect(screen.getByTestId('scan-kcal')).toHaveTextContent('285 kcal');
    await fireEvent.press(screen.getByRole('radio', { name: 'oz' }));
    expect(screen.getByLabelText('Amount').props.value).toBe('5.29');
    await press('Add to log');
    const grams = entryTotals(onAdd.mock.calls[0][0]).grams;
    expect(grams).toBeCloseTo(150, 0);
  });

  it('a food with several serving sizes lets you pick one, and one of them is then the amount', async () => {
    mockApi.analyzeFood.mockResolvedValue({ ...PLATE, servings: [{ label: '1 bar', grams: 45 }, { label: '1 box', grams: 270 }] });
    await open('meal');
    await press('Take a photo');
    await press('1 box (270 g)');
    expect(screen.getByText('1 serving = 270 g')).toBeOnTheScreen();
    expect(screen.getByLabelText('Amount').props.value).toBe('1');
    expect(screen.getByTestId('scan-kcal')).toHaveTextContent('513 kcal'); // 570 per 300 g, so 270 g
  });

  it('an amount of zero cannot be added', async () => {
    await open('meal');
    await press('Take a photo');
    await fireEvent.changeText(await screen.findByLabelText('Amount'), '0');
    expect((await screen.findByRole('button', { name: 'Add to log' })).props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Amount'), '');
    expect(screen.getByRole('button', { name: 'Add to log' }).props.accessibilityState.disabled).toBe(true);
  });

  it('Retake goes back to choosing a photo', async () => {
    await open('meal');
    await press('Take a photo');
    await press('Retake');
    expect(await screen.findByRole('button', { name: 'Take a photo' })).toBeOnTheScreen();
  });

  it('a cancelled camera stays where it was; a refused camera says so', async () => {
    mockPhotos.takePhoto.mockResolvedValueOnce({ kind: 'cancelled' });
    await open('meal');
    await press('Take a photo');
    expect(await screen.findByRole('button', { name: 'Take a photo' })).toBeOnTheScreen();
    expect(mockApi.analyzeFood).not.toHaveBeenCalled();
    mockPhotos.takePhoto.mockResolvedValueOnce({ kind: 'denied' });
    await press('Take a photo');
    expect(await screen.findByText(/Camera access is off/)).toBeOnTheScreen();
  });

  it('a failed analysis shows the server’s words and lets you try again', async () => {
    mockApi.analyzeFood.mockRejectedValueOnce(new ApiError("You've used your 10 food scans for today — try again in 3 hours.", 429, {}, 10800));
    await open('meal');
    await press('Take a photo');
    expect(await screen.findByText(/You've used your 10 food scans/)).toBeOnTheScreen();
    await press('Try again');
    expect(await screen.findByRole('button', { name: 'Take a photo' })).toBeOnTheScreen();
  });

  it('an error that is not the server’s gets a plain message', async () => {
    mockApi.analyzeFood.mockRejectedValueOnce(new TypeError('boom'));
    await open('meal');
    await press('Take a photo');
    expect(await screen.findByText(/Couldn't scan that/)).toBeOnTheScreen();
  });
});

describe('AI consent', () => {
  it('asks before the first photo is sent, and sends nothing until allowed', async () => {
    mockAuth.state = { status: 'ready', profile: { ai_consent: false } };
    await open('meal');
    await press('Take a photo');
    expect(await screen.findByText('Allow AI features?')).toBeOnTheScreen();
    expect(mockApi.analyzeFood).not.toHaveBeenCalled();
    await press('Allow');
    expect(await screen.findByTestId('scan-kcal')).toBeOnTheScreen();
    expect(mockApi.setAiConsent).toHaveBeenCalledWith(true);
    expect(mockAuth.refreshProfile).toHaveBeenCalledTimes(1);
    expect(mockApi.analyzeFood).toHaveBeenCalledWith(PHOTO.image);
  });

  it('"Not now" sends nothing and goes back', async () => {
    mockAuth.state = { status: 'ready', profile: { ai_consent: false } };
    await open('meal');
    await press('Take a photo');
    await press('Not now');
    expect(await screen.findByRole('button', { name: 'Take a photo' })).toBeOnTheScreen();
    expect(mockApi.setAiConsent).not.toHaveBeenCalled();
    expect(mockApi.analyzeFood).not.toHaveBeenCalled();
  });

  it('if the server says consent is missing even though the app thought it had it, the question is asked', async () => {
    mockApi.analyzeFood.mockRejectedValueOnce(new ApiError('Turn on AI features.', 403, { needs_ai_consent: true }));
    await open('meal');
    await press('Take a photo');
    expect(await screen.findByText('Allow AI features?')).toBeOnTheScreen();
    await press('Allow');
    expect(await screen.findByTestId('scan-kcal')).toBeOnTheScreen();
  });

  it('if recording the consent fails, the person is told and nothing is sent', async () => {
    mockAuth.state = { status: 'ready', profile: { ai_consent: false } };
    mockApi.setAiConsent.mockRejectedValueOnce(new ApiError('Could not save that.', 500));
    await open('meal');
    await press('Take a photo');
    await press('Allow');
    expect(await screen.findByText('Could not save that.')).toBeOnTheScreen();
    expect(mockApi.analyzeFood).not.toHaveBeenCalled();
  });
});

describe('scanning a barcode', () => {
  it('opens the camera for the usual product barcodes', async () => {
    await open('barcode');
    expect(await screen.findByTestId('camera')).toBeOnTheScreen();
    expect(mockCamera.lastProps?.barcodeScannerSettings.barcodeTypes).toEqual(['ean13', 'ean8', 'upc_a', 'upc_e', 'code128']);
    expect(screen.getByText('Point the camera at the barcode.')).toBeOnTheScreen();
  });

  it('looks a barcode up ONCE however many times the camera reports it, and shows the product with its credit', async () => {
    mockApi.lookupBarcode.mockResolvedValue(found({ ...PLATE, confidence: 'high', data_source: 'Open Food Facts', note: 'From the label.' }));
    await open('barcode');
    await screen.findByTestId('camera');
    await act(async () => {
      mockCamera.lastProps?.onBarcodeScanned({ data: '8850123456789', type: 'ean13' });
      mockCamera.lastProps?.onBarcodeScanned({ data: '8850123456789', type: 'ean13' });
    });
    expect(await screen.findByTestId('scan-kcal')).toBeOnTheScreen();
    expect(mockApi.lookupBarcode).toHaveBeenCalledTimes(1);
    expect(mockApi.lookupBarcode).toHaveBeenCalledWith('8850123456789');
    expect(screen.getByText('High confidence')).toBeOnTheScreen();
    expect(screen.getByText('Data from Open Food Facts (ODbL)')).toBeOnTheScreen();
    expect(screen.queryByText(/AI estimate/)).toBeNull();
  });

  it('credits FatSecret when that is where the figures came from', async () => {
    mockApi.lookupBarcode.mockResolvedValue(found({ ...PLATE, data_source: 'FatSecret' }));
    await open('barcode');
    await screen.findByTestId('camera');
    await act(async () => mockCamera.lastProps?.onBarcodeScanned({ data: '1', type: 'ean13' }));
    expect(await screen.findByText('Powered by fatsecret')).toBeOnTheScreen();
  });

  it('a product nobody knows offers to make the food yourself, with the barcode', async () => {
    mockApi.lookupBarcode.mockResolvedValue({ kind: 'not-found', barcode: '123456', message: 'No product.' });
    await open('barcode');
    await screen.findByTestId('camera');
    await act(async () => mockCamera.lastProps?.onBarcodeScanned({ data: '123456', type: 'ean13' }));
    expect(await screen.findByText("We couldn't find that product.")).toBeOnTheScreen();
    expect(screen.getByText('Barcode 123456')).toBeOnTheScreen();
    await press('Create this food yourself');
    expect(onCreateFood).toHaveBeenCalledWith('123456');
  });

  it('a lookup that failed says why, and trying again re-arms the camera', async () => {
    mockApi.lookupBarcode.mockResolvedValueOnce({ kind: 'failed', barcode: '9', message: 'The product database is down.' });
    mockApi.lookupBarcode.mockResolvedValueOnce(found(PLATE));
    await open('barcode');
    await screen.findByTestId('camera');
    await act(async () => mockCamera.lastProps?.onBarcodeScanned({ data: '9', type: 'ean13' }));
    expect(await screen.findByText('The product database is down.')).toBeOnTheScreen();
    await press('Try again');
    await screen.findByTestId('camera');
    await act(async () => mockCamera.lastProps?.onBarcodeScanned({ data: '9', type: 'ean13' }));
    expect(await screen.findByTestId('scan-kcal')).toBeOnTheScreen();
    expect(mockApi.lookupBarcode).toHaveBeenCalledTimes(2);
  });

  it('a thrown error ends in the plain message', async () => {
    mockApi.lookupBarcode.mockRejectedValueOnce(new ApiError('offline', 0));
    await open('barcode');
    await screen.findByTestId('camera');
    await act(async () => mockCamera.lastProps?.onBarcodeScanned({ data: '9', type: 'ean13' }));
    expect(await screen.findByText('offline')).toBeOnTheScreen();
  });

  it('a barcode result is added like any other: a dish of one ingredient marked as a scan', async () => {
    mockApi.lookupBarcode.mockResolvedValue(found({ ...PLATE, ingredients: [{ name: 'Granola bar', grams: 45, calories: 400, protein: 8, fat: 15, carbs: 60 }], calories: 180, protein: 3.6, fat: 6.8, carbs: 27 }));
    await open('barcode');
    await screen.findByTestId('camera');
    await act(async () => mockCamera.lastProps?.onBarcodeScanned({ data: '1', type: 'ean13' }));
    await press('Add to log');
    expect(onAdd.mock.calls[0][0]).toMatchObject({ source: 'scan', ingredients: [{ name: 'Granola bar', grams: 45 }] });
  });

  it('with camera access off it says so; if it can still ask, it offers to', async () => {
    mockCamera.permission = { granted: false, canAskAgain: true };
    await open('barcode');
    expect(await screen.findByText(/Camera access is off/)).toBeOnTheScreen();
    await press('Take a photo');
    expect(mockCamera.request).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('camera')).toBeNull();
  });

  it('with camera access refused for good there is no button that cannot work', async () => {
    mockCamera.permission = { granted: false, canAskAgain: false };
    await open('barcode');
    expect(await screen.findByText(/Camera access is off/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Take a photo' })).toBeNull();
  });

  it('while the permission is not yet known there is just a spinner', async () => {
    mockCamera.permission = null;
    await open('barcode');
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(screen.queryByText(/Camera access is off/)).toBeNull();
  });
});

describe('the sheet', () => {
  it('is titled for what it does, and closes', async () => {
    await open('meal');
    expect(await screen.findByText('Scan a meal')).toBeOnTheScreen();
    await press('Close');
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('survivors: the result screen', () => {
  const tiny: ScanResult = { ...PLATE, ingredients: [{ name: 'Rice', grams: 100.46, calories: 130, protein: 2.7, fat: 0.3, carbs: 28 }], calories: 130.6, protein: 2.7, fat: 0.3, carbs: 28 };

  async function result(over: Partial<ScanResult> = {}) {
    mockApi.analyzeFood.mockResolvedValue({ ...tiny, ...over });
    await open('meal');
    await press('Take a photo');
    await screen.findByTestId('scan-kcal');
  }

  it('calories are rounded to the nearest, not cut', async () => {
    await result();
    expect(screen.getByTestId('scan-kcal')).toHaveTextContent('131 kcal');
  });

  it('the serving size is shown to one decimal, rounded', async () => {
    await result();
    expect(screen.getByText('1 serving = 100.5 g')).toBeOnTheScreen();
  });

  it('a very small amount can be added; negative, endless or unreadable ones cannot', async () => {
    await result();
    const add = () => screen.getByRole('button', { name: 'Add to log' }).props.accessibilityState.disabled;
    await fireEvent.press(screen.getByRole('radio', { name: 'g' }));
    await fireEvent.changeText(screen.getByLabelText('Amount'), '0.5');
    expect(add()).toBe(false);
    for (const typed of ['-5', 'Infinity', 'abc']) {
      await fireEvent.changeText(screen.getByLabelText('Amount'), typed);
      expect(add()).toBe(true);
    }
  });

  it('one serving size on offer is no choice, two are', async () => {
    await result({ servings: [{ label: '1 bar', grams: 45 }] });
    expect(screen.queryByText('Serving sizes')).toBeNull();
  });

  it('the chosen serving size is the selected one (within a twentieth of a gram), and none is selected once the unit is grams', async () => {
    await result({ servings: [{ label: 'Near', grams: 100.5 }, { label: 'Far', grams: 100.6 }, { label: 'Other', grams: 200 }] });
    expect(screen.getByRole('button', { name: 'Near (100.5 g)' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: 'Far (100.6 g)' }).props.accessibilityState.selected).toBe(false);
    expect(screen.getByRole('button', { name: 'Other (200 g)' }).props.accessibilityState.selected).toBe(false);
    await fireEvent.press(screen.getByRole('radio', { name: 'g' }));
    expect(screen.getByRole('button', { name: 'Near (100.5 g)' }).props.accessibilityState.selected).toBe(false);
  });

  it('a confident result and a your-own-food result get the green badge, the rest amber', async () => {
    const colour = async (confidence: ScanResult['confidence'], label: string) => {
      mockApi.analyzeFood.mockResolvedValue({ ...tiny, confidence });
      await open('meal');
      await press('Take a photo');
      const background = screen.getByText(label).parent;
      return background;
    };
    expect(await colour('high', 'High confidence')).toHaveStyle({ backgroundColor: '#e7f6ee' });
    expect(await colour('custom', 'Your saved food')).toHaveStyle({ backgroundColor: '#e7f6ee' });
    expect(await colour('medium', 'Medium confidence')).toHaveStyle({ backgroundColor: '#fbf1e2' });
    expect(await colour('low', 'Low confidence')).toHaveStyle({ backgroundColor: '#fbf1e2' });
  });
});
