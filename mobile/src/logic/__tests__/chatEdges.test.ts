import { ANALYSIS_CHAT_WINDOW_MS, chatBlocks, cleanSources } from '../chat';

describe('citation fields', () => {
  it('a publisher that is not text, or is empty, is none', () => {
    const base = { title: 't', url: 'https://example.org' };
    expect(cleanSources([{ ...base, publisher: 5 }])[0].publisher).toBeNull();
    expect(cleanSources([{ ...base, publisher: '' }])[0].publisher).toBeNull();
    expect(cleanSources([{ ...base, publisher: null }])[0].publisher).toBeNull();
    expect(cleanSources([{ ...base, publisher: 'WHO' }])[0].publisher).toBe('WHO');
  });
});

describe('bold runs carry no empty neighbours', () => {
  const plain = (text: string) => ({ text, bold: false, italic: false, code: false });
  const bold = (text: string) => ({ text, bold: true, italic: false, code: false });

  it('a line that starts with bold has no empty run before it', () => {
    expect(chatBlocks('**a** b')[0].runs).toEqual([bold('a'), plain(' b')]);
  });

  it('a line that ends with bold has no empty run after it', () => {
    expect(chatBlocks('a **b**')[0].runs).toEqual([plain('a '), bold('b')]);
    expect(chatBlocks('**only**')[0].runs).toEqual([bold('only')]);
  });

  it('two bold stretches in a row', () => {
    expect(chatBlocks('**a****b**')[0].runs).toEqual([bold('a'), bold('b')]);
  });
});

describe('the window an analysis chat stays open', () => {
  it('is exactly twenty-four hours', () => {
    expect(ANALYSIS_CHAT_WINDOW_MS).toBe(86_400_000);
  });
});
