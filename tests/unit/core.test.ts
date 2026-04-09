import { HiveSync } from '../../src/core/hivesync-bridge';
import { BridgeConfig, MessageType } from '../../src/types';

jest.mock('@waku/sdk');

const mockConfig: BridgeConfig = {
  agentId: 'test-agent-1',
  agentName: 'Test Agent',
  storagePath: ':memory:',
  syncInterval: 0,
  waku: {
    listenAddresses: [],
    bootstrapNodes: [],
    pubsubTopic: '/test/topic',
    keepAlive: false,
    maxPeers: 1,
  },
};

function createMockNode() {
  return {
    peerId: { toString: () => 'test-peer-id' },
    filter: {
      subscribe: jest.fn().mockResolvedValue({
        subscription: { subscribe: jest.fn(), unsubscribe: jest.fn() },
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
  };
}

describe('HiveSync Core', () => {
  let hivesync: HiveSync;

  beforeEach(() => {
    hivesync = new HiveSync(mockConfig);
  });

  afterEach(async () => {
    await hivesync.disconnect();
  });

  describe('Initialization', () => {
    test('should create instance with config', () => {
      expect(hivesync).toBeInstanceOf(HiveSync);
      expect(hivesync.getStatus().connected).toBe(false);
    });

    test('should report connected status when node is set', () => {
      const mockNode = createMockNode();
      // @ts-ignore
      hivesync['node'] = mockNode;
      // @ts-ignore
      hivesync['isConnected'] = true;

      const status = hivesync.getStatus();
      expect(status.connected).toBe(true);
      expect(status.peerId).toBe('test-peer-id');
    });

    test('should initialize with mocked createLightNode', async () => {
      const { createLightNode } = require('@waku/sdk');
      const mockNode = createMockNode();
      createLightNode.mockResolvedValue(mockNode);

      const result = await hivesync.initialize();

      expect(result).toBe(true);
      expect(hivesync.getStatus().connected).toBe(true);
      expect(mockNode.start).toHaveBeenCalled();
      expect(mockNode.waitForPeers).toHaveBeenCalled();
    });
  });

  describe('Message Handling', () => {
    test('should register message handlers', () => {
      const handler = jest.fn();
      hivesync.onMessage(MessageType.TEXT, handler);
      expect(typeof hivesync.onMessage).toBe('function');
    });

    test('should dispatch incoming messages to registered handlers', async () => {
      const handler = jest.fn();
      hivesync.onMessage(MessageType.TEXT, handler);

      const mockNode = createMockNode();
      // @ts-ignore
      hivesync['node'] = mockNode;
      // @ts-ignore
      hivesync['isConnected'] = true;

      const testMessage = {
        id: 'test-id',
        sender: 'sender-1',
        recipient: 'test-agent-1',
        type: MessageType.TEXT,
        content: { text: 'Hello' },
        timestamp: new Date().toISOString(),
        encrypted: false,
      };

      // @ts-ignore
      await hivesync['handleIncomingMessage']({
        payload: new TextEncoder().encode(JSON.stringify(testMessage)),
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id',
          sender: 'sender-1',
          type: MessageType.TEXT,
        })
      );
    });

    test('should ignore messages for other agents', async () => {
      const handler = jest.fn();
      hivesync.onMessage(MessageType.TEXT, handler);

      const mockNode = createMockNode();
      // @ts-ignore
      hivesync['node'] = mockNode;
      // @ts-ignore
      hivesync['isConnected'] = true;

      const testMessage = {
        id: 'test-id',
        sender: 'sender-1',
        recipient: 'other-agent',
        type: MessageType.TEXT,
        content: { text: 'Hello' },
        timestamp: new Date().toISOString(),
        encrypted: false,
      };

      // @ts-ignore
      await hivesync['handleIncomingMessage']({
        payload: new TextEncoder().encode(JSON.stringify(testMessage)),
      });

      expect(handler).not.toHaveBeenCalled();
    });

    test('should accept broadcast messages', async () => {
      const handler = jest.fn();
      hivesync.onMessage(MessageType.TEXT, handler);

      const mockNode = createMockNode();
      // @ts-ignore
      hivesync['node'] = mockNode;
      // @ts-ignore
      hivesync['isConnected'] = true;

      const testMessage = {
        id: 'test-id',
        sender: 'sender-1',
        recipient: 'broadcast',
        type: MessageType.TEXT,
        content: { text: 'Hello everyone' },
        timestamp: new Date().toISOString(),
        encrypted: false,
      };

      // @ts-ignore
      await hivesync['handleIncomingMessage']({
        payload: new TextEncoder().encode(JSON.stringify(testMessage)),
      });

      expect(handler).toHaveBeenCalled();
    });

    test('should send message via lightPush.send', async () => {
      const mockNode = createMockNode();
      // @ts-ignore
      hivesync['node'] = mockNode;
      // @ts-ignore
      hivesync['isConnected'] = true;

      const message = {
        sender: 'test-agent-1',
        recipient: 'recipient-1',
        type: MessageType.TEXT,
        content: { text: 'Test message' },
        encrypted: true,
      };

      const messageId = await hivesync.sendMessage(message);

      expect(messageId).toBeDefined();
      expect(typeof messageId).toBe('string');
      expect(mockNode.lightPush.send).toHaveBeenCalledWith(
        expect.objectContaining({ contentTopic: expect.any(String) }),
        expect.objectContaining({ payload: expect.any(Uint8Array) })
      );
    });

    test('should throw when sending without connection', async () => {
      const message = {
        sender: 'test-agent-1',
        recipient: 'recipient-1',
        type: MessageType.TEXT,
        content: { text: 'Test' },
        encrypted: true,
      };

      await expect(hivesync.sendMessage(message)).rejects.toThrow(
        'HiveSync bridge not initialized or connected'
      );
    });
  });

  describe('Status', () => {
    test('should return disconnected status initially', () => {
      const status = hivesync.getStatus();
      expect(status.connected).toBe(false);
      expect(status.peers).toBe(0);
      expect(status.peerId).toBeUndefined();
    });

    test('should return connected status with peer info', () => {
      const mockNode = createMockNode();
      // @ts-ignore
      hivesync['node'] = mockNode;
      // @ts-ignore
      hivesync['isConnected'] = true;

      const status = hivesync.getStatus();
      expect(status.connected).toBe(true);
      expect(status.peerId).toBe('test-peer-id');
    });
  });

  describe('Error Handling', () => {
    test('should handle initialization failure gracefully', async () => {
      const { createLightNode } = require('@waku/sdk');
      createLightNode.mockRejectedValue(new Error('Connection failed'));

      const result = await hivesync.initialize();
      expect(result).toBe(false);
      expect(hivesync.getStatus().connected).toBe(false);
    });

    test('should propagate message sending errors', async () => {
      const mockNode = createMockNode();
      mockNode.lightPush.send.mockRejectedValue(new Error('Network error'));
      // @ts-ignore
      hivesync['node'] = mockNode;
      // @ts-ignore
      hivesync['isConnected'] = true;

      const message = {
        sender: 'test-agent-1',
        recipient: 'recipient-1',
        type: MessageType.TEXT,
        content: { text: 'Test' },
        encrypted: true,
      };

      await expect(hivesync.sendMessage(message)).rejects.toThrow('Network error');
    });

    test('should handle disconnect when not connected', async () => {
      await expect(hivesync.disconnect()).resolves.not.toThrow();
    });
  });
});
