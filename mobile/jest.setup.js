// AsyncStorage is a native module; Jest gets its in-memory stand-in.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
