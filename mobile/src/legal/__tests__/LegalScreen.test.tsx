import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { LegalPage } from '../LegalScreen';
import { LEGAL_PAGES, plainText, type LegalBlock, type LegalRun } from '../pages';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })) }));

const runsOf = (block: LegalBlock): LegalRun[] => (block.type === 'ul' ? block.items.flatMap((i) => i.runs) : block.runs);

beforeEach(() => jest.clearAllMocks());

describe('LegalPage', () => {
  it('shows the page: its headings as headers, its paragraphs and its date', async () => {
    await render(<LegalPage page="terms" />);
    const headings = LEGAL_PAGES.terms.blocks.filter((b) => b.type === 'h').map(runsOf);
    expect(headings.length).toBeGreaterThan(5);
    for (const h of headings) expect(screen.getByRole('header', { name: plainText(h) })).toBeOnTheScreen();
    expect(screen.getByText(/Last updated/)).toBeOnTheScreen();
    expect(screen.getByText(/sole trader/)).toBeOnTheScreen();
  });

  it('draws list entries with their publisher note (the sources page)', async () => {
    await render(<LegalPage page="sources" />);
    expect(screen.getByText('Powered by fatsecret')).toBeOnTheScreen();
    expect(screen.getByText(/Barcode nutrition data for products Open Food Facts does not have/)).toBeOnTheScreen();
  });

  it('a link to another page opens that page inside the app, at the entry it names', async () => {
    await render(<LegalPage page="terms" />);
    await fireEvent.press(screen.getAllByRole('link', { name: 'Refund Policy' })[0]);
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/legal/[page]', params: { page: 'refunds' } });
  });

  it('an outside link opens in the browser sheet and an e-mail address in the mail app; nothing opens by itself', async () => {
    await render(<LegalPage page="sources" />);
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('link', { name: 'Powered by fatsecret' }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith('https://www.fatsecret.com');
    await render(<LegalPage page="support" />);
    const address = LEGAL_PAGES.support.blocks.flatMap(runsOf).find((r) => r.link?.href?.startsWith('mailto:'))!;
    await fireEvent.press(screen.getAllByRole('link', { name: address.t })[0]);
    expect(Linking.openURL).toHaveBeenLastCalledWith(address.link!.href);
  });

  it('opened at a section it still shows the whole page, heading included', async () => {
    await render(<LegalPage page="privacy" section="ai" />);
    expect(screen.getByRole('header', { name: 'AI processing by a third party' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Who we are' })).toBeOnTheScreen();
  });
});
