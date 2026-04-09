import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, validateConfig, saveConfig } from '../../src/utils/config';
import { StorageManager } from '../../src/storage/storage-manager';
import { BridgeConfig } from '../../src/types';
import yaml from 'yaml';

jest.mock('@waku/sdk');

describe('HiveSync E2E Multi-Agent', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hivesync-e2e-'));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Configuration', () => {
    test('should write and read config via YAML', async () => {
      const config: BridgeConfig = {
        agentId: 'e2e-agent',
        agentName: 'E2E Agent',
        storagePath: path.join(tempDir, 'hivesync.db'),
        syncInterval: 5,
        waku: {
          listenAddresses: [],
          bootstrapNodes: [],
          pubsubTopic: '/test/e2e',
          keepAlive: false,
          maxPeers: 1,
        },
      };

      const configPath = path.join(tempDir, 'config.yaml');
      fs.writeFileSync(configPath, yaml.stringify(config), 'utf-8');

      const loaded = await loadConfig(configPath);
      expect(loaded.agentId).toBe('e2e-agent');
      expect(loaded.agentName).toBe('E2E Agent');
    });

    test('should return defaults for missing config', async () => {
      const config = await loadConfig(path.join(tempDir, 'nonexistent.yaml'));
      expect(config).toBeDefined();
      expect(config.agentId).toBeDefined();
      expect(config.agentName).toBeDefined();
    });

    test('should handle invalid YAML gracefully', async () => {
      const badPath = path.join(tempDir, 'bad.yaml');
      fs.writeFileSync(badPath, 'invalid: yaml: content: [', 'utf-8');

      const config = await loadConfig(badPath);
      expect(config).toBeDefined();
    });

    test('should validate config correctly', () => {
      const valid: BridgeConfig = {
        agentId: 'test',
        agentName: 'Test',
        storagePath: '/tmp/test.db',
        syncInterval: 5,
        waku: {
          listenAddresses: [],
          bootstrapNodes: ['/dns4/test.node/tcp/443/wss/p2p/test'],
          pubsubTopic: '/test',
          keepAlive: false,
          maxPeers: 1,
        },
      };

      expect(validateConfig(valid)).toHaveLength(0);

      const invalid = {
        agentId: '',
        agentName: '',
        storagePath: '',
        syncInterval: -1,
        waku: {
          listenAddresses: [],
          bootstrapNodes: [],
          pubsubTopic: '',
          keepAlive: false,
          maxPeers: 0,
        },
      };

      const errors = validateConfig(invalid);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain('Agent ID is required');
      expect(errors).toContain('Agent name is required');
      expect(errors).toContain('Storage path is required');
      expect(errors).toContain('Sync interval must be positive');
      expect(errors).toContain('At least one Waku bootstrap node is required');
    });

    test('should save config to disk', async () => {
      const config: BridgeConfig = {
        agentId: 'save-test',
        agentName: 'Save Test',
        storagePath: ':memory:',
        syncInterval: 1,
        waku: {
          listenAddresses: [],
          bootstrapNodes: [],
          pubsubTopic: '/test/save',
          keepAlive: false,
          maxPeers: 1,
        },
      };

      const savePath = path.join(tempDir, 'saved-config.yaml');
      await saveConfig(config, savePath);

      expect(fs.existsSync(savePath)).toBe(true);
      const content = yaml.parse(fs.readFileSync(savePath, 'utf-8'));
      expect(content.agentId).toBe('save-test');
    });
  });

  describe('Library Exports', () => {
    test('should export BridgeManager', () => {
      const { BridgeManager } = require('../../src/index');
      expect(BridgeManager).toBeDefined();
      expect(typeof BridgeManager).toBe('function');
    });

    test('should export HiveSync', () => {
      const { HiveSync } = require('../../src/index');
      expect(HiveSync).toBeDefined();
      expect(typeof HiveSync).toBe('function');
    });

    test('should export StorageManager', () => {
      const { StorageManager } = require('../../src/index');
      expect(StorageManager).toBeDefined();
      expect(typeof StorageManager).toBe('function');
    });

    test('should instantiate BridgeManager', () => {
      const { BridgeManager } = require('../../src/index');

      const bridge = new BridgeManager({
        agentId: 'lib-agent',
        agentName: 'Library Agent',
        storagePath: ':memory:',
        syncInterval: 0,
        waku: {
          listenAddresses: [],
          bootstrapNodes: [],
          pubsubTopic: '/test/lib',
          keepAlive: false,
          maxPeers: 1,
        },
      });

      expect(bridge).toBeInstanceOf(BridgeManager);
      expect(typeof bridge.getStatus).toBe('function');
      expect(typeof bridge.sendTextMessage).toBe('function');
    });
  });

  describe('File System Operations', () => {
    test('should create and verify Obsidian-like vault structure', () => {
      const vaultDir = path.join(tempDir, 'vault');
      fs.mkdirSync(vaultDir, { recursive: true });

      const files = [
        { name: 'Note1.md', content: '# Note 1\n\nContent 1' },
        { name: 'Note2.md', content: '# Note 2\n\nContent 2' },
        { name: 'subfolder/Note3.md', content: '# Note 3\n\nContent 3' },
      ];

      for (const file of files) {
        const filePath = path.join(vaultDir, file.name);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, file.content, 'utf-8');
      }

      for (const file of files) {
        const filePath = path.join(vaultDir, file.name);
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toBe(file.content);
      }
    });
  });

  describe('Storage Performance', () => {
    test('should handle bulk message operations efficiently', async () => {
      const storage = new StorageManager(':memory:');
      await storage.initialize();

      const count = 100;
      const start = Date.now();

      for (let i = 0; i < count; i++) {
        await storage.saveMessage({
          id: `perf-msg-${i}`,
          sender: `agent-${i % 5}`,
          recipient: `agent-${(i + 1) % 5}`,
          type: 'text' as any,
          content: { text: `Message ${i}` },
          timestamp: new Date(),
          encrypted: false,
        });
      }

      const saveTime = Date.now() - start;
      expect(saveTime).toBeLessThan(5000);

      const retrieveStart = Date.now();
      const messages = await storage.getMessages(count, 0);
      const retrieveTime = Date.now() - retrieveStart;

      expect(messages).toHaveLength(count);
      expect(retrieveTime).toBeLessThan(1000);

      await storage.close();
    });
  });
});
