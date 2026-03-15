import type Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../config.js';
import type { StateManager } from '../state.js';
import type { Logger } from '../logger.js';
import type { ConversationManager } from '../conversations.js';
import type { Bot } from 'grammy';

export interface ToolContext {
  config: Config;
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
  {
    name: 'web_search',
    description: 'Search the web for information. Use this to learn about topics that interest you, answer questions, or explore the world. Results include page titles, URLs, and content snippets.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'The search query. Be specific and substantive.',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (1-10). Defaults to 5.',
        },
      },
      required: ['query'],
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

      try {
        await ctx.bot.api.sendMessage(chatId, message, {
          reply_parameters: replyTo ? { message_id: replyTo } : undefined,
        });
      } catch (err: any) {
        if (replyTo && err.message?.includes('message to be replied not found')) {
          console.warn(`[send_telegram] Reply-to message ${replyTo} not found, sending without reply`);
          await ctx.bot.api.sendMessage(chatId, message);
        } else {
          throw err;
        }
      }

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

    case 'web_search': {
      const query = input.query as string;
      const maxResults = Math.min(Math.max((input.max_results as number) || 5, 1), 10);

      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: ctx.config.tavilyApiKey,
          query,
          max_results: maxResults,
          include_answer: true,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        return `Search failed (${response.status}): ${text}`;
      }

      const data = await response.json() as {
        answer?: string;
        results: { title: string; url: string; content: string }[];
      };

      const lines: string[] = [];
      if (data.answer) {
        lines.push(`**Summary**: ${data.answer}\n`);
      }
      for (const r of data.results) {
        lines.push(`### ${r.title}\n${r.url}\n${r.content}\n`);
      }

      return lines.join('\n') || 'No results found.';
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
