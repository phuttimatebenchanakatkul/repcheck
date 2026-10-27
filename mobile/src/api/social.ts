/** Friends, blocking and reporting (api/routes/social.py). The tables are the server's alone: the app reads and writes them only through these. */
import { ApiError, type Api } from './client';

export interface Friend {
  id: string;
  name: string;
}

export interface FriendsList {
  code: string;
  friends: Friend[];
}

/** Why an account can be reported (api/social.py REPORT_REASONS); the choices on the sheet are these, in this order. */
export const REPORT_REASONS = ['offensive_name', 'impersonation', 'spam', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** One person, or null for anything that is not an id and a name. A blank name is kept as "" (the row is still blockable). */
export function parsePerson(value: unknown): Friend | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null;
  return { id: value.id, name: typeof value.name === 'string' ? value.name : '' };
}

const people = (value: unknown): Friend[] | null => {
  if (!Array.isArray(value)) return null;
  const list = value.map(parsePerson);
  return list.every((person): person is Friend => person !== null) ? list : null;
};

export function parseFriends(body: unknown): FriendsList | null {
  if (!isRecord(body) || typeof body.code !== 'string' || !body.code) return null;
  const friends = people(body.friends);
  return friends ? { code: body.code, friends } : null;
}

const unreadable = (body: Record<string, unknown>) => new ApiError("Couldn't read that result. Please try again.", 502, body);

export function socialEndpoints(api: Api) {
  return {
    /** My friend code and my friends (blocked people left out both ways, by the server). */
    async friends(): Promise<FriendsList> {
      const body = await api.get('/api/friends');
      const list = parseFriends(body);
      if (!list) throw unreadable(body);
      return list;
    },

    /** Befriends the owner of a code, both ways. Throws ApiError with the server's words (no such code, too many tries, ...). */
    async addFriend(code: string): Promise<Friend> {
      const body = await api.post('/api/friends/add', { code });
      const friend = isRecord(body) ? parsePerson(body.friend) : null;
      if (!friend) throw unreadable(body);
      return friend;
    },

    /** The people I have blocked, newest first. */
    async blockedAccounts(): Promise<Friend[]> {
      const body = await api.get('/api/safety/blocks');
      const list = isRecord(body) ? people(body.blocked) : null;
      if (!list) throw unreadable(body);
      return list;
    },

    async blockAccount(userId: string): Promise<void> {
      await api.post('/api/safety/block', { user_id: userId });
    },

    async unblockAccount(userId: string): Promise<void> {
      await api.del('/api/safety/block', { user_id: userId });
    },

    /** Reports an account's name. The server blocks it for me as well, so there is no second step. */
    async reportAccount(userId: string, reason: ReportReason): Promise<void> {
      await api.post('/api/safety/report', { user_id: userId, reason });
    },
  };
}
