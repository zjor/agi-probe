import type Anthropic from '@anthropic-ai/sdk';
import type { StateManager } from './state.js';
import type { Logger, ThoughtLogEntry } from './logger.js';
import type { AgentEvent, ChannelId } from './events.js';
import type { ConversationManager, ConversationMessage } from './conversations.js';
import type { Impression } from './impressions.js';
import { channelKey } from './events.js';

export interface TickContext {
  tickId: number;
  trigger: string;
  events: AgentEvent[];
  impressions: Impression[];
  timeSinceLastTickMs: number | null;
  tickCostUsd: number;
  cumulativeCostUsd: number;
  costLimitUsd: number;
}

const RECENT_THOUGHTS_LIMIT = 10;

export async function assemblePrompt(
  stateManager: StateManager,
  conversationManager: ConversationManager,
  logger: Logger,
  context: TickContext,
): Promise<{ system: string; messages: Anthropic.MessageParam[] }> {
  const systemPrompt = await stateManager.readSystemPrompt();

  // Read all mind files
  const mindFiles = await stateManager.listMindFiles();
  const mindContents: string[] = [];
  for (const file of mindFiles.sort()) {
    const content = await stateManager.readMindFile(file);
    mindContents.push(`## ${file}\n\n${content}`);
  }

  // Group chat events by channel
  const chatEventsByChannel = new Map<string, { channel: ChannelId; events: AgentEvent[] }>();
  const nonChatEvents: AgentEvent[] = [];

  for (const event of context.events) {
    if (event.type === 'chat_message' && event.channel) {
      const key = channelKey(event.channel);
      if (!chatEventsByChannel.has(key)) {
        chatEventsByChannel.set(key, { channel: event.channel, events: [] });
      }
      chatEventsByChannel.get(key)!.events.push(event);
    } else {
      nonChatEvents.push(event);
    }
  }

  // Build conversation sections
  const conversationSections: string[] = [];
  for (const [key, { channel }] of chatEventsByChannel) {
    const history = await conversationManager.getHistory(channel);
    const historyText = history
      .map((m: ConversationMessage) => `[${m.timestamp}] ${m.role}: ${m.text}`)
      .join('\n');
    conversationSections.push(
      `### Conversation: ${key}\n\n${historyText || '(no prior history)'}`,
    );
  }

  // Build user message
  const parts: string[] = [];

  // Tick metadata
  parts.push(`# Tick #${context.tickId}`);
  parts.push(`**Trigger**: ${context.trigger}`);
  parts.push(`**Time**: ${new Date().toISOString()}`);
  if (context.timeSinceLastTickMs !== null) {
    parts.push(`**Time since last tick**: ${Math.round(context.timeSinceLastTickMs / 1000)}s`);
  }
  parts.push('');

  // Cost info
  parts.push('## Cost Summary');
  parts.push(`- This tick so far: $${context.tickCostUsd.toFixed(4)}`);
  parts.push(`- Cumulative session cost: $${context.cumulativeCostUsd.toFixed(4)}`);
  parts.push(`- Daily cost limit: $${context.costLimitUsd.toFixed(2)}`);
  parts.push('');

  // Mind files
  parts.push('# Your Mind');
  parts.push(mindContents.join('\n\n'));
  parts.push('');

  // Recent thoughts (from log_thought — your inner monologue across ticks)
  const recentThoughts = await logger.getRecentThoughts(RECENT_THOUGHTS_LIMIT);
  if (recentThoughts.length > 0) {
    parts.push('## Recent Thoughts (your inner monologue from previous ticks)');
    for (const t of recentThoughts) {
      parts.push(`- [${t.timestamp}] (${t.category}) ${t.thought}`);
    }
    parts.push('');
  }

  // Impressions from recent fast lane conversations
  if (context.impressions.length > 0) {
    parts.push('## Impressions from Recent Conversations');
    parts.push('Review the impressions below. Decide whether any conversations should influence your state, worldview, or strategy.');
    for (const imp of context.impressions) {
      const chKey = channelKey(imp.channel);
      parts.push(`- [${imp.timestamp}] ${chKey} — User: "${imp.userSaid}" → Agent: "${imp.agentReplied}"`);
    }
    parts.push('');
  }

  // Events
  if (nonChatEvents.length > 0) {
    parts.push('## Events Since Last Tick');
    for (const event of nonChatEvents) {
      parts.push(`- [${event.timestamp}] ${event.type}: ${JSON.stringify(event.payload)}`);
    }
    parts.push('');
  }

  // Conversations
  if (conversationSections.length > 0) {
    parts.push('## Conversations');
    parts.push(conversationSections.join('\n\n'));
    parts.push('');
  }

  return {
    system: systemPrompt,
    messages: [{ role: 'user', content: parts.join('\n') }],
  };
}
