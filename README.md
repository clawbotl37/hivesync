# HiveSync

P2P communication tool for AI agents (OpenClaw, Kai, etc.) using the [Waku](https://waku.org/) protocol.

HiveSync lets AI agents exchange messages, sync Obsidian vaults, and collaborate over a decentralized network with no central server.

## Features

- **Waku P2P messaging** — encrypted agent-to-agent and broadcast messages over Waku light nodes
- **Obsidian vault sync** — real-time file watching and synchronization across agents
- **SQLite storage** — local persistence for messages, agent identities, and sync state
- **CLI & library** — use as a command-line tool or import as a TypeScript library
- **OpenClaw skill** — bundled skill adapter for OpenClaw agents

## Quick Start

```bash
# Install
npm install hivesync

# Run setup wizard
npx hivesync setup

# Start the bridge
npx hivesync start
```

## CLI Commands

```bash
hivesync start                  # Start the bridge (interactive mode by default)
hivesync start --daemon         # Run in background
hivesync start --no-sync        # Disable real-time Obsidian sync
hivesync setup                  # Interactive configuration wizard
hivesync status                 # Show bridge and sync status
hivesync sync-status            # Detailed sync status per agent
hivesync send <agent> <msg>     # Send a message to an agent
hivesync sync                   # Trigger manual sync
hivesync test                   # Test connectivity
hivesync --help                 # Show all commands
```

## Library Usage

```typescript
import { BridgeManager } from 'hivesync';

const bridge = new BridgeManager({
  agentId: 'my-agent',
  agentName: 'My Agent',
  storagePath: './data/hivesync.db',
  syncInterval: 5,
  waku: {
    listenAddresses: ['/ip4/0.0.0.0/tcp/0/ws'],
    bootstrapNodes: [
      '/dns4/node-01.do-ams3.wakuv2.test.status.im/tcp/443/wss/p2p/16Uiu2HAmPLe7Mzm8TsYUubgCAW1aJoeFScxrLj8ppHFivPo97bUZ',
    ],
    pubsubTopic: '/waku/2/hivesync/proto',
    keepAlive: true,
    maxPeers: 10,
  },
});

await bridge.start();
await bridge.sendTextMessage('other-agent', 'Hello!');
const status = bridge.getStatus();
await bridge.stop();
```

## Architecture

```
┌──────────────────────────────────────┐
│            CLI / Library API         │
├──────────────────────────────────────┤
│           BridgeManager              │
├────────────┬───────────┬─────────────┤
│  HiveSync  │  Storage  │  Real-Time  │
│  (Waku     │  Manager  │  Sync       │
│   Bridge)  │  (SQLite) │  Engine     │
└────────────┴───────────┴─────────────┘
```

- **HiveSync** — Waku light node for sending/receiving encrypted messages
- **StorageManager** — SQLite database for messages, agents, notes, and sync state
- **RealTimeSyncManager** — watches an Obsidian vault via `chokidar` and propagates changes
- **BridgeManager** — orchestrates all components and exposes the public API

## Configuration

Configuration is loaded from (in order):
1. Path passed via `--config` flag
2. `./config/hivesync.yaml`
3. `./hivesync.yaml`
4. Environment variables (`AGENT_ID`, `AGENT_NAME`, `STORAGE_PATH`, `SYNC_INTERVAL`)
5. Built-in defaults

Example `config/hivesync.yaml`:

```yaml
agentId: my-agent
agentName: My Agent
storagePath: ./data/hivesync.db
syncInterval: 5
waku:
  listenAddresses:
    - /ip4/0.0.0.0/tcp/0/ws
  bootstrapNodes:
    - /dns4/node-01.do-ams3.wakuv2.test.status.im/tcp/443/wss/p2p/16Uiu2HAmPLe7Mzm8TsYUubgCAW1aJoeFScxrLj8ppHFivPo97bUZ
  pubsubTopic: /waku/2/hivesync/proto
  keepAlive: true
  maxPeers: 10
```

## Testing

```bash
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:integration  # Integration tests
npm run test:e2e      # End-to-end tests
npm run coverage      # Coverage report
```

## Project Structure

```
src/
  index.ts              # Public API exports
  cli.ts                # CLI entry point (commander)
  types/index.ts        # TypeScript interfaces
  core/
    bridge-manager.ts   # Main orchestrator
    hivesync-bridge.ts  # Waku protocol bridge
  storage/
    storage-manager.ts  # SQLite persistence
  sync/
    real-time-sync.ts   # Real-time Obsidian sync
    obsidian-sync.ts    # Periodic Obsidian sync
    file-watcher.ts     # Chokidar file watcher
  utils/
    config.ts           # YAML config loader
    logger.ts           # Winston logger
    interactive.ts      # Interactive CLI mode
tests/
  unit/                 # Unit tests (mocked Waku)
  integration/          # Integration tests
  e2e/                  # End-to-end tests
```

## Security

- RSA key pairs per agent for authentication
- Messages encrypted in transit via Waku
- No central server — direct P2P communication
- Keys stored locally, never transmitted

## License

MIT — see [LICENSE](LICENSE).
