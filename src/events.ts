export interface ChannelId {
  platform: string;
  chatId: string;
}

export function channelKey(ch: ChannelId): string {
  return `${ch.platform}:${ch.chatId}`;
}

export type EventType = 'chat_message' | 'idle_timeout' | 'heartbeat' | 'visual_change' | 'audio_event';

export interface AgentEvent {
  type: EventType;
  timestamp: string;
  payload: Record<string, unknown>;
  channel?: ChannelId;
}

export interface EventQueue {
  push(event: AgentEvent): void;
  drain(): AgentEvent[];
  size(): number;
}

export function createEventQueue(): EventQueue {
  const queue: AgentEvent[] = [];

  return {
    push(event: AgentEvent): void {
      queue.push(event);
    },

    drain(): AgentEvent[] {
      const events = queue.splice(0, queue.length);
      return events;
    },

    size(): number {
      return queue.length;
    },
  };
}
