import { WEBSITE_URL } from '../../links';
import { MAX_FRIEND_CODE_CHARS, codeFromScan, friendLink, initialOf } from '../social';

describe('the link in a friend QR', () => {
  it('is the website’s add-friend page with the code', () => {
    expect(friendLink('RC-A1B2C3')).toBe(`${WEBSITE_URL}/friends?add=RC-A1B2C3`);
  });

  it('the code is escaped, so it cannot add a second parameter', () => {
    expect(friendLink('a&b=c')).toBe(`${WEBSITE_URL}/friends?add=a%26b%3Dc`);
  });

  it('is read back to the same code', () => {
    expect(codeFromScan(friendLink('RC-A1B2C3'))).toBe('RC-A1B2C3');
  });
});

describe('the code in a scan', () => {
  it.each([
    ['RC-A1B2C3', 'RC-A1B2C3'],
    ['  rc-a1b2c3  ', 'RC-A1B2C3'],
    ['https://repcheck-q0m4.onrender.com/friends?add=RC-A1B2C3', 'RC-A1B2C3'],
    ['https://example.com/friends?x=1&add=rc-ff00aa&y=2', 'RC-FF00AA'],
    ['https://example.com/friends?add=RC-A1B2C3#top', 'RC-A1B2C3'],
    ['https://example.com/friends?add=RC%2DA1B2C3', 'RC-A1B2C3'],
    ['/friends?add=RC-A1B2C3', 'RC-A1B2C3'],
  ])('%s -> %s', (data, code) => {
    expect(codeFromScan(data)).toBe(code);
  });

  it.each([[''], ['   '], ['https://example.com/menu'], ['http://example.com'], ['hello world'], ['RC-A1B2C3 extra'], ['https://example.com/friends?add='], ['https://example.com/friends?add=%E0%A4%A'], ['RC_A1B2C3'], ['รหัส']])(
    'something that cannot be a code is ignored: %j',
    (data) => {
      expect(codeFromScan(data)).toBeNull();
    },
  );

  it('a link with a digit in its scheme is still a link to somewhere else', () => {
    expect(codeFromScan('web2://example.com/x')).toBeNull();
    expect(codeFromScan('s3+x.y-z://bucket/key')).toBeNull();
  });

  it('the longest it will pass on is the longest the server will look up', () => {
    expect(MAX_FRIEND_CODE_CHARS).toBe(32);
    expect(codeFromScan('A'.repeat(32))).toBe('A'.repeat(32));
    expect(codeFromScan('A'.repeat(33))).toBeNull();
    expect(codeFromScan(`https://x.test/friends?add=${'A'.repeat(33)}`)).toBeNull();
  });
});

describe('the letter on an avatar', () => {
  it.each([
    ['sam', 'S'],
    ['  alex', 'A'],
    ['', '?'],
    ['   ', '?'],
    ['😀 fun', '😀'],
    ['สมชาย', 'ส'],
    ['élan', 'É'],
  ])('%j -> %s', (name, letter) => {
    expect(initialOf(name)).toBe(letter);
  });
});
