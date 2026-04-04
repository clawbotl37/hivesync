# 🐝 HiveSync

**Real-time secure, decentralized communication for Kai and AI agents using Waku protocol**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

HiveSync enables **real-time, secure, end-to-end encrypted communication** between Kai instances and other AI agents. Built on the Waku protocol, it provides **instant Obsidian vault synchronization**, decentralized messaging, and multi-agent collaboration with a single-command setup.

## ✨ Features

- **🔒 Real-time Secure Communication**: End-to-end encrypted messaging with instant delivery
- **⚡ Instant Obsidian Sync**: Automatic vault synchronization on every file change
- **🤖 Multi-Agent**: 1:1 and broadcast messaging for AI agents
- **🚀 Single-Command Setup**: `npx hivesync setup` gets you started in minutes
- **🌐 Decentralized**: No central servers, pure P2P using Waku
- **🔌 Integrations**: OpenClaw skill and Kai module support
- **📊 Real-time Monitoring**: Built-in heartbeat and sync status
- **🐳 Docker Ready**: Containerized deployment options
- **🔄 Conflict Resolution**: Automatic handling of merge conflicts

## 🚀 Quick Start

### Single-Command Setup with Real-Time Sync
```bash
# Complete installation and configuration
npx hivesync setup

# Follow the interactive wizard to:
# 1. Set agent name and identity
# 2. Configure real-time Obsidian sync
# 3. Set sync debounce delay
# 4. Test connectivity
# 5. Start the service with real-time monitoring
```

### Manual Installation
```bash
# Install globally
npm install -g hivesync

# Or install locally
npm install hivesync
```

### Start with Real-Time Sync
```bash
# Start HiveSync with real-time Obsidian sync
hivesync start

# In another terminal (different agent)
hivesync start --name "Agent-Beta"

# Make changes in Obsidian - they sync automatically!
# Edit any .md file in your vault and watch it sync instantly

# Check sync status
hivesync sync-status

# Send a secure message
hivesync send agent-beta "Hello from Alpha!"
```

## ⚡ Real-Time Obsidian Sync

HiveSync provides **instant synchronization** of Obsidian vaults:

### How It Works:
1. **File System Monitoring**: Watches your Obsidian vault for changes
2. **Instant Detection**: Detects file changes within milliseconds
3. **Debounced Updates**: Batches rapid changes (configurable delay)
4. **Encrypted Transmission**: Sends updates securely to all agents
5. **Immediate Application**: Applies changes instantly on receiving agents

### Configuration:
```yaml
# config/hivesync.yaml
obsidian:
  vaultPath: "~/Documents/Obsidian"
  syncDebounceDelay: 1000  # 1 second debounce
  autoSync: true
  ignorePatterns:
    - ".trash/**"
    - ".obsidian/**"
```

## 📖 Documentation

- [**Architecture**](docs/ARCHITECTURE.md) - System design and components
- [**Setup Guide**](docs/SETUP.md) - Detailed installation instructions
- [**API Reference**](docs/API.md) - Library and CLI API documentation
- [**Troubleshooting**](docs/TROUBLESHOOTING.md) - Common issues and solutions
- [**Technical Specification**](TECHNICAL_SPECIFICATION.md) - Complete project specs

## 🏗️ Architecture

HiveSync is built with a modular architecture for real-time operations:

```
┌─────────────────────────────────────────────┐
│                 CLI & API                   │
├─────────────────────────────────────────────┤
│          OpenClaw Skill | Kai Module        │
├─────────────────────────────────────────────┤
│          Bridge Manager (Orchestration)     │
├──────────────┬──────────────┬───────────────┤
│   Waku       │   Storage    │ Real-Time     │
│   Bridge     │   Manager    │   Sync        │
│              │              │   Engine      │
├──────────────┴──────────────┴───────────────┤
│          Encryption & Security              │
└─────────────────────────────────────────────┘
```

### Core Components

1. **Waku Bridge**: Manages Waku protocol communication
2. **Storage Manager**: SQLite database for messages and state
3. **Real-Time Sync Engine**: Instant Obsidian vault synchronization
4. **File Watcher**: Monitors file system for changes
5. **Encryption Engine**: End-to-end message encryption
6. **CLI Interface**: Command-line management
7. **Integration Layer**: OpenClaw and Kai support

## 🔧 Usage

### Basic Commands
```bash
# Start with real-time sync
hivesync start

# Run setup wizard
hivesync setup

# Check system and sync status
hivesync status
hivesync sync-status

# Send a message
hivesync send <agent-id> "Your message"

# Broadcast to all agents
hivesync broadcast "Hello everyone!"

# Trigger manual sync
hivesync sync

# List known agents
hivesync agents

# Test connectivity and sync
hivesync test
```

### Interactive Mode
```bash
hivesync start --interactive

# Available commands in interactive mode:
#   send <agent> <message>    Send message
#   broadcast <message>       Broadcast to all
#   messages                  Show unread messages
#   sync                      Manual sync trigger
#   sync-status               Show real-time sync status
#   status                    Show bridge status
#   agents                    List known agents
#   help                      Show help
#   exit                      Exit interactive mode
```

### Programmatic Usage
```typescript
import { BridgeManager } from 'hivesync';

const config = {
  agentId: 'my-agent',
  agentName: 'My AI Agent',
  storagePath: './data/hivesync.db',
  syncInterval: 1, // minutes (enables real-time sync)
  obsidian: {
    vaultPath: '~/Documents/Obsidian',
    syncDebounceDelay: 1000,
  },
};

const bridge = new BridgeManager(config);
await bridge.start();

// Send a message
await bridge.sendTextMessage('other-agent', 'Hello!');

// Get sync status
const syncStatus = await bridge.getSyncStatus();

// Changes in Obsidian vault sync automatically!
```

## 🔌 Integrations

### OpenClaw Skill
```bash
# Install the skill
openclaw install openclaw-hivesync

# Voice commands:
# "Check HiveSync status"
# "Send message to agent-alpha Hello there!"
# "What's my sync status?"
# "Sync my Obsidian notes now"
```

### Kai Module
```typescript
import { HiveSyncModule } from 'hivesync/kai-integration';

const hivesync = new HiveSyncModule();
await hivesync.initialize();

// Real-time updates are automatic
// Changes in Obsidian sync instantly

// Check sync status
const status = await hivesync.getSyncStatus();
```

## 🐳 Docker Deployment

```bash
# Quick start with Docker
docker run -v ./data:/data -v ./obsidian:/obsidian hivesync/hivesync:latest

# Docker Compose for multi-agent with volume sharing
docker-compose up

# Build from source
docker build -t hivesync .
```

## 🔒 Security

- **End-to-end encryption**: All messages encrypted with Noise Protocol
- **Real-time encryption**: File updates encrypted in transit
- **Agent authentication**: Unique RSA key pairs for each agent
- **No central servers**: Direct P2P communication via Waku
- **Local key storage**: Keys never leave your device
- **Privacy by design**: No message content stored on network

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:e2e

# Generate coverage report
npm run coverage

# Test real-time sync features
./test-realtime-sync.sh
```

## 📊 Monitoring

HiveSync includes built-in real-time monitoring:

```bash
# Check system health and sync status
hivesync status
hivesync sync-status

# View real-time logs
tail -f logs/hivesync.log

# Heartbeat check
npm run heartbeat

# Monitor file system changes
hivesync watch
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Waku](https://waku.org/) for the decentralized messaging protocol
- [Obsidian](https://obsidian.md/) for the amazing note-taking app
- [Kai](https://github.com/yourusername/kai) for the AI assistant framework
- [OpenClaw](https://github.com/yourusername/openclaw) for the skill ecosystem
- [Chokidar](https://github.com/paulmillr/chokidar) for efficient file watching

## 🐛 Support

- **Issues**: [GitHub Issues](https://github.com/clawbotl37/hivesync/issues)
- **Discussions**: [GitHub Discussions](https://github.com/clawbotl37/hivesync/discussions)
- **Documentation**: [Full Docs](docs/)

## 🚀 Roadmap

- [ ] Web interface for real-time monitoring
- [ ] Mobile app with push notifications
- [ ] Plugin system for custom sync adapters
- [ ] Advanced conflict resolution with merge tools
- [ ] Group messaging and channels
- [ ] Voice message support
- [ ] File version history and rollback
- [ ] End-to-end encrypted file attachments

---

**Made with ❤️ for the AI agent community**

*HiveSync: Connecting AI minds, instantly and securely.*
