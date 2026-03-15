import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.js';
import type { ChannelId } from './events.js';
import { channelKey } from './events.js';

export interface ConversationMessage {
  role: 'user' | 'agent';
  text: string;
  timestamp: string;
  messageId?: string;
}

interface ConversationFile {
  channel: ChannelId;
  displayName: string;
  messages: ConversationMessage[];
}

export interface ConversationManager {
  getHistory(channel: ChannelId): Promise<ConversationMessage[]>;
  appendMessage(channel: ChannelId, msg: ConversationMessage, displayName?: string): Promise<void>;
  listChannels(): Promise<ChannelId[]>;
}

function channelFilename(ch: ChannelId): string {
  return `${ch.platform}_${ch.chatId}.json`;
}

export function createConversationManager(config: Config): ConversationManager {
  const dir = path.join(config.runtimeDir, 'conversations');

  async function readFile(ch: ChannelId): Promise<ConversationFile> {
    const filepath = path.join(dir, channelFilename(ch));
    try {
      const raw = await fsp.readFile(filepath, 'utf-8');
      return JSON.parse(raw) as ConversationFile;
    } catch {
      return { channel: ch, displayName: '', messages: [] };
    }
  }

  async function writeFile(ch: ChannelId, data: ConversationFile): Promise<void> {
    const filepath = path.join(dir, channelFilename(ch));
    const tmpPath = filepath + '.tmp';
    await fsp.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await fsp.rename(tmpPath, filepath);
  }

  return {
    async getHistory(channel: ChannelId): Promise<ConversationMessage[]> {
      const data = await readFile(channel);
      return data.messages.slice(-config.conversationHistoryLength);
    },

    async appendMessage(channel: ChannelId, msg: ConversationMessage, displayName?: string): Promise<void> {
      const data = await readFile(channel);
      data.messages.push(msg);
      if (displayName) {
        data.displayName = displayName;
      }
      await writeFile(channel, data);
    },

    async listChannels(): Promise<ChannelId[]> {
      try {
        const files = await fsp.readdir(dir);
        return files
          .filter(f => f.endsWith('.json'))
          .map(f => {
            const name = f.replace('.json', '');
            const sep = name.indexOf('_');
            return {
              platform: name.slice(0, sep),
              chatId: name.slice(sep + 1),
            };
          });
      } catch {
        return [];
      }
    },
  };
}
