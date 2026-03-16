import type Anthropic from '@anthropic-ai/sdk';
import type { StateManager } from './state.js';
import type { ConversationManager, ConversationMessage } from './conversations.js';
import type { Logger, ThoughtLogEntry } from './logger.js';
import type { ChannelId } from './events.js';
import { channelKey } from './events.js';

const RECENT_THOUGHTS_LIMIT = 10;

export async function assembleFastLanePrompt(
  stateManager: StateManager,
  conversationManager: ConversationManager,
  logger: Logger,
  channel: ChannelId,
): Promise<{ system: string; messages: Anthropic.MessageParam[] }> {
  const systemPrompt = await stateManager.readSystemPrompt();

  // Read all mind files
  const mindFiles = await stateManager.listMindFiles();
  const mindContents: string[] = [];
  for (const file of mindFiles.sort()) {
    const content = await stateManager.readMindFile(file);
    mindContents.push(`## ${file}\n\n${content}`);
  }

  // Build user message
  const parts: string[] = [];

  // Fast lane instruction
  parts.push('# Live Conversation');
  parts.push(`You are responding to a live conversation in chat **${channel.chatId}** (${channel.platform}).`);
  parts.push('You MUST use the `send_telegram` tool with this chat_id to reply. Do NOT just produce text — your text response is not delivered to the user unless you call `send_telegram`.');
  parts.push('Be natural and responsive. You do NOT have access to update your mind files — that happens in your background thinking.');
  parts.push('');

  // Mind files
  parts.push('# Your Mind');
  parts.push(mindContents.join('\n\n'));
  parts.push('');

  // Recent thoughts
  const recentThoughts = await logger.getRecentThoughts(RECENT_THOUGHTS_LIMIT);
  if (recentThoughts.length > 0) {
    parts.push('## Recent Thoughts (your inner monologue from previous ticks)');
    for (const t of recentThoughts) {
      parts.push(`- [${t.timestamp}] (${t.category}) ${t.thought}`);
    }
    parts.push('');
  }

  // Conversation history for this channel
  const history = await conversationManager.getHistory(channel);
  const key = channelKey(channel);
  parts.push(`## Conversation: ${key}`);
  if (history.length > 0) {
    const historyText = history
      .map((m: ConversationMessage) => `[${m.timestamp}] ${m.role}: ${m.text}`)
      .join('\n');
    parts.push(historyText);
  } else {
    parts.push('(no prior history)');
  }
  parts.push('');

  return {
    system: systemPrompt,
    messages: [{ role: 'user', content: parts.join('\n') }],
  };
}
