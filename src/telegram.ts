import { Bot } from 'grammy';
import type { Config } from './config.js';
import type { EventQueue } from './events.js';
import type { ConversationManager } from './conversations.js';
import type { CognitiveCore } from './core.js';

export interface TelegramAdapter {
  bot: Bot;
  setCore(core: CognitiveCore): void;
  start(): void;
  stop(): void;
}

export function createTelegramAdapter(deps: {
  config: Config;
  eventQueue: EventQueue;
  conversationManager: ConversationManager;
}): TelegramAdapter {
  const { config, eventQueue, conversationManager } = deps;
  const bot = new Bot(config.telegramBotToken);
  const allowedUsers = new Set(config.allowedTelegramUsers);

  let core: CognitiveCore | null = null;

  bot.on('message:text', async (ctx) => {
    const userId = String(ctx.from.id);
    const chatId = String(ctx.chat.id);

    // User allowlist check
    if (allowedUsers.size > 0 && !allowedUsers.has(userId)) {
      console.log(`[telegram] Rejected message from unknown user ${userId}`);
      return;
    }

    const text = ctx.message.text;
    const displayName = ctx.from.first_name || ctx.from.username || userId;
    const messageId = String(ctx.message.message_id);

    console.log(`[telegram] Message from ${displayName} (${userId}) in chat ${chatId}: ${text.slice(0, 100)}`);

    const channel = { platform: 'telegram' as const, chatId };

    // Append to conversation history
    await conversationManager.appendMessage(
      channel,
      {
        role: 'user',
        text,
        timestamp: new Date().toISOString(),
        messageId,
      },
      displayName,
    );

    // Push event
    eventQueue.push({
      type: 'chat_message',
      timestamp: new Date().toISOString(),
      payload: {
        text,
        userId,
        displayName,
        messageId,
      },
      channel,
    });

    // Trigger a tick
    if (core) {
      core.runTick('chat_message').catch(err => {
        console.error('[telegram] Tick error:', err.message);
      });
    }
  });

  return {
    bot,
    setCore(c: CognitiveCore): void {
      core = c;
    },
    start(): void {
      console.log('[telegram] Starting bot...');
      bot.start({
        onStart: () => console.log('[telegram] Bot is running'),
      });
    },
    stop(): void {
      console.log('[telegram] Stopping bot...');
      bot.stop();
    },
  };
}
