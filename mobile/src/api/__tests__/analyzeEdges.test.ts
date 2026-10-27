import { ANALYZE_VIDEO_TIMEOUT_MS, analyzeEndpoints, uploadNameAndType } from '../analyze';
import type { Api } from '../client';

describe('extensions with digits', () => {
  it.each([
    ['file:///a.m4v', 'set.m4v', 'video/x-m4v'],
    ['file:///a.mkv', 'set.mkv', 'video/x-matroska'],
    ['file:///a.MP4?x=1#y', 'set.mp4', 'video/mp4'],
    ['file:///a.avi', 'set.avi', 'video/x-msvideo'],
  ])('%s is sent as %s', (uri, name, type) => {
    expect(uploadNameAndType({ uri })).toEqual({ name, type });
  });
});

describe('the upload timeout', () => {
  it('is ten minutes', () => {
    expect(ANALYZE_VIDEO_TIMEOUT_MS).toBe(600_000);
  });
});

describe('a clip link that is not text', () => {
  it('is no link', async () => {
    const api = { get: jest.fn(async () => ({ ok: true, url: 5 })) } as unknown as Api;
    expect(await analyzeEndpoints(api).analysisVideoUrl(1)).toBeNull();
    const empty = { get: jest.fn(async () => ({ ok: true, url: '' })) } as unknown as Api;
    expect(await analyzeEndpoints(empty).analysisVideoUrl(1)).toBeNull();
  });
});
