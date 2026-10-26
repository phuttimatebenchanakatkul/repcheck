import * as Crypto from 'expo-crypto';

import { newId } from '../ids';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
const randomUUID = Crypto.randomUUID as jest.Mock;

afterEach(() => {
  randomUUID.mockReset();
});

describe('newId', () => {
  it('is the platform’s UUID when there is one', () => {
    randomUUID.mockReturnValue('11111111-2222-3333-4444-555555555555');
    expect(newId()).toBe('11111111-2222-3333-4444-555555555555');
  });

  it.each([[undefined], [null], [''], [42]])('falls back to a made-up id when the generator answers %p', (answer) => {
    randomUUID.mockReturnValue(answer);
    const id = newId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(8);
  });

  it('falls back when the generator throws', () => {
    randomUUID.mockImplementation(() => {
      throw new Error('no crypto');
    });
    expect(newId().length).toBeGreaterThan(8);
  });

  it('fallback ids never repeat, even in the same millisecond', () => {
    randomUUID.mockReturnValue(undefined);
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(ids.size).toBe(500);
  });
});

describe('newId: edge', () => {
  it('a one-character id from the platform is still an id', () => {
    randomUUID.mockReturnValue('x');
    expect(newId()).toBe('x');
  });
});
