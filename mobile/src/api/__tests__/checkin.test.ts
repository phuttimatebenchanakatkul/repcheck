import { ApiError, type Api } from '../client';
import { CHECKIN_TIMEOUT_MS, checkinEndpoints } from '../coaching';

const ADJUSTMENT = { calories: 1950, protein: 150, fat: 62, carbs: 198, delta: -80, reason: 'Your weight is not moving.' };

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

const api = (over: Partial<Record<keyof Api, jest.Mock>>) => ({ post: jest.fn(), get: jest.fn(), del: jest.fn(), upload: jest.fn(), request: jest.fn(), ...over }) as unknown as Api;

describe('weeklyAdjustment', () => {
  it('posts the check-in, with room for the model to read photos, and returns the adjustment', async () => {
    const request = jest.fn(async () => ({ ok: true, adjustment: ADJUSTMENT }));
    const result = await checkinEndpoints(api({ request })).weeklyAdjustment({ aspiration: 'lose' });
    expect(request).toHaveBeenCalledWith('/api/coaching/weekly-adjustment', { method: 'POST', json: { aspiration: 'lose' }, timeoutMs: CHECKIN_TIMEOUT_MS });
    expect(CHECKIN_TIMEOUT_MS).toBe(60_000);
    expect(result).toEqual(ADJUSTMENT);
  });

  it('"no change needed" is null', async () => {
    expect(await checkinEndpoints(api({ request: jest.fn(async () => ({ ok: true, adjustment: null })) })).weeklyAdjustment({})).toBeNull();
  });

  it('an answer that is neither is a 502, never "on track", so the week is not spent', async () => {
    for (const body of [{ ok: true }, { ok: true, adjustment: 'x' }, { ok: true, adjustment: { calories: 1 } }, {}]) {
      await expect(checkinEndpoints(api({ request: jest.fn(async () => body) })).weeklyAdjustment({})).rejects.toMatchObject({ status: 502 });
    }
  });

  it('a refusal is passed on with its words', async () => {
    const request = jest.fn().mockRejectedValue(new ApiError('Please choose an activity level.', 400));
    await expect(checkinEndpoints(api({ request })).weeklyAdjustment({})).rejects.toMatchObject({ status: 400, message: 'Please choose an activity level.' });
  });
});

describe('uploadCheckinPhoto', () => {
  const image = { uri: 'file:///front.jpg', name: 'front.jpg', mimeType: 'image/jpeg' };

  it('sends the photo with its angle and day, and returns the id it was kept under', async () => {
    const upload = jest.fn(async (...args: unknown[]) => (args.length ? { ok: true, id: 41 } : {}));
    expect(await checkinEndpoints(api({ upload })).uploadCheckinPhoto(image, 'front', '2026-10-27')).toBe(41);
    const [path, form, timeout] = upload.mock.calls[0] as unknown as [string, FormData, number];
    expect(path).toBe('/api/checkin/photo');
    expect(timeout).toBe(CHECKIN_TIMEOUT_MS);
    expect(partsOf(form)).toEqual([
      { fieldName: 'photo', uri: 'file:///front.jpg', name: 'front.jpg', type: 'image/jpeg' },
      { fieldName: 'angle', string: 'front' },
      { fieldName: 'date', string: '2026-10-27' },
    ]);
  });

  it('a photo without a name or type is sent as a JPEG', async () => {
    const upload = jest.fn(async () => ({ ok: true, id: 1 }));
    await checkinEndpoints(api({ upload })).uploadCheckinPhoto({ uri: 'file:///x' }, 'back', '2026-10-27');
    const form = (upload.mock.calls[0] as unknown as [string, FormData])[1];
    expect(partsOf(form)[0]).toEqual({ fieldName: 'photo', uri: 'file:///x', name: 'photo.jpg', type: 'image/jpeg' });
    expect(partsOf(form)[1]).toEqual({ fieldName: 'angle', string: 'back' });
  });

  it('is best effort: any failure, or an answer with no id, is null and never throws', async () => {
    expect(await checkinEndpoints(api({ upload: jest.fn().mockRejectedValue(new ApiError('Too big', 413)) })).uploadCheckinPhoto(image, 'front', 'd')).toBeNull();
    expect(await checkinEndpoints(api({ upload: jest.fn(async () => ({ ok: false })) })).uploadCheckinPhoto(image, 'front', 'd')).toBeNull();
    expect(await checkinEndpoints(api({ upload: jest.fn(async () => ({ id: '4' })) })).uploadCheckinPhoto(image, 'front', 'd')).toBeNull();
  });
});
