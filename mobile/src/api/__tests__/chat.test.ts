import { CHAT_TIMEOUT_MS, chatEndpoints } from '../chat';
import { ApiError, type Api } from '../client';

const REPLY = { ok: true, reply: 'Eat protein.', sources: [{ title: 'ISSN', publisher: 'ISSN', url: 'https://example.org/issn' }], limited: false, retry_after_seconds: 0 };

function fakeApi(request: (...args: any[]) => Promise<any>, post: (...args: any[]) => Promise<any> = jest.fn()): Api {
  return { request, get: jest.fn(), post, del: jest.fn(), upload: jest.fn() } as unknown as Api;
}

describe('the three chats', () => {
  it('the coach gets the message and the history, on the long timeout', async () => {
    const request = jest.fn(async () => REPLY);
    const reply = await chatEndpoints(fakeApi(request)).coachChat('How much protein?', [{ role: 'user', text: 'hi' }]);
    expect(request).toHaveBeenCalledWith('/api/coach-chat', { method: 'POST', json: { message: 'How much protein?', history: [{ role: 'user', text: 'hi' }] }, timeoutMs: CHAT_TIMEOUT_MS });
    expect(reply).toEqual({ reply: 'Eat protein.', sources: [{ title: 'ISSN', publisher: 'ISSN', url: 'https://example.org/issn' }], limited: false, retryAfterSeconds: 0 });
  });

  it('the analysis and workout chats also send their context', async () => {
    const request = jest.fn(async () => REPLY);
    const api = chatEndpoints(fakeApi(request));
    await api.analysisChat('Why?', [], { id: 3 });
    await api.workoutChat('Plan?', [], { today: [] });
    expect(request).toHaveBeenNthCalledWith(1, '/api/analyze-chat', { method: 'POST', json: { message: 'Why?', history: [], context: { id: 3 } }, timeoutMs: CHAT_TIMEOUT_MS });
    expect(request).toHaveBeenNthCalledWith(2, '/api/workout-chat', { method: 'POST', json: { message: 'Plan?', history: [], context: { today: [] } }, timeoutMs: CHAT_TIMEOUT_MS });
  });

  it('waits long enough for a model', () => {
    expect(CHAT_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('being over the limit is a reply, not an error', async () => {
    const request = jest.fn(async () => ({ ok: true, reply: 'Come back in 5 hours.', sources: [], limited: true, retry_after_seconds: 18000 }));
    expect(await chatEndpoints(fakeApi(request)).coachChat('hi', [])).toMatchObject({ limited: true, retryAfterSeconds: 18000 });
  });

  it('an answer that is not a reply is a 502', async () => {
    const request = jest.fn(async () => ({ ok: true }));
    await expect(chatEndpoints(fakeApi(request)).coachChat('hi', [])).rejects.toMatchObject({ status: 502 });
  });

  it('lets consent and validation errors through', async () => {
    const request = jest.fn().mockRejectedValueOnce(new ApiError('Allow AI', 403, { needs_ai_consent: true })).mockRejectedValueOnce(new ApiError('Message can’t be empty.', 400));
    const api = chatEndpoints(fakeApi(request));
    await expect(api.coachChat('hi', [])).rejects.toMatchObject({ needsAiConsent: true });
    await expect(api.coachChat('', [])).rejects.toMatchObject({ status: 400 });
  });
});

describe('reporting a reply', () => {
  it('names the chat, the reason and the reply', async () => {
    const post = jest.fn(async () => ({ ok: true }));
    await chatEndpoints(fakeApi(jest.fn(), post)).reportReply('workout_chat', 'inaccurate', 'Lift heavier.');
    expect(post).toHaveBeenCalledWith('/api/ai-report', { feature: 'workout_chat', reason: 'inaccurate', reply: 'Lift heavier.' });
  });

  it('too many waiting reports is an error the screen can show', async () => {
    const post = jest.fn().mockRejectedValue(new ApiError('You have too many reports waiting for review.', 429));
    await expect(chatEndpoints(fakeApi(jest.fn(), post)).reportReply('coach', 'other', 'x')).rejects.toMatchObject({ status: 429 });
  });
});
