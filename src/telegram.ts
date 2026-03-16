import { Bot } from 'grammy';
import type { Config } from './config.js';
import type { ConversationManager } from './conversations.js';
import type { FastLane } from './fast-lane.js';

export interface TelegramAdapter {
  bot: Bot;
  setFastLane(lane: FastLane): void;
  start(): void;
  stop(): void;
}

export function createTelegramAdapter(deps: {
  config: Config;
  conversationManager: ConversationManager;
}): TelegramAdapter {
  const { config, conversationManager } = deps;
  const bot = new Bot(config.telegramBotToken);
  const allowedUsers = new Set(config.allowedTelegramUsers);

  let fastLane: FastLane | null = null;

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

    // Route to fast lane
    if (fastLane) {
      fastLane.handleMessage(channel, text, displayName, messageId).catch(err => {
        console.error('[telegram] Fast lane error:', err.message);
      });
    }
  });

  return {
    bot,
    setFastLane(lane: FastLane): void {
      fastLane = lane;
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
