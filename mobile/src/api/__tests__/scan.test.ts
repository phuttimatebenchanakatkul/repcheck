import { ApiError, type Api } from '../client';
import { ANALYZE_TIMEOUT_MS, scanEndpoints } from '../scan';

const FOOD = {
  ok: true,
  food_name: 'Pad kra pao',
  confidence: 'medium',
  note: 'An estimate.',
  ingredients: [{ name: 'Rice', grams: 150, calories: 130, protein: 2.7, fat: 0.3, carbs: 28 }],
  calories: 195,
  protein: 4,
  fat: 0.5,
  carbs: 42,
};

function fakeApi(handlers: Partial<Record<'get' | 'post' | 'upload', (...args: any[]) => Promise<any>>>): Api {
  return { request: jest.fn(), get: handlers.get ?? jest.fn(), post: handlers.post ?? jest.fn(), del: jest.fn(), upload: handlers.upload ?? jest.fn() } as unknown as Api;
}

/** React Native's FormData takes {uri, name, type} for a file; Node's would turn that into text. Record what is appended instead. */
class RecordingFormData {
  parts: { fieldName: string; string?: string; uri?: string; name?: string; type?: string }[] = [];
  append(fieldName: string, value: unknown) {
    this.parts.push(typeof value === 'string' ? { fieldName, string: value } : { fieldName, ...(value as object) });
  }
}
const realFormData = global.FormData;
beforeAll(() => {
  (global as unknown as { FormData: unknown }).FormData = RecordingFormData;
});
afterAll(() => {
  global.FormData = realFormData;
});
const partsOf = (form: FormData) => (form as unknown as RecordingFormData).parts;

describe('analyzeFood', () => {
  it('uploads the photo with the note and returns the parsed result', async () => {
    const upload = jest.fn(async () => FOOD);
    const result = await scanEndpoints(fakeApi({ upload })).analyzeFood({ uri: 'file:///meal.jpg' }, '  with extra chilli ');
    expect(result.food_name).toBe('Pad kra pao');
    expect(upload).toHaveBeenCalledWith('/api/analyze-food', expect.anything(), ANALYZE_TIMEOUT_MS);
    const parts = partsOf((upload.mock.calls[0] as unknown[])[1] as FormData);
    expect(parts.find((p) => p.fieldName === 'image')).toMatchObject({ uri: 'file:///meal.jpg', name: 'photo.jpg', type: 'image/jpeg' });
    expect(parts.find((p) => p.fieldName === 'note')?.string).toBe('with extra chilli');
  });

  it('sends no note when there is none, and keeps the file name and type it was given', async () => {
    const upload = jest.fn(async () => FOOD);
    await scanEndpoints(fakeApi({ upload })).analyzeFood({ uri: 'file:///a.png', name: 'a.png', mimeType: 'image/png' }, '   ');
    const parts = partsOf((upload.mock.calls[0] as unknown[])[1] as FormData);
    expect(parts.map((p) => p.fieldName)).toEqual(['image']);
    expect(parts[0]).toMatchObject({ name: 'a.png', type: 'image/png' });
  });

  it('lets the consent refusal, a rate limit and a server error through untouched', async () => {
    for (const error of [new ApiError('Turn on AI features.', 403, { needs_ai_consent: true }), new ApiError('slow down', 429, {}, 120), new ApiError("Couldn't analyze that photo.", 502)]) {
      await expect(scanEndpoints(fakeApi({ upload: async () => { throw error; } })).analyzeFood({ uri: 'x' })).rejects.toBe(error);
    }
  });

  it('an answer with nothing usable in it is an error, not an empty result', async () => {
    const api = scanEndpoints(fakeApi({ upload: async () => ({ ok: true, food_name: 'Unknown', ingredients: [] }) }));
    await expect(api.analyzeFood({ uri: 'x' })).rejects.toMatchObject({ status: 502 });
  });
});

describe('barcodes', () => {
  it('a photo of a barcode: found', async () => {
    const upload = jest.fn(async () => ({ ...FOOD, data_source: 'Open Food Facts' }));
    const outcome = await scanEndpoints(fakeApi({ upload })).scanBarcodePhoto({ uri: 'file:///b.jpg' });
    expect(outcome).toMatchObject({ kind: 'found', result: { data_source: 'Open Food Facts' } });
    expect(upload).toHaveBeenCalledWith('/api/scan-barcode', expect.anything());
    expect(partsOf((upload.mock.calls[0] as unknown[])[1] as FormData).some((p) => p.fieldName === 'live')).toBe(false);
  });

  it('a live camera frame says so, so routine misses are not logged', async () => {
    const upload = jest.fn(async () => FOOD);
    await scanEndpoints(fakeApi({ upload })).scanBarcodePhoto({ uri: 'f' }, true);
    expect(partsOf((upload.mock.calls[0] as unknown[])[1] as FormData).find((p) => p.fieldName === 'live')?.string).toBe('1');
  });

  it('digits the phone already read: found', async () => {
    const post = jest.fn(async () => FOOD);
    expect((await scanEndpoints(fakeApi({ post })).lookupBarcode('8850123456789')).kind).toBe('found');
    expect(post).toHaveBeenCalledWith('/api/lookup-barcode', { barcode: '8850123456789' });
  });

  it('no such product is a normal outcome carrying the barcode (so the person can make it themselves)', async () => {
    const api = scanEndpoints(fakeApi({ post: async () => { throw new ApiError('No product found.', 200, { ok: false, not_found: true, barcode: '123' }); } }));
    expect(await api.lookupBarcode('123')).toEqual({ kind: 'not-found', barcode: '123', message: 'No product found.' });
  });

  it('a failed lookup behind a barcode that WAS read keeps the barcode; an unreadable photo has none', async () => {
    const lookupFailed = scanEndpoints(fakeApi({ post: async () => { throw new ApiError('Database down.', 502, { ok: false, barcode: '456' }); } }));
    expect(await lookupFailed.lookupBarcode('456')).toEqual({ kind: 'failed', barcode: '456', message: 'Database down.' });
    const unreadable = scanEndpoints(fakeApi({ upload: async () => { throw new ApiError('No barcode found.', 502); } }));
    expect(await unreadable.scanBarcodePhoto({ uri: 'x' })).toEqual({ kind: 'failed', barcode: null, message: 'No barcode found.' });
  });

  it('a "not found" with no barcode to offer is not a not-found (nothing to create a food from)', async () => {
    const api = scanEndpoints(fakeApi({ post: async () => { throw new ApiError('x', 200, { ok: false, not_found: true }); } }));
    await expect(api.lookupBarcode('1')).rejects.toBeInstanceOf(ApiError);
  });

  it('everything else (too large, rate limited, signed out, no signal) is an error for the caller', async () => {
    for (const error of [new ApiError('big', 413), new ApiError('slow', 429, {}, 30), new ApiError('out', 401), new ApiError('offline', 0), new ApiError('boom', 500)]) {
      await expect(scanEndpoints(fakeApi({ upload: async () => { throw error; } })).scanBarcodePhoto({ uri: 'x' })).rejects.toBe(error);
    }
  });

  it('an error that is not an ApiError is rethrown as it is', async () => {
    const boom = new TypeError('bug');
    await expect(scanEndpoints(fakeApi({ post: async () => { throw boom; } })).lookupBarcode('1')).rejects.toBe(boom);
  });
});

describe('searchFoodsOnline', () => {
  it('asks for the trimmed query and returns the readable results', async () => {
    const get = jest.fn(async () => ({ ok: true, results: [FOOD, { food_name: 'Bad', ingredients: [] }, null, { ...FOOD, food_name: 'Second' }] }));
    const results = await scanEndpoints(fakeApi({ get })).searchFoodsOnline('  nutella ');
    expect(get).toHaveBeenCalledWith('/api/search-food-online', { q: 'nutella' });
    expect(results.map((r) => r.food_name)).toEqual(['Pad kra pao', 'Second']);
  });

  it('an answer without results is no results', async () => {
    expect(await scanEndpoints(fakeApi({ get: async () => ({ ok: true }) })).searchFoodsOnline('x')).toEqual([]);
  });
});

describe('survivors: what counts as a barcode', () => {
  it('a barcode field that is not text is no barcode (so there is nothing to create a food from)', async () => {
    const api = scanEndpoints(fakeApi({ post: async () => { throw new ApiError('x', 200, { ok: false, not_found: true, barcode: 123 }); } }));
    await expect(api.lookupBarcode('1')).rejects.toBeInstanceOf(ApiError);
    const failing = scanEndpoints(fakeApi({ post: async () => { throw new ApiError('down', 502, { ok: false, barcode: 123 }); } }));
    expect(await failing.lookupBarcode('1')).toEqual({ kind: 'failed', barcode: null, message: 'down' });
    const blank = scanEndpoints(fakeApi({ post: async () => { throw new ApiError('down', 502, { ok: false, barcode: '' }); } }));
    expect(await blank.lookupBarcode('1')).toMatchObject({ kind: 'failed', barcode: null });
  });
});
