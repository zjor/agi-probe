import 'dotenv/config';
import path from 'node:path';
import os from 'node:os';

export interface Config {
  anthropicApiKey: string;
  telegramBotToken: string;
  allowedTelegramUsers: string[];
  runtimeDir: string;
  heartbeatIntervalMs: number;
  costLimitUsd: number;
  maxToolIterations: number;
  conversationHistoryLength: number;
  claudeModel: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function resolveDir(dir: string): string {
  if (dir.startsWith('~')) {
    return path.join(os.homedir(), dir.slice(1));
  }
  return path.resolve(dir);
}

export function loadConfig(): Config {
  const config: Config = {
    anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
    telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    allowedTelegramUsers: optionalEnv('ALLOWED_TELEGRAM_USERS', '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    runtimeDir: resolveDir(optionalEnv('RUNTIME_DIR', '~/.agi-probe/runtime')),
    heartbeatIntervalMs: parseInt(optionalEnv('HEARTBEAT_INTERVAL_MS', '60000'), 10),
    costLimitUsd: parseFloat(optionalEnv('COST_LIMIT_USD', '5.0')),
    maxToolIterations: parseInt(optionalEnv('MAX_TOOL_ITERATIONS', '10'), 10),
    conversationHistoryLength: parseInt(optionalEnv('CONVERSATION_HISTORY_LENGTH', '20'), 10),
    claudeModel: optionalEnv('CLAUDE_MODEL', 'claude-sonnet-4-20250514'),
  };

  if (config.allowedTelegramUsers.length === 0) {
    console.warn('[config] WARNING: ALLOWED_TELEGRAM_USERS is empty — all messages will be rejected');
  }

  return config;
}
