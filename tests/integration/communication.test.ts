import { BridgeManager } from '../../src/core/bridge-manager';
import { BridgeConfig, MessageType } from '../../src/types';

jest.mock('@waku/sdk');

const agent1Config: BridgeConfig = {
  agentId: 'agent-alpha',
  agentName: 'Agent Alpha',
  storagePath: ':memory:',
  syncInterval: 0,
  waku: {
    listenAddresses: [],
    bootstrapNodes: [],
    pubsubTopic: '/test/communication',
    keepAlive: false,
    maxPeers: 2,
  },
};

const agent2Config: BridgeConfig = {
  agentId: 'agent-beta',
  agentName: 'Agent Beta',
  storagePath: ':memory:',
  syncInterval: 0,
  waku: {
    listenAddresses: [],
    bootstrapNodes: [],
    pubsubTopic: '/test/communication',
    keepAlive: false,
    maxPeers: 2,
  },
};

describe('BridgeManager Communication Integration', () => {
  let agent1: BridgeManager;
  let agent2: BridgeManager;

  beforeEach(async () => {
    agent1 = new BridgeManager(agent1Config);
    agent2 = new BridgeManager(agent2Config);
  });

  afterEach(async () => {
    await agent1.stop();
    await agent2.stop();
  });

  describe('Agent Initialization', () => {
    test('should start both agents successfully', async () => {
      const started1 = await agent1.start();
      const started2 = await agent2.start();

      expect(started1).toBe(true);
      expect(started2).toBe(true);
    });

    test('should assign correct identities', async () => {
      await agent1.start();
      await agent2.start();

      const status1 = agent1.getStatus();
      const status2 = agent2.getStatus();

      expect(status1.agentId).toBe('agent-alpha');
      expect(status1.agentName).toBe('Agent Alpha');
      expect(status2.agentId).toBe('agent-beta');
      expect(status2.agentName).toBe('Agent Beta');
    });

    test('should report running state correctly', async () => {
      expect(agent1.getStatus().running).toBe(false);

      await agent1.start();

      expect(agent1.getStatus().running).toBe(true);
    });

    test('should include hivesync bridge status', async () => {
      await agent1.start();

      const status = agent1.getStatus();
      expect(status.hivesync).toBeDefined();
      expect(status.hivesync).toHaveProperty('connected');
      expect(status.hivesync).toHaveProperty('peers');
    });
  });

  describe('Message Exchange', () => {
    test('should send text message and get message ID back', async () => {
      await agent1.start();

      const msgId = await agent1.sendTextMessage('agent-beta', 'Hello from Alpha!');

      expect(msgId).toBeDefined();
      expect(typeof msgId).toBe('string');
      expect(msgId.length).toBeGreaterThan(0);
    });

    test('should broadcast message to all agents', async () => {
      await agent1.start();

      const broadcastId = await agent1.broadcastMessage('Hello everyone!');

      expect(broadcastId).toBeDefined();
      expect(typeof broadcastId).toBe('string');
    });

    test('should send command messages', async () => {
      await agent1.start();

      const cmdId = await agent1.sendCommand('agent-beta', 'status');

      expect(cmdId).toBeDefined();
      expect(typeof cmdId).toBe('string');
    });
  });

  describe('Unread Messages', () => {
    test('should have no unread messages initially', async () => {
      await agent1.start();

      const messages = await agent1.getUnreadMessages();
      expect(messages).toHaveLength(0);
    });
  });

  describe('Status Shape', () => {
    test('should return well-formed status object', async () => {
      await agent1.start();

      const status = agent1.getStatus();

      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('agentId');
      expect(status).toHaveProperty('agentName');
      expect(status).toHaveProperty('hivesync');
      expect(status).toHaveProperty('realTimeSync');
      expect(status).toHaveProperty('fileWatching');

      expect(status.running).toBe(true);
      expect(status.agentId).toBe('agent-alpha');
      expect(typeof status.realTimeSync).toBe('boolean');
      expect(typeof status.fileWatching).toBe('boolean');
    });
  });

  describe('Error Recovery', () => {
    test('should handle stop when never started', async () => {
      await expect(agent1.stop()).resolves.not.toThrow();
    });

    test('should handle double stop gracefully', async () => {
      await agent1.start();
      await agent1.stop();
      await expect(agent1.stop()).resolves.not.toThrow();
    });
  });
});
