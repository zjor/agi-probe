import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.js';

const READ_ONLY_FILES = new Set(['soul.md', 'ethics.md']);
const STALE_LOCK_TIMEOUT_MS = 30_000;

export interface StateManager {
  readMindFile(filename: string): Promise<string>;
  writeMindFile(filename: string, content: string): Promise<void>;
  readSystemPrompt(): Promise<string>;
  listMindFiles(): Promise<string[]>;
  bootstrap(seedDir: string): Promise<boolean>;
}

export function createStateManager(config: Config): StateManager {
  const mindDir = path.join(config.runtimeDir, 'mind');
  const historyDir = path.join(mindDir, 'history');
  const conversationsDir = path.join(config.runtimeDir, 'conversations');
  const logsDir = path.join(config.runtimeDir, 'logs');

  async function ensureDirs(): Promise<void> {
    await fsp.mkdir(mindDir, { recursive: true });
    await fsp.mkdir(historyDir, { recursive: true });
    await fsp.mkdir(conversationsDir, { recursive: true });
    await fsp.mkdir(logsDir, { recursive: true });
  }

  async function acquireLock(filepath: string): Promise<void> {
    const lockPath = filepath + '.lock';
    try {
      const stat = await fsp.stat(lockPath);
      const age = Date.now() - stat.mtimeMs;
      if (age > STALE_LOCK_TIMEOUT_MS) {
        console.warn(`[state] Removing stale lock: ${lockPath} (age: ${age}ms)`);
        await fsp.unlink(lockPath);
      } else {
        throw new Error(`Lock exists for ${filepath} (age: ${age}ms)`);
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT' && !err.message.includes('Lock exists')) {
        throw err;
      }
      if (err.message?.includes('Lock exists')) throw err;
    }
    await fsp.writeFile(lockPath, String(process.pid), { flag: 'wx' }).catch(async () => {
      throw new Error(`Failed to acquire lock for ${filepath}`);
    });
  }

  async function releaseLock(filepath: string): Promise<void> {
    const lockPath = filepath + '.lock';
    await fsp.unlink(lockPath).catch(() => {});
  }

  async function snapshotBeforeWrite(filepath: string): Promise<void> {
    try {
      await fsp.access(filepath);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const basename = path.basename(filepath);
      const snapshotPath = path.join(historyDir, `${basename}.${timestamp}`);
      await fsp.copyFile(filepath, snapshotPath);
    } catch {
      // File doesn't exist yet, no snapshot needed
    }
  }

  async function atomicWrite(filepath: string, content: string): Promise<void> {
    const tmpPath = filepath + '.tmp';
    await fsp.writeFile(tmpPath, content, 'utf-8');
    await fsp.rename(tmpPath, filepath);
  }

  return {
    async readMindFile(filename: string): Promise<string> {
      const filepath = path.join(mindDir, filename);
      return fsp.readFile(filepath, 'utf-8');
    },

    async writeMindFile(filename: string, content: string): Promise<void> {
      if (READ_ONLY_FILES.has(filename)) {
        throw new Error(`Cannot write to read-only file: ${filename}`);
      }
      const filepath = path.join(mindDir, filename);
      await acquireLock(filepath);
      try {
        await snapshotBeforeWrite(filepath);
        await atomicWrite(filepath, content);
      } finally {
        await releaseLock(filepath);
      }
    },

    async readSystemPrompt(): Promise<string> {
      const filepath = path.join(config.runtimeDir, 'system-prompt.md');
      return fsp.readFile(filepath, 'utf-8');
    },

    async listMindFiles(): Promise<string[]> {
      const entries = await fsp.readdir(mindDir);
      return entries.filter(e => e.endsWith('.md'));
    },

    async bootstrap(seedDir: string): Promise<boolean> {
      await ensureDirs();

      const mindExists = fs.existsSync(path.join(mindDir, 'soul.md'));
      if (mindExists) {
        // Validate required files
        const required = ['soul.md', 'ethics.md', 'worldview.md', 'strategy.md', 'state.md'];
        for (const file of required) {
          if (!fs.existsSync(path.join(mindDir, file))) {
            console.warn(`[state] WARNING: Missing mind file: ${file}`);
          }
        }
        if (!fs.existsSync(path.join(config.runtimeDir, 'system-prompt.md'))) {
          console.warn('[state] WARNING: Missing system-prompt.md');
        }
        return false; // Not a fresh bootstrap
      }

      // Copy seed files
      const seedMindDir = path.join(seedDir, 'mind');
      const seedMindFiles = await fsp.readdir(seedMindDir);
      for (const file of seedMindFiles) {
        const src = path.join(seedMindDir, file);
        const dest = path.join(mindDir, file);
        await fsp.copyFile(src, dest);
      }

      // Copy system prompt
      const seedSystemPrompt = path.join(seedDir, 'system-prompt.md');
      const destSystemPrompt = path.join(config.runtimeDir, 'system-prompt.md');
      await fsp.copyFile(seedSystemPrompt, destSystemPrompt);

      return true; // Fresh bootstrap
    },
  };
}
