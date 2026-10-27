import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import { friendLink } from '@/logic/social';
import { dataHarness } from '@/testing/dataHarness';

import FriendsScreen from '../FriendsScreen';

const mockApi = { friends: jest.fn(), addFriend: jest.fn(), blockAccount: jest.fn(), reportAccount: jest.fn() };
const mockCamera = { lastProps: null as Record<string, any> | null, permission: { granted: true, canAskAgain: true } as { granted: boolean; canAskAgain: boolean } | null, request: jest.fn() };
const mockClipboard = { setStringAsync: jest.fn() };

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ state: { status: 'ready', profile: { id: 'user-1' } } }) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: (...a: unknown[]) => mockClipboard.setStringAsync(...a) }));
jest.mock('expo-camera', () => {
  const { View } = require('react-native');
  return {
    CameraView: (props: Record<string, any>) => {
      mockCamera.lastProps = props;
      return <View testID="camera" />;
    },
    useCameraPermissions: () => [mockCamera.permission, mockCamera.request],
  };
});
jest.mock('react-native-qrcode-svg', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: (props: { value: string }) => <Text testID="qr">{props.value}</Text> };
});

const ME = { code: 'RC-A1B2C3', friends: [{ id: 'u-2', name: 'Alex' }, { id: 'u-3', name: '' }] };

async function open() {
  const h = dataHarness();
  await render(
    <h.Provider>
      <FriendsScreen />
    </h.Provider>,
  );
  return h;
}
const press = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCamera.permission = { granted: true, canAskAgain: true };
  mockCamera.lastProps = null;
  mockApi.friends.mockResolvedValue(ME);
  mockApi.addFriend.mockResolvedValue({ id: 'u-9', name: 'Casey' });
  mockApi.blockAccount.mockResolvedValue(undefined);
  mockApi.reportAccount.mockResolvedValue(undefined);
  mockClipboard.setStringAsync.mockResolvedValue(true);
});

describe('your code', () => {
  it('shows the code, and a QR that opens the add-friend page with it', async () => {
    await open();
    expect(await screen.findByTestId('my-code')).toHaveTextContent('RC-A1B2C3');
    expect(screen.getByTestId('qr')).toHaveTextContent(friendLink('RC-A1B2C3'));
  });

  it('is copied, and says so for a moment', async () => {
    jest.useFakeTimers();
    try {
      await open();
      await press('Copy code');
      expect(mockClipboard.setStringAsync).toHaveBeenCalledWith('RC-A1B2C3');
      expect(await screen.findByRole('button', { name: 'Copied!' })).toBeOnTheScreen();
      await act(async () => {
        jest.advanceTimersByTime(1500);
      });
      expect(screen.getByRole('button', { name: 'Copy code' })).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a copy that fails says nothing happened', async () => {
    mockClipboard.setStringAsync.mockRejectedValueOnce(new Error('no'));
    await open();
    await press('Copy code');
    expect(screen.queryByRole('button', { name: 'Copied!' })).toBeNull();
  });

  it('is not shown before it is known', async () => {
    mockApi.friends.mockReturnValue(new Promise(() => undefined));
    await open();
    expect(screen.queryByTestId('my-code')).toBeNull();
    expect(screen.getByText('Loading...')).toBeOnTheScreen();
  });
});

describe('the friends list', () => {
  it('lists friends with their initial', async () => {
    await open();
    const row = await screen.findByTestId('friend-u-2');
    expect(within(row).getByText('Alex')).toBeOnTheScreen();
    expect(within(row).getByText('A')).toBeOnTheScreen();
    expect(within(screen.getByTestId('friend-u-3')).getByText('?')).toBeOnTheScreen();
  });

  it('says so when there are none', async () => {
    mockApi.friends.mockResolvedValue({ code: 'RC-A1B2C3', friends: [] });
    await open();
    expect(await screen.findByText('No friends added yet.')).toBeOnTheScreen();
  });

  it('a list that cannot be read offers to try again', async () => {
    mockApi.friends.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValue(ME);
    await open();
    expect(await screen.findByRole('alert')).toHaveTextContent("That didn't work. Try again.");
    await press('Try again');
    expect(await screen.findByTestId('friend-u-2')).toBeOnTheScreen();
  });
});

describe('adding a friend by typing', () => {
  it('cannot be sent empty', async () => {
    await open();
    await screen.findByTestId('my-code');
    expect(screen.getByRole('button', { name: 'Add' }).props.accessibilityState.disabled).toBe(true);
  });

  it('sends the code as typed (trimmed), says who was added, and reads the list again', async () => {
    await open();
    await fireEvent.changeText(await screen.findByLabelText("Enter your friend's code to add them."), '  rc-ff00aa ');
    mockApi.friends.mockResolvedValue({ ...ME, friends: [...ME.friends, { id: 'u-9', name: 'Casey' }] });
    await press('Add');
    expect(mockApi.addFriend).toHaveBeenCalledWith('rc-ff00aa');
    expect(await screen.findByTestId('add-status')).toHaveTextContent('Added Casey ✓');
    expect(await screen.findByTestId('friend-u-9')).toBeOnTheScreen();
    expect(screen.getByLabelText("Enter your friend's code to add them.").props.value).toBe('');
  });

  it('the server’s reason is shown, and the code stays so it can be fixed', async () => {
    mockApi.addFriend.mockRejectedValueOnce(new ApiError('No user found with that code.', 404));
    await open();
    await fireEvent.changeText(await screen.findByLabelText("Enter your friend's code to add them."), 'RC-NOPE00');
    await press('Add');
    expect(await screen.findByRole('alert')).toHaveTextContent('No user found with that code.');
    expect(screen.getByLabelText("Enter your friend's code to add them.").props.value).toBe('RC-NOPE00');
  });

  it('anything else is the general line', async () => {
    mockApi.addFriend.mockRejectedValueOnce(new ApiError('boom', 500));
    await open();
    await fireEvent.changeText(await screen.findByLabelText("Enter your friend's code to add them."), 'RC-A');
    await press('Add');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't add that friend.");
  });

  it('the button is busy while it is on its way, and a second tap sends nothing more', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockApi.addFriend.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await open();
    await fireEvent.changeText(await screen.findByLabelText("Enter your friend's code to add them."), 'RC-A');
    await press('Add');
    expect(screen.getByRole('button', { busy: true }).props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.getByTestId('add-status')).toHaveTextContent('Adding...');
    await act(async () => finish({ id: 'u-9', name: 'Casey' }));
    expect(mockApi.addFriend).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { busy: true })).toBeNull();
  });

  it('a second friend can be added after the first', async () => {
    await open();
    const field = await screen.findByLabelText("Enter your friend's code to add them.");
    await fireEvent.changeText(field, 'RC-AAAAAA');
    await press('Add');
    await screen.findByText('Added Casey ✓');
    await fireEvent.changeText(screen.getByLabelText("Enter your friend's code to add them."), 'RC-BBBBBB');
    await press('Add');
    await waitFor(() => expect(mockApi.addFriend).toHaveBeenCalledTimes(2));
    expect(mockApi.addFriend).toHaveBeenLastCalledWith('RC-BBBBBB');
  });

  it('a failed add can be tried again', async () => {
    mockApi.addFriend.mockRejectedValueOnce(new ApiError('No user found with that code.', 404));
    await open();
    await fireEvent.changeText(await screen.findByLabelText("Enter your friend's code to add them."), 'RC-AAAAAA');
    await press('Add');
    await screen.findByRole('alert');
    await press('Add');
    await waitFor(() => expect(mockApi.addFriend).toHaveBeenCalledTimes(2));
  });

  it('no signal is the general line, not the connection message', async () => {
    mockApi.addFriend.mockRejectedValueOnce(new ApiError('Could not reach the server. Check your connection and try again.', 0));
    await open();
    await fireEvent.changeText(await screen.findByLabelText("Enter your friend's code to add them."), 'RC-AAAAAA');
    await press('Add');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't add that friend.");
  });

  it('the field takes a code: upper case, no auto-correct', async () => {
    await open();
    const field = await screen.findByLabelText("Enter your friend's code to add them.");
    expect(field.props.autoCapitalize).toBe('characters');
    expect(field.props.autoCorrect).toBe(false);
  });
});

describe('adding a friend by scanning', () => {
  const scan = async (data: string) => act(async () => mockCamera.lastProps?.onBarcodeScanned({ data, type: 'qr' }));

  it('opens a camera that reads QR codes only, and closes it again', async () => {
    await open();
    await press('Scan QR');
    expect(await screen.findByTestId('camera')).toBeOnTheScreen();
    expect(mockCamera.lastProps?.barcodeScannerSettings).toEqual({ barcodeTypes: ['qr'] });
    await press('Stop scanning');
    expect(screen.queryByTestId('camera')).toBeNull();
  });

  it('adds the code in a friend’s QR, and stops scanning', async () => {
    await open();
    await press('Scan QR');
    await screen.findByTestId('camera');
    await scan(friendLink('RC-FF00AA'));
    await waitFor(() => expect(mockApi.addFriend).toHaveBeenCalledWith('RC-FF00AA'));
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(await screen.findByTestId('add-status')).toHaveTextContent('Added Casey ✓');
  });

  it('a QR that is not a friend code is ignored and scanning goes on', async () => {
    await open();
    await press('Scan QR');
    await screen.findByTestId('camera');
    await scan('https://example.com/menu');
    expect(mockApi.addFriend).not.toHaveBeenCalled();
    expect(screen.getByTestId('camera')).toBeOnTheScreen();
  });

  it('a camera that reports the same code again sends it once', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockApi.addFriend.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await open();
    await press('Scan QR');
    await screen.findByTestId('camera');
    const props = mockCamera.lastProps;
    await act(async () => {
      props?.onBarcodeScanned({ data: 'RC-FF00AA', type: 'qr' });
      props?.onBarcodeScanned({ data: 'RC-FF00AA', type: 'qr' });
    });
    await act(async () => finish({ id: 'u-9', name: 'Casey' }));
    expect(mockApi.addFriend).toHaveBeenCalledTimes(1);
  });

  it('with the camera off, says so and offers to ask again', async () => {
    mockCamera.permission = { granted: false, canAskAgain: true };
    await open();
    await press('Scan QR');
    expect(await screen.findByRole('alert')).toHaveTextContent('Camera access was denied.');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Scan QR' })[0]);
    expect(mockCamera.request).toHaveBeenCalled();
  });

  it('when it cannot be asked again, only says so', async () => {
    mockCamera.permission = { granted: false, canAskAgain: false };
    await open();
    await press('Scan QR');
    expect(await screen.findByRole('alert')).toHaveTextContent('Camera access was denied.');
    expect(screen.queryAllByRole('button', { name: 'Scan QR' })).toHaveLength(0);
  });

  it('waits while the permission is not known yet', async () => {
    mockCamera.permission = null;
    await open();
    await press('Scan QR');
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('report and block', () => {
  const openSheet = async (name = 'Alex') => {
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: `More options: ${name}` }));
  };

  it('every friend has a way in, named for them', async () => {
    await open();
    expect(await screen.findByRole('button', { name: 'More options: Alex' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'More options: ' })).toBeOnTheScreen();
  });

  it('offers to report or block, naming who', async () => {
    await openSheet();
    expect(await screen.findByText('Report this name')).toBeOnTheScreen();
    expect(screen.getByText('Block this account')).toBeOnTheScreen();
    expect(screen.getAllByText('Alex').length).toBeGreaterThan(0);
  });

  it('blocking asks the server, says so, and the list is read again without them', async () => {
    await openSheet();
    mockApi.friends.mockResolvedValue({ code: 'RC-A1B2C3', friends: [{ id: 'u-3', name: '' }] });
    await press('Block this account');
    expect(mockApi.blockAccount).toHaveBeenCalledWith('u-2');
    expect(await screen.findByTestId('safety-done')).toHaveTextContent("Blocked. You won't see this account again.");
    await waitFor(() => expect(screen.queryByTestId('friend-u-2')).toBeNull());
  });

  it('reporting asks for a reason first, then sends it', async () => {
    await openSheet();
    await press('Report this name');
    expect(await screen.findByText("What's wrong with it?")).toBeOnTheScreen();
    expect(mockApi.reportAccount).not.toHaveBeenCalled();
    await press('Spam or advertising');
    expect(mockApi.reportAccount).toHaveBeenCalledWith('u-2', 'spam');
    expect(await screen.findByTestId('safety-done')).toHaveTextContent("Thanks. We review reports within 24 hours, and we've blocked this account for you in the meantime.");
  });

  it.each([
    ['Offensive or inappropriate name', 'offensive_name'],
    ['Pretending to be someone else', 'impersonation'],
    ['Something else', 'other'],
  ])('the reason %s is sent as %s', async (label, id) => {
    await openSheet();
    await press('Report this name');
    await press(label);
    expect(mockApi.reportAccount).toHaveBeenCalledWith('u-2', id);
  });

  it('Back from the reasons returns to the choices', async () => {
    await openSheet();
    await press('Report this name');
    await press('Back');
    expect(await screen.findByText('Block this account')).toBeOnTheScreen();
  });

  it('a refusal is shown and the choices stay, so it can be tried again', async () => {
    mockApi.blockAccount.mockRejectedValueOnce(new ApiError('That account no longer exists.', 404));
    await openSheet();
    await press('Block this account');
    expect(await screen.findByRole('alert')).toHaveTextContent('That account no longer exists.');
    await press('Block this account');
    expect(await screen.findByTestId('safety-done')).toBeOnTheScreen();
  });

  it('a failure with no reason is the general line', async () => {
    mockApi.blockAccount.mockRejectedValueOnce(new ApiError('boom', 500));
    await openSheet();
    await press('Block this account');
    expect(await screen.findByRole('alert')).toHaveTextContent("That didn't work. Try again.");
  });

  it('a second tap while the server is answering sends nothing more', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockApi.blockAccount.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await openSheet();
    const block = await screen.findByRole('button', { name: 'Block this account' });
    await fireEvent.press(block);
    await fireEvent.press(block);
    await act(async () => finish(undefined));
    expect(mockApi.blockAccount).toHaveBeenCalledTimes(1);
  });

  it('Cancel closes the sheet, and it opens fresh for the next person', async () => {
    await openSheet();
    await press('Report this name');
    await press('Cancel');
    expect(screen.queryByText('Report this name')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'More options: Alex' }));
    expect(await screen.findByText('Report this name')).toBeOnTheScreen();
  });

  it('Done closes it after a block', async () => {
    await openSheet();
    await press('Block this account');
    await screen.findByTestId('safety-done');
    await press('Done');
    expect(screen.queryByTestId('safety-done')).toBeNull();
  });
});
