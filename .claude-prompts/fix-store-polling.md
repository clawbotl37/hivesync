# Fix: Waku message delivery — add Store polling fallback

## Problem
The HiveSync daemon uses a Waku **light node** (`createLightNode`) which only supports LightPush (send) and Filter (receive). On the Waku testnet:

1. **Filter subscribe gets 0 peers** — no peer accepts the filter subscription, so we can't receive ANY messages
2. **LightPush fails on all peers** — "Remote peer rejected" / "No stream available" on every attempt
3. **Relay fallback is dead code** — `this.node.relay` is `undefined` because `createLightNode` doesn't enable Relay
4. **Store protocol IS available** (`store: true`) but never used for message retrieval

## Solution
Add Store-based message polling as a fallback when Filter subscription fails. The Store protocol allows querying historical messages on a content topic — we poll it every 5 seconds to retrieve messages we missed.

## File to modify: `/root/hivesync/src/core/waku-transport.ts`

### Changes needed:

#### 1. Add Store polling state fields to the class
Add these private fields to `WakuTransport`:
- `private storePollTimer: NodeJS.Timeout | null = null;`
- `private lastStoreQueryTime: Date | null = null;`
- `private storePolling = false;`

#### 2. Modify `subscribe()` method (line 81-102)
After the existing Filter subscribe attempt:
- If `successes === 0` (0 peers accepted Filter), log a warning and start Store polling as fallback
- If `successes > 0`, still start Store polling as a supplement (to catch messages missed during Filter gaps)
- Store polling loop:
  - Every 5 seconds, call `this.node.store.queryWithOrderedCallback([this.decoder], callback, { startTime: this.lastStoreQueryTime, pageSize: 50 })`
  - For each message received, call `this.handler(msg.payload)` (same as Filter handler)
  - Update `this.lastStoreQueryTime` to now after each poll
  - Skip if already polling (`this.storePolling` flag)
  - Use `this.storePollTimer.unref?.()` so it doesn't block process exit

Implementation of the polling method:
```typescript
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
```

#### 3. Add a `startStorePolling()` method
```typescript
private startStorePolling(): void {
  if (this.storePollTimer) return;
  this.lastStoreQueryTime = new Date();
  this.storePollTimer = setInterval(() => void this.pollStore(), 5000);
  this.storePollTimer.unref?.();
  logger.info('Started Store polling fallback for message retrieval');
}
```

#### 4. Modify `publish()` method (line 109-150)
- After LightPush fails AND Relay fallback fails (or relay is undefined), try Store-based verification
- Actually, for sending: keep LightPush retries (existing), and when all fail, log warning but DON'T crash (already done)
- Remove the dead Relay fallback code (lines 137-146) since `this.node.relay` is always undefined on a light node. Replace with a comment explaining that Store polling on the receiver side will catch the message if LightPush eventually gets through to a Store-enabled peer.
- Actually, keep the Relay code as-is for forward compatibility (if someone later enables Relay). Just add a log when relay is not available.

#### 5. Modify `stop()` method (line 166-179)
- Clear the store poll timer: `if (this.storePollTimer) { clearInterval(this.storePollTimer); this.storePollTimer = null; }`

#### 6. Update type definitions in `/root/hivesync/src/types/js-waku.d.ts`
Add to the `LightNode` interface:
```typescript
  store?: {
    queryWithOrderedCallback(
      decoders: IDecoder | IDecoder[],
      callback: (msg: IDecodedMessage) => void | Promise<void>,
      options?: { pageSize?: number; startTime?: Date; endTime?: Date }
    ): Promise<void>;
    queryWithPromiseCallback(
      decoders: IDecoder | IDecoder[],
      callback: (msg: IDecodedMessage) => Promise<boolean | void>,
      options?: { pageSize?: number; startTime?: Date; endTime?: Date }
    ): Promise<void>;
  };
```

### Testing after implementation:
1. `npm run build` — must pass clean
2. Start daemon: `node dist/cli.js start --daemon --plain`
3. Check logs for "Started Store polling fallback for message retrieval"
4. Send a test message from another agent and verify it arrives via Store polling

### Important notes:
- Do NOT change the Filter subscribe logic — keep it as primary, Store is fallback
- Do NOT remove LightPush — keep it as primary send method
- The Store poll interval of 5s is intentional — fast enough for near-real-time, not too aggressive
- Use `unref()` on the timer so it doesn't block process exit
- Handle the case where `this.node.store` is undefined (shouldn't happen with createLightNode, but be defensive)
