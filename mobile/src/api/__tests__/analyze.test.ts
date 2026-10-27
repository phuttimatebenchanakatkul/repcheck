import { ANALYZE_VIDEO_TIMEOUT_MS, analyzeEndpoints, uploadNameAndType } from '../analyze';
import { ApiError, type Api } from '../client';

const ANALYSIS = {
  ok: true,
  id: 12,
  exercise_label: 'Back Squat',
  overall_score: 81,
  stretch_score: 80,
  squeeze_score: 82,
  favored: 'balanced',
  reps: 6,
  sections: [{ heading: 'Positives', css_class: 'positives', emphasis: 'featured', title_key: 'analyze.section.positives', summary_html: '<p>Good.</p>', detail_html: null }],
  created_at: '2026-10-27T10:00:00+00:00',
  video_url: 'https://files.example/clip.mp4',
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

describe('uploadNameAndType', () => {
  it('keeps a good name and type', () => {
    expect(uploadNameAndType({ uri: 'file:///x/IMG_1.MOV', name: 'IMG_1.MOV', mimeType: 'video/quicktime' })).toEqual({ name: 'IMG_1.mov', type: 'video/quicktime' });
  });

  it('finds the extension in the path when the picker gave no name', () => {
    expect(uploadNameAndType({ uri: 'file:///tmp/ImagePicker/abc.mp4?x=1' })).toEqual({ name: 'set.mp4', type: 'video/mp4' });
  });

  it('finds it in the type when neither name nor path has one', () => {
    expect(uploadNameAndType({ uri: 'ph://ABC-123', mimeType: 'video/quicktime' })).toEqual({ name: 'set.mov', type: 'video/quicktime' });
    expect(uploadNameAndType({ uri: 'content://media/42', mimeType: 'VIDEO/WEBM' })).toEqual({ name: 'set.webm', type: 'video/webm' });
  });

  it('falls back to an mp4 the server will accept', () => {
    expect(uploadNameAndType({ uri: 'content://media/42' })).toEqual({ name: 'set.mp4', type: 'video/mp4' });
    expect(uploadNameAndType({ uri: 'content://media/42', name: 'clip.xyz', mimeType: 'application/octet-stream' })).toEqual({ name: 'clip.mp4', type: 'video/mp4' });
  });

  it('a name with an extension the server would refuse is replaced, not echoed', () => {
    expect(uploadNameAndType({ uri: 'file:///a', name: 'evil.exe', mimeType: 'video/mp4' }).name).toBe('evil.mp4');
  });

  it('a type that disagrees with the name is corrected to the name', () => {
    expect(uploadNameAndType({ uri: 'file:///a.mov', name: 'a.mov', mimeType: 'video/mp4' })).toEqual({ name: 'a.mov', type: 'video/quicktime' });
  });

  it('strips odd characters and limits the length', () => {
    const { name } = uploadNameAndType({ uri: 'file:///a', name: `my set (1)/${'x'.repeat(100)}.mp4` });
    expect(name).toMatch(/^[\w.-]+\.mp4$/);
    expect(name.length).toBeLessThanOrEqual(64);
  });
});

describe('analyzeVideo', () => {
  it('uploads the clip with the exercise, on the long timeout, and returns the parsed analysis', async () => {
    const upload = jest.fn(async () => ANALYSIS);
    const result = await analyzeEndpoints(fakeApi({ upload })).analyzeVideo({ uri: 'file:///set.mov', name: 'set.mov', mimeType: 'video/quicktime' }, '  Back Squat ');
    expect(result.id).toBe(12);
    expect(result.overall_score).toBe(81);
    expect(upload).toHaveBeenCalledWith('/api/analyze', expect.anything(), ANALYZE_VIDEO_TIMEOUT_MS);
    const parts = partsOf((upload.mock.calls[0] as unknown[])[1] as FormData);
    expect(parts.find((p) => p.fieldName === 'video')).toMatchObject({ uri: 'file:///set.mov', name: 'set.mov', type: 'video/quicktime' });
    expect(parts.find((p) => p.fieldName === 'exercise')?.string).toBe('Back Squat');
  });

  it('waits long enough for a model to read a clip', () => {
    expect(ANALYZE_VIDEO_TIMEOUT_MS).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it('an answer that is not an analysis is a 502, not a crash', async () => {
    const upload = jest.fn(async () => ({ ok: true, id: 'x' }));
    await expect(analyzeEndpoints(fakeApi({ upload })).analyzeVideo({ uri: 'file:///a.mp4' }, 'Row')).rejects.toMatchObject({ status: 502 });
  });

  it('lets the API errors through: consent, limit, a bad clip', async () => {
    const upload = jest.fn().mockRejectedValueOnce(new ApiError('Allow AI', 403, { needs_ai_consent: true })).mockRejectedValueOnce(new ApiError('Limit', 429, {}, 120));
    const api = analyzeEndpoints(fakeApi({ upload }));
    await expect(api.analyzeVideo({ uri: 'file:///a.mp4' }, 'Row')).rejects.toMatchObject({ needsAiConsent: true });
    await expect(api.analyzeVideo({ uri: 'file:///a.mp4' }, 'Row')).rejects.toMatchObject({ status: 429, retryAfter: 120 });
  });
});

describe('the history routes', () => {
  it('lists the entries', async () => {
    const get = jest.fn(async () => ({ ok: true, entries: [{ id: 3, exercise_label: 'Row', overall_score: 70, reps: 8, created_at: '2026-10-27T10:00:00+00:00', has_video: true }] }));
    const entries = await analyzeEndpoints(fakeApi({ get })).analysisHistory();
    expect(get).toHaveBeenCalledWith('/api/analyze/history');
    expect(entries.map((e) => e.id)).toEqual([3]);
  });

  it('opens one by id', async () => {
    const get = jest.fn(async () => ANALYSIS);
    expect((await analyzeEndpoints(fakeApi({ get })).analysis(12)).exercise_label).toBe('Back Squat');
    expect(get).toHaveBeenCalledWith('/api/analyze/history/12');
  });

  it('a stored analysis that cannot be read is a 502', async () => {
    const get = jest.fn(async () => ({ ok: true }));
    await expect(analyzeEndpoints(fakeApi({ get })).analysis(1)).rejects.toMatchObject({ status: 502 });
  });

  it('a missing one stays a 404 for the screen to show', async () => {
    const get = jest.fn().mockRejectedValue(new ApiError('Not found.', 404));
    await expect(analyzeEndpoints(fakeApi({ get })).analysis(99)).rejects.toMatchObject({ status: 404 });
  });
});

describe('latestAnalysis', () => {
  it('the newest, or null when there is none yet', async () => {
    const get = jest.fn().mockResolvedValueOnce(ANALYSIS).mockRejectedValueOnce(new ApiError('Not found.', 404)).mockRejectedValueOnce(new ApiError('boom', 500));
    const api = analyzeEndpoints(fakeApi({ get }));
    expect((await api.latestAnalysis())?.id).toBe(12);
    expect(await api.latestAnalysis()).toBeNull();
    await expect(api.latestAnalysis()).rejects.toMatchObject({ status: 500 });
    expect(get).toHaveBeenCalledWith('/api/analyze/latest');
  });
});

describe('analysisVideoUrl', () => {
  it('a fresh link, null when there is no clip, an error for anything else', async () => {
    const get = jest.fn().mockResolvedValueOnce({ ok: true, url: 'https://files.example/c.mp4' }).mockRejectedValueOnce(new ApiError('Not found.', 404)).mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new ApiError('boom', 500));
    const api = analyzeEndpoints(fakeApi({ get }));
    expect(await api.analysisVideoUrl(4)).toBe('https://files.example/c.mp4');
    expect(get).toHaveBeenCalledWith('/api/analyze/video/4');
    expect(await api.analysisVideoUrl(4)).toBeNull();
    expect(await api.analysisVideoUrl(4)).toBeNull();
    await expect(api.analysisVideoUrl(4)).rejects.toMatchObject({ status: 500 });
  });
});
