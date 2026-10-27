/** Friend codes and how they travel: the website's friends page (templates/friends.html) and /api/friends/qr.png are the originals. */
import { WEBSITE_URL } from '../links';

/** The longest text the server will look up as a code (api/social.py MAX_FRIEND_CODE_CHARS); a real one is 9. */
export const MAX_FRIEND_CODE_CHARS = 32;

/** What a friend's QR code holds: a link to the add-friend page, so scanning it with any camera lands somewhere useful. */
export function friendLink(code: string): string {
  return `${WEBSITE_URL}/friends?add=${encodeURIComponent(code)}`;
}

/**
 * The code in whatever a scanner read: the link from `friendLink` (any host: an old build's QR points at the same page), or the bare
 * code. Null for text that cannot be a code, so a stray QR on a poster is ignored rather than sent to the server.
 */
export function codeFromScan(data: string): string | null {
  const text = data.trim();
  if (!text) return null;
  const query = text.match(/[?&]add=([^&#\s]*)/);
  let candidate = text;
  if (query) {
    try {
      candidate = decodeURIComponent(query[1]);
    } catch {
      return null;
    }
  }
  // Anything else (a link to somewhere else, a sentence) has characters a code never does.
  candidate = candidate.trim();
  return /^[A-Za-z0-9-]+$/.test(candidate) && candidate.length <= MAX_FRIEND_CODE_CHARS ? candidate.toUpperCase() : null;
}

/** The letter on a friend's avatar: the first character (a whole emoji or Thai letter, not half of one), upper case, "?" for a blank name. */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : '?';
}
