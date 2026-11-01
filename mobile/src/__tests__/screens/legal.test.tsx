import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView } from 'react-native';

import LegalRoute from '@/app/legal/[page]';
import { LegalPage } from '@/legal/LegalScreen';

const mockParams: { current: Record<string, string | undefined> } = { current: {} };
const mockRedirect = jest.fn();
const mockScreen = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => mockParams.current,
  Redirect: (props: { href: string }) => {
    mockRedirect(props.href);
    return null;
  },
  Stack: { Screen: (props: { options: unknown }) => { mockScreen(props.options); return null; } },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.current = {};
});

describe('the /legal/[page] route', () => {
  it('shows the page it is asked for, titled by Settings\' own label, with the header on', async () => {
    mockParams.current = { page: 'privacy' };
    await render(<LegalRoute />);
    expect(screen.getByRole('header', { name: 'Who we are' })).toBeOnTheScreen();
    expect(mockScreen).toHaveBeenLastCalledWith({ headerShown: true, title: 'Privacy Policy' });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('sends anything that is not one of the six pages back to the start', async () => {
    for (const page of [undefined, '', 'about', 'Privacy', '../privacy', 'constructor']) {
      mockRedirect.mockClear();
      mockParams.current = { page };
      await render(<LegalRoute />);
      expect(mockRedirect).toHaveBeenCalledWith('/');
    }
  });
});

describe('opening a page at a section', () => {
  // the test environment's ScrollView is a bare class: give it the method the screen calls, and watch it
  const scrollTo = jest.fn();
  beforeEach(() => {
    scrollTo.mockClear();
    (ScrollView as unknown as { prototype: { scrollTo: typeof scrollTo } }).prototype.scrollTo = scrollTo;
  });

  it('scrolls to that heading once its position is known, a little above it, and not for any other heading', async () => {
    await render(<LegalPage page="privacy" section="ai" />);
    const ai = screen.getByRole('header', { name: 'AI processing by a third party' });
    await fireEvent(ai, 'layout', { nativeEvent: { layout: { x: 0, y: 900, width: 300, height: 30 } } });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 900 - 12, animated: false });
    await fireEvent(screen.getByRole('header', { name: 'Who we are' }), 'layout', { nativeEvent: { layout: { x: 0, y: 40, width: 300, height: 30 } } });
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('never scrolls above the top of the page', async () => {
    await render(<LegalPage page="privacy" section="ai" />);
    await fireEvent(screen.getByRole('header', { name: 'AI processing by a third party' }), 'layout', { nativeEvent: { layout: { x: 0, y: 5, width: 300, height: 30 } } });
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });

  it('does nothing about a section the page does not have', async () => {
    await render(<LegalPage page="privacy" section="nope" />);
    await fireEvent(screen.getByRole('header', { name: 'Who we are' }), 'layout', { nativeEvent: { layout: { x: 0, y: 40, width: 300, height: 30 } } });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('finds a heading further down another page (the credits on the sources page)', async () => {
    const id = 'credits';
    await render(<LegalPage page="sources" section={id} />);
    await fireEvent(screen.getByRole('header', { name: 'Data and content credits' }), 'layout', { nativeEvent: { layout: { x: 0, y: 700, width: 300, height: 30 } } });
    expect(scrollTo).toHaveBeenCalledWith({ y: 688, animated: false });
  });
});
