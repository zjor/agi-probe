import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.js';

export interface TickLogEntry {
  timestamp: string;
  tick_id: number;
  trigger: string;
  events: unknown[];
  prompt_summary?: string;
  response_summary?: string;
  tool_calls?: unknown[];
  state_delta?: string;
  cost_usd: number;
  cumulative_cost_usd: number;
  lane?: 'fast' | 'slow';
}

export interface RawLogEntry {
  timestamp: string;
  tick_id: number;
  direction: 'request' | 'response';
  data: unknown;
}

export interface ThoughtLogEntry {
  timestamp: string;
  tick_id: number;
  thought: string;
  category: string;
}

export interface ImpressionLogEntry {
  timestamp: string;
  lane: 'fast';
  channel: string;
  summary: string;
}

export interface Logger {
  logTick(entry: TickLogEntry): Promise<void>;
  logRaw(entry: RawLogEntry): Promise<void>;
  logThought(entry: ThoughtLogEntry): Promise<void>;
  logImpression(entry: ImpressionLogEntry): Promise<void>;
  getRecentThoughts(limit: number): Promise<ThoughtLogEntry[]>;
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createLogger(config: Config): Logger {
  const logsDir = path.join(config.runtimeDir, 'logs');

  async function appendJsonl(filename: string, data: unknown): Promise<void> {
    const filepath = path.join(logsDir, filename);
    const line = JSON.stringify(data) + '\n';
    await fsp.appendFile(filepath, line, 'utf-8');
  }

  return {
    async logTick(entry: TickLogEntry): Promise<void> {
      await appendJsonl(`thinking-${todayDateString()}.jsonl`, entry);
    },

    async logRaw(entry: RawLogEntry): Promise<void> {
      await appendJsonl(`raw-${todayDateString()}.jsonl`, entry);
    },

    async logThought(entry: ThoughtLogEntry): Promise<void> {
      await appendJsonl(`thinking-${todayDateString()}.jsonl`, {
        type: 'thought',
        ...entry,
      });
    },

    async logImpression(entry: ImpressionLogEntry): Promise<void> {
      await appendJsonl(`thinking-${todayDateString()}.jsonl`, {
        type: 'impression',
        ...entry,
      });
    },

    async getRecentThoughts(limit: number): Promise<ThoughtLogEntry[]> {
      const filepath = path.join(logsDir, `thinking-${todayDateString()}.jsonl`);
      try {
        const raw = await fsp.readFile(filepath, 'utf-8');
        const lines = raw.trim().split('\n').filter(Boolean);
        const thoughts: ThoughtLogEntry[] = [];
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === 'thought') {
              thoughts.push(entry as ThoughtLogEntry);
            }
          } catch { /* skip malformed lines */ }
        }
        return thoughts.slice(-limit);
      } catch {
        return [];
      }
    },
  };
}
