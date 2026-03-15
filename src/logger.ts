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

export interface Logger {
  logTick(entry: TickLogEntry): Promise<void>;
  logRaw(entry: RawLogEntry): Promise<void>;
  logThought(entry: ThoughtLogEntry): Promise<void>;
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
  };
}
