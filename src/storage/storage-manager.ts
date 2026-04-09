import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { Message, AgentIdentity, ObsidianNote, SyncState } from '../types';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

export class StorageManager {
  private db: any = null;
  private storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    
    // Ensure storage directory exists
    const dir = path.dirname(storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async initialize(): Promise<void> {
    this.db = await open({
      filename: this.storagePath,
      driver: sqlite3.Database
    });

    await this.createTables();
    console.log('Storage manager initialized');
  }

  private async createTables(): Promise<void> {
    // Messages table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        sender TEXT NOT NULL,
        recipient TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp DATETIME NOT NULL,
        encrypted INTEGER NOT NULL,
        signature TEXT,
        delivered INTEGER DEFAULT 0,
        read INTEGER DEFAULT 0
      )
    `);

    // Agents table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        public_key TEXT NOT NULL,
        created_at DATETIME NOT NULL,
        last_seen DATETIME,
        trusted INTEGER DEFAULT 0
      )
    `);

    // Obsidian notes table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS obsidian_notes (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        content TEXT NOT NULL,
        last_modified DATETIME NOT NULL,
        hash TEXT NOT NULL,
        synced INTEGER DEFAULT 0,
        sync_timestamp DATETIME
      )
    `);

    // Sync state table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        agent_id TEXT PRIMARY KEY,
        last_sync DATETIME NOT NULL,
        notes_synced INTEGER DEFAULT 0,
        conflicts INTEGER DEFAULT 0,
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      )
    `);

    // Create indexes
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
      CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_notes_path ON obsidian_notes(path);
      CREATE INDEX IF NOT EXISTS idx_notes_hash ON obsidian_notes(hash);
    `);
  }

  // Message operations
  async saveMessage(message: Message): Promise<void> {
    await this.db.run(
      `INSERT INTO messages (id, sender, recipient, type, content, timestamp, encrypted, signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.sender,
        message.recipient,
        message.type,
        JSON.stringify(message.content),
        message.timestamp.toISOString(),
        message.encrypted ? 1 : 0,
        message.signature || null
      ]
    );
  }

  async getMessages(limit: number = 100, offset: number = 0): Promise<Message[]> {
    const rows = await this.db.all(
      `SELECT * FROM messages ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return rows.map((row: any) => ({
      id: row.id,
      sender: row.sender,
      recipient: row.recipient,
      type: row.type as any,
      content: JSON.parse(row.content),
      timestamp: new Date(row.timestamp),
      encrypted: row.encrypted === 1,
      signature: row.signature || undefined,
    }));
  }

  async getUnreadMessages(): Promise<Message[]> {
    const rows = await this.db.all(
      `SELECT * FROM messages WHERE read = 0 ORDER BY timestamp ASC`
    );

    return rows.map((row: any) => ({
      id: row.id,
      sender: row.sender,
      recipient: row.recipient,
      type: row.type as any,
      content: JSON.parse(row.content),
      timestamp: new Date(row.timestamp),
      encrypted: row.encrypted === 1,
      signature: row.signature || undefined,
    }));
  }

  async markMessageAsRead(messageId: string): Promise<void> {
    await this.db.run(
      `UPDATE messages SET read = 1 WHERE id = ?`,
      [messageId]
    );
  }

  // Agent operations
  async saveAgent(agent: AgentIdentity): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO agents (id, name, public_key, created_at, last_seen, trusted)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        agent.id,
        agent.name,
        agent.publicKey,
        agent.createdAt.toISOString(),
        new Date().toISOString(),
        0 // Default not trusted
      ]
    );
  }

  async getAgent(agentId: string): Promise<AgentIdentity | null> {
    const row = await this.db.get(
      `SELECT * FROM agents WHERE id = ?`,
      [agentId]
    );

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      publicKey: row.public_key,
      createdAt: new Date(row.created_at),
    };
  }

  async getAllAgents(): Promise<AgentIdentity[]> {
    const rows = await this.db.all(`SELECT * FROM agents ORDER BY last_seen DESC`);

    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      publicKey: row.public_key,
      createdAt: new Date(row.created_at),
    }));
  }

  async updateAgentLastSeen(agentId: string): Promise<void> {
    await this.db.run(
      `UPDATE agents SET last_seen = ? WHERE id = ?`,
      [new Date().toISOString(), agentId]
    );
  }

  // Obsidian notes operations
  async saveNote(note: ObsidianNote): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO obsidian_notes (id, path, content, last_modified, hash, synced)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        note.id,
        note.path,
        note.content,
        note.lastModified.toISOString(),
        note.hash,
        0 // Not synced yet
      ]
    );
  }

  async getNoteByPath(notePath: string): Promise<ObsidianNote | null> {
    const row = await this.db.get(
      `SELECT * FROM obsidian_notes WHERE path = ?`,
      [notePath]
    );

    if (!row) return null;

    return {
      id: row.id,
      path: row.path,
      content: row.content,
      lastModified: new Date(row.last_modified),
      hash: row.hash,
    };
  }

  async getModifiedNotes(since: Date): Promise<ObsidianNote[]> {
    const rows = await this.db.all(
      `SELECT * FROM obsidian_notes WHERE last_modified > ? ORDER BY last_modified DESC`,
      [since.toISOString()]
    );

    return rows.map((row: any) => ({
      id: row.id,
      path: row.path,
      content: row.content,
      lastModified: new Date(row.last_modified),
      hash: row.hash,
    }));
  }

  async markNoteAsSynced(noteId: string, agentId: string): Promise<void> {
    await this.db.run(
      `UPDATE obsidian_notes SET synced = 1, sync_timestamp = ? WHERE id = ?`,
      [new Date().toISOString(), noteId]
    );

    // Update sync state
    await this.updateSyncState(agentId, 1, 0);
  }

  // Sync state operations
  async updateSyncState(agentId: string, notesSynced: number, conflicts: number): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO sync_state (agent_id, last_sync, notes_synced, conflicts)
       VALUES (?, ?, COALESCE((SELECT notes_synced FROM sync_state WHERE agent_id = ?), 0) + ?,
               COALESCE((SELECT conflicts FROM sync_state WHERE agent_id = ?), 0) + ?)`,
      [
        agentId,
        new Date().toISOString(),
        agentId,
        notesSynced,
        agentId,
        conflicts
      ]
    );
  }

  async getSyncState(agentId: string): Promise<SyncState | null> {
    const row = await this.db.get(
      `SELECT * FROM sync_state WHERE agent_id = ?`,
      [agentId]
    );

    if (!row) return null;

    return {
      agentId: row.agent_id,
      lastSync: new Date(row.last_sync),
      notesSynced: row.notes_synced,
      conflicts: row.conflicts,
    };
  }

  async close(): Promise<void> {
    if (this.db) {
      try {
        await this.db.close();
      } catch (_) {
        // already closed
      }
      this.db = null;
    }
  }
}
