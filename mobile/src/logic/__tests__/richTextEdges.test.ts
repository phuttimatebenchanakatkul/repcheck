import { parseHistory } from '../analyzeResult';
import { decodeEntities, parseRichText, plainText } from '../richText';

describe('entity edges', () => {
  it('decodes references with a zero inside them, in either case of x', () => {
    expect(decodeEntities('&#10;|&#x0A;|&#X0a;|&#x10;|&#100;')).toBe('\n|\n|\n|\u0010|d');
  });

  it('the smallest and largest code points that mean something', () => {
    expect(decodeEntities('&#1;')).toBe('\u0001');
    expect(decodeEntities('&#x10FFFF;')).toBe('\u{10FFFF}');
    expect(decodeEntities('&#x110000;')).toBe('&#x110000;');
    expect(decodeEntities('&#0;')).toBe('&#0;');
  });

  it('either side of the surrogate gap', () => {
    expect(decodeEntities('&#xD7FF;')).toBe('퟿');
    expect(decodeEntities('&#xE000;')).toBe('');
    expect(decodeEntities('&#xD800;&#xDFFF;')).toBe('&#xD800;&#xDFFF;');
  });
});

describe('block edges', () => {
  it('every heading level, but nothing that is not one, ends a block', () => {
    expect(parseRichText('a<h1>b</h1>c<h2>d</h2>e<h6>f</h6>g').map((b) => plainText([b]))).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(plainText(parseRichText('a<h7>b</h7>c<h0>d</h0>e'))).toBe('abcde');
  });

  it('lists and breaks end a block even between bare text', () => {
    expect(parseRichText('x<ul>y</ul>z<ol>w</ol>v<br>u').map((b) => plainText([b]))).toEqual(['x', 'y', 'z', 'w', 'v', 'u']);
  });

  it('text split by a tag it ignores is one run again', () => {
    expect(parseRichText('<p>a<span>b</span>c</p>')[0].runs).toEqual([{ text: 'abc', bold: false, italic: false, code: false }]);
  });

  it('a tag name with digits is read whole', () => {
    expect(parseRichText('a<h3 class="x">b</h3>c').map((b) => plainText([b]))).toEqual(['a', 'b', 'c']);
  });
});

describe('history entries need both an id and an exercise', () => {
  it('drops one with a bad id or a missing name', () => {
    const body = { entries: [{ id: 'x', exercise_label: 'Row' }, { id: 3 }, { id: 4, exercise_label: 5 }, { id: 5, exercise_label: 'Row' }] };
    expect(parseHistory(body).map((e) => e.id)).toEqual([5]);
  });
});
