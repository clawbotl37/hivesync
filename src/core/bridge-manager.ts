import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { HiveSync } from './hivesync-bridge';
import { Identity } from './identity';
import { Transport } from './transport';
import { StorageManager } from '../storage/storage-manager';
import { RealTimeSyncManager } from '../sync/real-time-sync';
import { BridgeConfig, AgentIdentity, Message, MessageType } from '../types';
import { logger } from '../utils/logger';

/**
 * Orchestrates identity, transport, storage and (optional) sync. Emits events so
 * both humans (the TUI) and agents (programmatic consumers) can react live
 * instead of polling:
 *  - `text`            (message: Message)        an incoming text message
 *  - `message`         (message: Message)        any incoming message
 *  - `agentDiscovered` (agent: AgentIdentity)    a newly discovered peer
 */
export class BridgeManager extends EventEmitter {
  private readonly config: BridgeConfig;
  private readonly identity: Identity;
  private readonly hivesync: HiveSync;
  private readonly storage: StorageManager;
  private realTimeSync: RealTimeSyncManager | null = null;
  private isRunning = false;

  constructor(config: BridgeConfig, transport?: Transport) {
    super();
    this.config = config;
    const identityDir =
      config.storagePath === ':memory:'
        ? path.join(process.cwd(), 'data')
        : path.dirname(config.storagePath);
    // ':memory:' storage implies a throwaway run, so use an ephemeral identity.
    this.identity =
      config.storagePath === ':memory:'
        ? Identity.ephemeral(config.agentId, config.agentName)
        : Identity.loadOrCreate(identityDir, config.agentId, config.agentName);
    this.hivesync = new HiveSync(config, this.identity, transport);
    this.storage = new StorageManager(config.storagePath);
  }

  async start(peerWaitTimeoutMs = 30000): Promise<boolean> {
    try {
      logger.info('Starting HiveSync Bridge Manager...');

      await this.storage.initialize();
      await this.registerAgent();

      // Persist agents we discover on the network, and notify listeners.
      this.hivesync.onAgentDiscovered(async (agent) => {
        await this.storage.saveAgent(agent);
        this.emit('agentDiscovered', agent);
      });
      this.setupMessageHandlers();

      const started = await this.hivesync.initialize(peerWaitTimeoutMs);
      if (!started) {
        throw new Error('Failed to initialize HiveSync bridge');
      }

      // Obsidian real-time sync is strictly opt-in and never blocks messaging.
      const obsidian = this.config.obsidian;
      if (obsidian?.enabled && obsidian.vaultPath) {
        if (fs.existsSync(obsidian.vaultPath)) {
          try {
            this.realTimeSync = new RealTimeSyncManager(this.hivesync, this.storage, obsidian.vaultPath);
            await this.realTimeSync.start();
          } catch (error) {
            logger.warn('Obsidian sync failed to start (continuing without it):', error);
            this.realTimeSync = null;
          }
        } else {
          logger.warn(`Obsidian vault path does not exist, skipping sync: ${obsidian.vaultPath}`);
        }
      }

      this.isRunning = true;
      logger.success(`Bridge Manager started. Agent: ${this.config.agentName} (${this.config.agentId})`);
      return true;
    } catch (error) {
      logger.error('Failed to start Bridge Manager:', error);
      this.isRunning = false;
      await this.stop().catch(() => undefined);
      return false;
    }
  }

  async stop(): Promise<void> {
    if (this.realTimeSync) {
      await this.realTimeSync.stop().catch(() => undefined);
      this.realTimeSync = null;
    }
    await this.hivesync.disconnect().catch(() => undefined);
    await this.storage.close();
    this.isRunning = false;
  }

  private async registerAgent(): Promise<void> {
    const agent: AgentIdentity = {
      id: this.identity.agentId,
      name: this.identity.agentName,
      publicKey: this.identity.signPublicKey,
      encPublicKey: this.identity.encPublicKey,
      keyId: this.identity.keyId,
      createdAt: this.identity.createdAt,
      lastSeen: new Date(),
    };
    await this.storage.saveAgent(agent);
  }

  private setupMessageHandlers(): void {
    this.hivesync.onMessage(MessageType.TEXT, async (message) => {
      await this.storage.saveMessage(message);
      this.emit('text', message);
      this.emit('message', message);
    });

    this.hivesync.onMessage(MessageType.COMMAND, async (message) => {
      await this.storage.saveMessage(message);
      this.emit('message', message);
      await this.handleCommand(message);
    });

    this.hivesync.onMessage(MessageType.ACK, async (message) => {
      logger.debug(`ACK from ${message.sender} for ${message.content?.originalMessageId}`);
    });
  }

  private async handleCommand(message: Message): Promise<void> {
    const { command } = message.content;

    switch (command) {
      case 'status': {
        const status = await this.getStatus();
        await this.sendTextMessage(message.sender, `Status: ${JSON.stringify(status)}`);
        break;
      }
      case 'agents': {
        const agents = await this.storage.getAllAgents();
        const list = agents.map((a) => `${a.name} (${a.id})`).join('\n');
        await this.sendTextMessage(message.sender, `Known agents:\n${list}`);
        break;
      }
      case 'sync':
        if (this.realTimeSync) {
          await this.realTimeSync.syncWithAllAgents();
          await this.sendTextMessage(message.sender, 'Sync initiated');
        } else {
          await this.sendTextMessage(message.sender, 'Real-time sync not configured');
        }
        break;
      case 'help':
        await this.sendTextMessage(
          message.sender,
          'Commands: status, agents, sync, help'
        );
        break;
      default:
        await this.sendTextMessage(message.sender, `Unknown command: ${command}`);
    }
  }

  async sendTextMessage(recipient: string, text: string): Promise<string> {
    const encrypted = recipient !== 'broadcast' && this.isAgentKnown(recipient);
    const id = await this.hivesync.sendMessage({
      sender: this.config.agentId,
      recipient,
      type: MessageType.TEXT,
      content: { text },
      encrypted: recipient !== 'broadcast',
    });
    // Record our own outgoing message so conversation history is complete.
    await this.storage.saveMessage({
      id,
      sender: this.config.agentId,
      recipient,
      type: MessageType.TEXT,
      content: { text },
      timestamp: new Date(),
      encrypted,
    });
    return id;
  }

  private isAgentKnown(agentId: string): boolean {
    return this.hivesync.getKnownAgents().some((a) => a.id === agentId && !!a.encPublicKey);
  }

  async sendCommand(recipient: string, command: string, args: any = {}): Promise<string> {
    return this.hivesync.sendMessage({
      sender: this.config.agentId,
      recipient,
      type: MessageType.COMMAND,
      content: { command, args },
      encrypted: recipient !== 'broadcast',
    });
  }

  async broadcastMessage(text: string): Promise<string> {
    const id = await this.hivesync.sendMessage({
      sender: this.config.agentId,
      recipient: 'broadcast',
      type: MessageType.TEXT,
      content: { text },
      encrypted: false,
    });
    await this.storage.saveMessage({
      id,
      sender: this.config.agentId,
      recipient: 'broadcast',
      type: MessageType.TEXT,
      content: { text },
      timestamp: new Date(),
      encrypted: false,
    });
    return id;
  }

  /** Full text conversation (both directions) with one agent, oldest first. */
  async getConversation(peerId: string, limit = 500): Promise<Message[]> {
    return this.storage.getConversation(peerId, this.config.agentId, limit);
  }

  /** All broadcast text messages seen/sent, oldest first. */
  async getBroadcasts(limit = 500): Promise<Message[]> {
    return this.storage.getBroadcasts(limit);
  }

  get agentId(): string {
    return this.config.agentId;
  }

  /** Wait until an agent has been discovered (so encryption keys are known). */
  async waitForAgent(agentId: string, timeoutMs = 20000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.hivesync.getKnownAgents().some((a) => a.id === agentId)) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }

  getKnownAgents(): AgentIdentity[] {
    return this.hivesync.getKnownAgents();
  }

  async getUnreadMessages(): Promise<Message[]> {
    return this.storage.getUnreadMessages();
  }

  async markMessageAsRead(messageId: string): Promise<void> {
    await this.storage.markMessageAsRead(messageId);
  }

  async getStatus(): Promise<any> {
    const hivesync = await this.hivesync.getStatus();
    return {
      running: this.isRunning,
      agentId: this.config.agentId,
      agentName: this.config.agentName,
      keyId: this.identity.keyId,
      hivesync,
      realTimeSync: !!this.realTimeSync,
      fileWatching: this.realTimeSync?.isWatching() || false,
    };
  }

  async triggerSync(): Promise<void> {
    if (this.realTimeSync) {
      await this.realTimeSync.syncWithAllAgents();
    }
  }

  async getSyncStatus(): Promise<any> {
    if (this.realTimeSync) {
      return this.realTimeSync.getSyncStatus();
    }
    return [];
  }
}
