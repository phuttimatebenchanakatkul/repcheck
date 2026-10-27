/** The HYROX routes that are the server's (api/routes/social.py): a finished race's time on the leaderboard. Races themselves are the person's own data. */
import type { Api } from './client';

export interface LeaderboardResult {
  gender: string;
  category: string;
  format: string;
  total_seconds: number;
}

export function hyroxEndpoints(api: Api) {
  return {
    /**
     * Puts a finished race's time on the global leaderboard (the server keeps each person's fastest per gender, category and format).
     * Best effort: the race is already saved to the history, so a refusal or no signal just means it does not count there yet. True if taken.
     */
    async submitHyroxResult(result: LeaderboardResult): Promise<boolean> {
      try {
        await api.post('/api/hyrox/results', result);
        return true;
      } catch {
        return false;
      }
    },
  };
}
