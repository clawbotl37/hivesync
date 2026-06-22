import { WakuConfig } from '../types';
import { Transport } from './transport';
import { logger } from '../utils/logger';

// `@waku/sdk` is ESM-only and its type exports don't resolve cleanly under the
// CommonJS build. Since the module is loaded dynamically at runtime, we keep the
// node/encoder/decoder loosely typed here rather than coupling to its d.ts.
type WakuNodeLike = any;
type DecodedMessage = { payload?: Uint8Array };

/**
 * `@waku/sdk` is shipped as ESM-only. This project compiles to CommonJS, so a
 * top-level `import`/`require` of it fails at runtime. We load it lazily with a
 * dynamic `import()`, which works from CJS, and cache the module.
 */
type WakuSdk = typeof import('@waku/sdk');
let sdkPromise: Promise<WakuSdk> | null = null;
function loadSdk(): Promise<WakuSdk> {
  if (!sdkPromise) {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    sdkPromise = (new Function('return import("@waku/sdk")')() as Promise<WakuSdk>);
  }
  return sdkPromise;
}

export type RawMessageHandler = (payload: Uint8Array) => void;

/**
 * Thin wrapper over a Waku light node: connect, publish bytes to the configured
 * content topic, and subscribe to receive bytes. All HiveSync-level concerns
 * (framing, identity, encryption, routing) live above this layer.
 */
export class WakuTransport implements Transport {
  private node: WakuNodeLike | null = null;
  private encoder: any = null;
  private decoder: any = null;
  private readonly config: WakuConfig;
  private handler: RawMessageHandler | null = null;
  private started = false;
  private storePollTimer: NodeJS.Timeout | null = null;
  private lastStoreQueryTime: Date | null = null;
  private storePolling = false;

  constructor(config: WakuConfig) {
    this.config = config;
  }

  isStarted(): boolean {
    return this.started;
  }

  pubsubTopic(): string | undefined {
    return (this.decoder as any)?.pubsubTopic;
  }

  async start(peerWaitTimeoutMs = 30000): Promise<void> {
    const sdk = await loadSdk();
    const { createLightNode, waitForRemotePeer, Protocols } = sdk;

    const networkConfig = {
      clusterId: this.config.clusterId,
      numShardsInCluster: this.config.numShardsInCluster,
    };

    const useDefaultBootstrap = !this.config.bootstrapNodes || this.config.bootstrapNodes.length === 0;

    this.node = await createLightNode({
      defaultBootstrap: useDefaultBootstrap,
      bootstrapPeers: useDefaultBootstrap ? undefined : this.config.bootstrapNodes,
      networkConfig,
    });

    await this.node.start();
    await waitForRemotePeer(this.node, [Protocols.LightPush, Protocols.Filter], peerWaitTimeoutMs);

    // The node derives the pubsub topic/shard from its networkConfig + content topic.
    this.encoder = this.node.createEncoder({ contentTopic: this.config.contentTopic });
    this.decoder = this.node.createDecoder({ contentTopic: this.config.contentTopic });

    this.started = true;
    logger.info(`Waku transport connected (peerId ${this.node.peerId.toString()})`);
  }

  async subscribe(handler: RawMessageHandler): Promise<void> {
    if (!this.node?.filter || !this.decoder) {
      throw new Error('Waku transport not started');
    }
    this.handler = handler;

    let filterPeers = 0;
    try {
      const result = await this.node.filter.subscribe(this.decoder, (msg: DecodedMessage) => {
        if (msg.payload && this.handler) {
          this.handler(msg.payload);
        }
      });

      if (result.error) {
        logger.warn(`Waku filter subscribe failed: ${result.error}`);
      }
      const failures = result.results?.failures?.length ?? 0;
      const successes = result.results?.successes?.length ?? 0;
      filterPeers = successes;
      if (successes === 0 && failures > 0) {
        logger.warn('Waku filter subscribe: no peer accepted the subscription');
      } else {
        logger.info(`Subscribed to ${this.config.contentTopic} (${successes} peer(s))`);
      }
    } catch (err) {
      logger.warn(`Filter subscribe error: ${(err as Error).message}`);
    }

    // Always start Store polling as a fallback/supplement for message retrieval.
    // On the Waku testnet, Filter subscriptions often get 0 peers, so Store
    // polling ensures we still receive messages.
    this.startStorePolling();
    if (filterPeers === 0) {
      logger.info('Filter has 0 peers — relying on Store polling for message retrieval');
    }
  }

  /**
   * Poll the Waku Store protocol every 5 seconds for messages on our content
   * topic that we may have missed (e.g. when Filter subscribe has 0 peers).
   */
  private startStorePolling(): void {
    if (this.storePollTimer) return;
    this.lastStoreQueryTime = new Date();
    this.storePollTimer = setInterval(() => void this.pollStore(), 5000);
    this.storePollTimer.unref?.();
    logger.info('Started Store polling fallback for message retrieval');
  }

  private async pollStore(): Promise<void> {
    if (this.storePolling || !this.node?.store || !this.decoder || !this.handler) return;
    this.storePolling = true;
    try {
      const queryOpts: any = { pageSize: 50 };
      if (this.lastStoreQueryTime) {
        queryOpts.startTime = this.lastStoreQueryTime;
      }
      let receivedAny = false;
      await this.node.store.queryWithOrderedCallback(
        [this.decoder],
        (msg: DecodedMessage) => {
          if (msg.payload && this.handler) {
            receivedAny = true;
            this.handler(msg.payload);
          }
        },
        queryOpts
      );
      if (receivedAny) {
        logger.info('Store polling retrieved messages');
      }
    } catch (error) {
      logger.warn(`Store polling error: ${(error as Error).message}`);
    } finally {
      this.lastStoreQueryTime = new Date();
      this.storePolling = false;
    }
  }

  /**
   * Publish bytes via LightPush. The public fleet has peers that reject pushes
   * (e.g. RLN rate limiting), so a partial success (>=1 peer) counts as sent;
   * we only retry/raise when every peer rejects.
   */
  async publish(payload: Uint8Array, retries = 5): Promise<void> {
    if (!this.node?.lightPush || !this.encoder) {
      throw new Error('Waku transport not started');
    }

    let lastFailures = 'unknown error';
    let lightPushWorked = false;
    for (let attempt = 1; attempt <= retries; attempt++) {
      let result: any;
      try {
        result = await this.node.lightPush.send(this.encoder, { payload });
      } catch (error) {
        lastFailures = (error as Error).message;
        result = { successes: [] };
      }
      if ((result.successes?.length ?? 0) > 0) {
        lightPushWorked = true;
        return;
      }
      if (result.failures?.length) lastFailures = JSON.stringify(result.failures);
      logger.warn(`LightPush attempt ${attempt}/${retries} delivered to 0 peers: ${lastFailures}`);
      if (attempt < retries) {
        await delay(1500 * attempt);
      }
    }

    // Fallback: broadcast via Relay so subscribed peers receive the message.
    // Relay publishes to the content topic — all agents subscribed to it get it.
    if (!lightPushWorked && this.node?.relay) {
      try {
        logger.warn('LightPush failed, falling back to Relay broadcast');
        await this.node.relay.send(this.encoder, { payload });
        logger.info('Relay broadcast sent successfully');
        return;
      } catch (relayError) {
        logger.warn(`Relay fallback also failed: ${(relayError as Error).message}`);
      }
    }

    // Don't crash — failures are a Waku network condition, not fatal.
    logger.warn(`LightPush failed after ${retries} attempts (agent can still receive): ${lastFailures}`);
  }

  async getPeerCount(): Promise<number> {
    if (!this.node) return 0;
    try {
      const peers = await this.node.getConnectedPeers();
      return peers.length;
    } catch {
      return 0;
    }
  }

  peerId(): string | undefined {
    return this.node?.peerId.toString();
  }

  async stop(): Promise<void> {
    if (this.storePollTimer) {
      clearInterval(this.storePollTimer);
      this.storePollTimer = null;
    }
    if (this.node) {
      try {
        await this.node.stop();
      } catch (error) {
        logger.warn('Error stopping Waku node:', error);
      }
      this.node = null;
    }
    this.encoder = null;
    this.decoder = null;
    this.handler = null;
    this.started = false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
