import { ApiError, type Api } from '../client';
import { REPORT_REASONS, parseFriends, parsePerson, socialEndpoints } from '../social';

const api = (over: Partial<Record<keyof Api, jest.Mock>>) => ({ post: jest.fn(), get: jest.fn(), del: jest.fn(), upload: jest.fn(), request: jest.fn(), ...over }) as unknown as Api;

describe('parsePerson', () => {
  it('reads an id and a name', () => {
    expect(parsePerson({ id: 'u-1', name: 'Sam' })).toEqual({ id: 'u-1', name: 'Sam' });
  });

  it('a blank or missing name is empty, so the row can still be blocked', () => {
    expect(parsePerson({ id: 'u-1', name: '' })).toEqual({ id: 'u-1', name: '' });
    expect(parsePerson({ id: 'u-1' })).toEqual({ id: 'u-1', name: '' });
    expect(parsePerson({ id: 'u-1', name: 7 })).toEqual({ id: 'u-1', name: '' });
  });

  it.each([[null], [undefined], ['x'], [[]], [{}], [{ id: '' }], [{ id: 5, name: 'x' }]])('not a person: %j', (value) => {
    expect(parsePerson(value)).toBeNull();
  });
});

describe('parseFriends', () => {
  it('reads my code and my friends', () => {
    expect(parseFriends({ ok: true, code: 'RC-A1B2C3', friends: [{ id: 'u-2', name: 'Alex' }] })).toEqual({ code: 'RC-A1B2C3', friends: [{ id: 'u-2', name: 'Alex' }] });
    expect(parseFriends({ code: 'RC-A1B2C3', friends: [] })).toEqual({ code: 'RC-A1B2C3', friends: [] });
  });

  it.each([[null], ['x'], [{}], [{ code: '', friends: [] }], [{ code: 'RC-1' }], [{ code: 'RC-1', friends: 'x' }], [{ code: 'RC-1', friends: [{ name: 'x' }] }], [{ code: 5, friends: [] }]])('not a friends list: %j', (body) => {
    expect(parseFriends(body)).toBeNull();
  });
});

describe('the endpoints', () => {
  it('friends reads /api/friends', async () => {
    const get = jest.fn(async () => ({ ok: true, code: 'RC-A1B2C3', friends: [{ id: 'u-2', name: 'Alex' }] }));
    expect(await socialEndpoints(api({ get })).friends()).toEqual({ code: 'RC-A1B2C3', friends: [{ id: 'u-2', name: 'Alex' }] });
    expect(get).toHaveBeenCalledWith('/api/friends');
  });

  it('an answer that is not a friends list is a 502', async () => {
    await expect(socialEndpoints(api({ get: jest.fn(async () => ({ ok: true })) })).friends()).rejects.toMatchObject({ status: 502 });
  });

  it('addFriend posts the code and returns the friend', async () => {
    const post = jest.fn(async () => ({ ok: true, friend: { id: 'u-2', name: 'Alex' } }));
    expect(await socialEndpoints(api({ post })).addFriend('RC-A1B2C3')).toEqual({ id: 'u-2', name: 'Alex' });
    expect(post).toHaveBeenCalledWith('/api/friends/add', { code: 'RC-A1B2C3' });
  });

  it('addFriend passes the server’s refusal on, and an answer with no friend is a 502', async () => {
    const post = jest.fn().mockRejectedValue(new ApiError('No user found with that code.', 404));
    await expect(socialEndpoints(api({ post })).addFriend('x')).rejects.toMatchObject({ status: 404, message: 'No user found with that code.' });
    await expect(socialEndpoints(api({ post: jest.fn(async () => ({ ok: true })) })).addFriend('x')).rejects.toMatchObject({ status: 502 });
    await expect(socialEndpoints(api({ post: jest.fn(async () => ({ ok: true, friend: 'x' })) })).addFriend('x')).rejects.toMatchObject({ status: 502 });
  });

  it('blockedAccounts reads /api/safety/blocks', async () => {
    const get = jest.fn(async () => ({ ok: true, blocked: [{ id: 'u-3', name: 'Bo' }] }));
    expect(await socialEndpoints(api({ get })).blockedAccounts()).toEqual([{ id: 'u-3', name: 'Bo' }]);
    expect(get).toHaveBeenCalledWith('/api/safety/blocks');
    await expect(socialEndpoints(api({ get: jest.fn(async () => ({ ok: true, blocked: 'x' })) })).blockedAccounts()).rejects.toMatchObject({ status: 502 });
    await expect(socialEndpoints(api({ get: jest.fn(async () => ({ ok: true })) })).blockedAccounts()).rejects.toMatchObject({ status: 502 });
  });

  it('block, unblock and report send the account id', async () => {
    const post = jest.fn(async () => ({ ok: true }));
    const del = jest.fn(async () => ({ ok: true }));
    const social = socialEndpoints(api({ post, del }));
    await social.blockAccount('u-3');
    await social.reportAccount('u-3', 'spam');
    await social.unblockAccount('u-3');
    expect(post).toHaveBeenNthCalledWith(1, '/api/safety/block', { user_id: 'u-3' });
    expect(post).toHaveBeenNthCalledWith(2, '/api/safety/report', { user_id: 'u-3', reason: 'spam' });
    expect(del).toHaveBeenCalledWith('/api/safety/block', { user_id: 'u-3' });
  });

  it('a refusal to block is passed on', async () => {
    const post = jest.fn().mockRejectedValue(new ApiError("You can't block yourself.", 400));
    await expect(socialEndpoints(api({ post })).blockAccount('me')).rejects.toMatchObject({ status: 400 });
  });

  it('the reasons are the server’s, in order', () => {
    expect([...REPORT_REASONS]).toEqual(['offensive_name', 'impersonation', 'spam', 'other']);
  });
});
