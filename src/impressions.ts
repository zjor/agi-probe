import type { ChannelId } from './events.js';

export interface Impression {
  timestamp: string;
  channel: ChannelId;
  userSaid: string;
  agentReplied: string;
  emotionalSignal?: string;
}

export interface ImpressionQueue {
  push(impression: Impression): void;
  drain(): Impression[];
  size(): number;
}

const DEFAULT_MAX_IMPRESSIONS = 50;

export function createImpressionQueue(maxSize?: number): ImpressionQueue {
  const max = maxSize ?? (parseInt(process.env.MAX_IMPRESSIONS || '', 10) || DEFAULT_MAX_IMPRESSIONS);
  const queue: Impression[] = [];

  return {
    push(impression: Impression): void {
      if (queue.length >= max) {
        const dropped = queue.shift();
        console.warn(`[impressions] Queue full (${max}), dropping oldest impression from ${dropped?.channel.chatId}`);
      }
      queue.push(impression);
    },

    drain(): Impression[] {
      return queue.splice(0, queue.length);
    },

    size(): number {
      return queue.length;
    },
  };
}
