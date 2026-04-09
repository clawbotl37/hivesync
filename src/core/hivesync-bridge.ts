import {
  createLightNode,
  createEncoder,
  createDecoder,
  utf8ToBytes,
  bytesToUtf8,
  Protocols,
  waitForRemotePeer,
} from '@waku/sdk';
import type { LightNode, IDecodedMessage } from '@waku/sdk';
import { v4 as uuidv4 } from 'uuid';
import { Message, MessageType, BridgeConfig } from '../types';

const CONTENT_TOPIC_PREFIX = '/hivesync/1';

export class HiveSync {
  private node: LightNode | null = null;
  private config: BridgeConfig;
  private messageHandlers: Map<MessageType, (message: Message) => void> = new Map();
  private isConnected: boolean = false;
  private contentTopic: string;

  constructor(config: BridgeConfig) {
    this.config = config;
    this.contentTopic = `${CONTENT_TOPIC_PREFIX}/${config.waku.pubsubTopic}/proto`;
  }

  async initialize(): Promise<boolean> {
    try {
      console.log('Initializing HiveSync bridge...');

      const useDefaultBootstrap = this.config.waku.bootstrapNodes.length === 0;

      this.node = await createLightNode({
        defaultBootstrap: useDefaultBootstrap,
        bootstrapPeers: useDefaultBootstrap ? undefined : this.config.waku.bootstrapNodes,
      });

      await this.node.start();
      await this.node.waitForPeers([Protocols.LightPush, Protocols.Filter]);

      this.isConnected = true;
      console.log('HiveSync bridge initialized successfully');
      console.log('Peer ID:', this.node.peerId.toString());

      await this.subscribeToTopic();

      return true;
    } catch (error) {
      console.error('Failed to initialize HiveSync bridge:', error);
      this.isConnected = false;
      return false;
    }
  }

  private async subscribeToTopic(): Promise<void> {
    if (!this.node || !this.node.filter) return;

    const decoder = createDecoder(this.contentTopic);

    await this.node.filter.subscribe(
      decoder,
      (wakuMessage: IDecodedMessage) => {
        this.handleIncomingMessage(wakuMessage);
      }
    );

    console.log(`Subscribed to topic: ${this.contentTopic}`);
  }

  private async handleIncomingMessage(wakuMessage: IDecodedMessage): Promise<void> {
    try {
      if (!wakuMessage.payload) return;

      const payload = bytesToUtf8(wakuMessage.payload);
      const message: Message = JSON.parse(payload);

      if (message.recipient !== this.config.agentId && message.recipient !== 'broadcast') {
        return;
      }

      console.log(`Received message from ${message.sender}: ${message.type}`);

      const handler = this.messageHandlers.get(message.type);
      if (handler) {
        handler(message);
      }

      if (message.type !== MessageType.ACK) {
        await this.sendAck(message.id, message.sender);
      }
    } catch (error) {
      console.error('Error handling incoming message:', error);
    }
  }

  async sendMessage(message: Omit<Message, 'id' | 'timestamp'>): Promise<string> {
    if (!this.node || !this.node.lightPush || !this.isConnected) {
      throw new Error('HiveSync bridge not initialized or connected');
    }

    const fullMessage: Message = {
      ...message,
      id: uuidv4(),
      timestamp: new Date(),
    };

    try {
      const payload = utf8ToBytes(JSON.stringify(fullMessage));
      const encoder = createEncoder({ contentTopic: this.contentTopic });

      await this.node.lightPush.send(encoder, { payload });

      console.log(`Message sent: ${fullMessage.id} to ${fullMessage.recipient}`);
      return fullMessage.id;
    } catch (error) {
      console.error('Failed to send message:', error);
      throw error;
    }
  }

  async sendAck(messageId: string, recipient: string): Promise<void> {
    const ackMessage: Omit<Message, 'id' | 'timestamp'> = {
      sender: this.config.agentId,
      recipient,
      type: MessageType.ACK,
      content: { originalMessageId: messageId },
      encrypted: false,
    };

    await this.sendMessage(ackMessage);
  }

  onMessage(type: MessageType, handler: (message: Message) => void): void {
    this.messageHandlers.set(type, handler);
  }

  async disconnect(): Promise<void> {
    if (this.node) {
      await this.node.stop();
      this.node = null;
      this.isConnected = false;
      console.log('HiveSync bridge disconnected');
    }
  }

  getStatus(): { connected: boolean; peerId?: string; peers: number } {
    if (!this.node) {
      return { connected: false, peers: 0 };
    }

    return {
      connected: this.isConnected,
      peerId: this.node.peerId.toString(),
      peers: 0, // peer count updated asynchronously via getConnectedPeers()
    };
  }
}
