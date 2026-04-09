const mockSubscription = {
  subscribe: jest.fn().mockResolvedValue({ successes: [], failures: [] }),
  unsubscribe: jest.fn().mockResolvedValue({ successes: [], failures: [] }),
  unsubscribeAll: jest.fn().mockResolvedValue({ successes: [], failures: [] }),
  ping: jest.fn().mockResolvedValue({ successes: [], failures: [] }),
};

const createLightNode = jest.fn().mockResolvedValue({
  peerId: { toString: () => 'mock-peer-id' },
  filter: {
    subscribe: jest.fn().mockResolvedValue({
      subscription: mockSubscription,
      error: null,
      results: { successes: [], failures: [] },
    }),
  },
  lightPush: {
    send: jest.fn().mockResolvedValue({ successes: [], failures: [] }),
  },
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  waitForPeers: jest.fn().mockResolvedValue(undefined),
  isStarted: jest.fn().mockReturnValue(true),
  isConnected: jest.fn().mockReturnValue(true),
  getConnectedPeers: jest.fn().mockResolvedValue([]),
});

const waitForRemotePeer = jest.fn().mockResolvedValue(undefined);

const Protocols = {
  Relay: 'relay',
  Store: 'store',
  LightPush: 'lightpush',
  Filter: 'filter',
};

const createEncoder = jest.fn((params) => ({
  contentTopic: params.contentTopic,
}));

const createDecoder = jest.fn((contentTopic) => ({
  contentTopic,
}));

const utf8ToBytes = jest.fn((str) => new TextEncoder().encode(str));
const bytesToUtf8 = jest.fn((bytes) => new TextDecoder().decode(bytes));

module.exports = {
  createLightNode,
  waitForRemotePeer,
  Protocols,
  createEncoder,
  createDecoder,
  utf8ToBytes,
  bytesToUtf8,
};
