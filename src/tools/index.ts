import type Anthropic from '@anthropic-ai/sdk';
import type { StateManager } from '../state.js';
import type { Logger } from '../logger.js';
import type { ConversationManager } from '../conversations.js';
import type { Bot } from 'grammy';

export interface ToolContext {
  stateManager: StateManager;
  logger: Logger;
  conversationManager: ConversationManager;
  bot: Bot;
  tickId: number;
}

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'update_state',
    description: 'Write to mind/state.md. Call this every cycle to record your emotional register, observations, decisions, and internal monologue.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'The full new content of state.md in markdown format.',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'update_strategy',
    description: 'Write to mind/strategy.md. Call this when your goals, priorities, or current phase change.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'The full new content of strategy.md in markdown format.',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'update_worldview',
    description: 'Write to mind/worldview.md. Call this when your understanding of the world, yourself, or your relationships changes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'The full new content of worldview.md in markdown format.',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'send_telegram',
    description: 'Send a message to a specific Telegram conversation. Use the chat_id from the incoming message you are responding to.',
    input_schema: {
      type: 'object' as const,
      properties: {
        chat_id: {
          type: 'string',
          description: 'The chat ID to send the message to.',
        },
        message: {
          type: 'string',
          description: 'The message text to send.',
        },
        reply_to_message_id: {
          type: 'number',
          description: 'Optional: the message ID to reply to.',
        },
      },
      required: ['chat_id', 'message'],
    },
  },
  {
    name: 'log_thought',
    description: 'Record an internal monologue entry. Use for meta-observations, debugging reasoning, or noting patterns.',
    input_schema: {
      type: 'object' as const,
      properties: {
        thought: {
          type: 'string',
          description: 'The thought to log.',
        },
        category: {
          type: 'string',
          enum: ['reflection', 'observation', 'question', 'meta', 'debug'],
          description: 'Category of the thought. Defaults to reflection.',
        },
      },
      required: ['thought'],
    },
  },
];

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  switch (name) {
    case 'update_state':
      await ctx.stateManager.writeMindFile('state.md', input.content as string);
      return 'state.md updated successfully.';

    case 'update_strategy':
      await ctx.stateManager.writeMindFile('strategy.md', input.content as string);
      return 'strategy.md updated successfully.';

    case 'update_worldview':
      await ctx.stateManager.writeMindFile('worldview.md', input.content as string);
      return 'worldview.md updated successfully.';

    case 'send_telegram': {
      const chatId = input.chat_id as string;
      const message = input.message as string;
      const replyTo = input.reply_to_message_id as number | undefined;

      await ctx.bot.api.sendMessage(chatId, message, {
        reply_parameters: replyTo ? { message_id: replyTo } : undefined,
      });

      // Append to conversation history
      await ctx.conversationManager.appendMessage(
        { platform: 'telegram', chatId },
        {
          role: 'agent',
          text: message,
          timestamp: new Date().toISOString(),
        },
      );

      return `Message sent to chat ${chatId}.`;
    }

    case 'log_thought': {
      const thought = input.thought as string;
      const category = (input.category as string) || 'reflection';
      await ctx.logger.logThought({
        timestamp: new Date().toISOString(),
        tick_id: ctx.tickId,
        thought,
        category,
      });
      return `Thought logged (${category}).`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
