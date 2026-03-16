import Anthropic from '@anthropic-ai/sdk';
import type { Config } from './config.js';
import type { StateManager } from './state.js';
import type { Logger } from './logger.js';
import type { ConversationManager } from './conversations.js';
import type { CostTracker } from './cost-tracker.js';
import type { ImpressionQueue } from './impressions.js';
import type { ChannelId } from './events.js';
import type { ToolContext } from './tools/index.js';
import { executeTool } from './tools/index.js';
import { fastLaneToolDefinitions, FAST_LANE_ALLOWED_TOOLS } from './tools/fast-lane-tools.js';
import { assembleFastLanePrompt } from './fast-lane-prompt.js';
import { callClaude } from './claude-client.js';
import { computeCost } from './cost-tracker.js';
import type { Bot } from 'grammy';

const MAX_FAST_LANE_ITERATIONS = 3;
const DEFAULT_RESERVATION_USD = 0.02;

export interface FastLane {
  handleMessage(channel: ChannelId, text: string, displayName: string, messageId?: string): Promise<void>;
}

export function createFastLane(deps: {
  config: Config;
  stateManager: StateManager;
  conversationManager: ConversationManager;
  logger: Logger;
  costTracker: CostTracker;
  impressionQueue: ImpressionQueue;
  bot: Bot;
}): FastLane {
  const { config, stateManager, conversationManager, logger, costTracker, impressionQueue, bot } = deps;
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  async function handleMessage(channel: ChannelId, text: string, displayName: string, messageId?: string): Promise<void> {
    // Budget check
    if (!costTracker.isWithinBudget()) {
      console.warn('[fast-lane] Budget exhausted, sending fallback message');
      await bot.api.sendMessage(channel.chatId, '⚠️ I\'m out of budget for now.');
      return;
    }

    // Reserve cost
    if (!costTracker.reserveCost(DEFAULT_RESERVATION_USD)) {
      console.warn('[fast-lane] Could not reserve cost, sending fallback message');
      await bot.api.sendMessage(channel.chatId, '⚠️ I\'m out of budget for now.');
      return;
    }

    let totalReserved = DEFAULT_RESERVATION_USD;
    let agentReplyText = '';

    // Show "typing..." indicator, refresh every 4s (Telegram expires it after ~5s)
    const sendTyping = () => bot.api.sendChatAction(channel.chatId, 'typing').catch(() => {});
    await sendTyping();
    const typingInterval = setInterval(sendTyping, 4000);

    try {
      // Assemble prompt
      const { system, messages } = await assembleFastLanePrompt(stateManager, conversationManager, logger, channel);

      // Log raw request
      await logger.logRaw({
        timestamp: new Date().toISOString(),
        tick_id: 0,
        direction: 'request',
        data: { lane: 'fast', system, messages },
      });

      // Agentic loop
      let currentMessages: Anthropic.MessageParam[] = [...messages];
      let iteration = 0;
      let tickCost = 0;

      const toolCtx: ToolContext = {
        config,
        stateManager,
        logger,
        conversationManager,
        bot,
        tickId: 0,
      };

      const allToolCalls: unknown[] = [];

      while (iteration < MAX_FAST_LANE_ITERATIONS) {
        iteration++;

        const result = await callClaude({
          client,
          model: config.claudeModel,
          system,
          messages: currentMessages,
          tools: fastLaneToolDefinitions,
        });

        // Settle cost for this API call
        const callCostUsd = computeCost(result.inputTokens, result.outputTokens);
        costTracker.settleCost(totalReserved, result.inputTokens, result.outputTokens);
        tickCost += callCostUsd;
        totalReserved = 0; // reservation settled

        // Reserve for next iteration if needed
        if (iteration < MAX_FAST_LANE_ITERATIONS) {
          if (costTracker.reserveCost(DEFAULT_RESERVATION_USD)) {
            totalReserved = DEFAULT_RESERVATION_USD;
          }
        }

        // Log raw response
        await logger.logRaw({
          timestamp: new Date().toISOString(),
          tick_id: 0,
          direction: 'response',
          data: { lane: 'fast', response: result.response },
        });

        // Extract text blocks for the reply
        const textBlocks = result.response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === 'text',
        );
        if (textBlocks.length > 0) {
          agentReplyText += textBlocks.map(b => b.text).join('\n');
        }

        // Check for tool uses
        const toolUseBlocks = result.response.content.filter(
          (block): block is Anthropic.ContentBlock & { type: 'tool_use' } => block.type === 'tool_use',
        );

        if (toolUseBlocks.length === 0 || result.response.stop_reason === 'end_turn') {
          break;
        }

        // Execute tool calls with allowlist check
        const toolResults: Anthropic.MessageParam = {
          role: 'user',
          content: [],
        };

        for (const toolBlock of toolUseBlocks) {
          let toolResult: string;

          if (!FAST_LANE_ALLOWED_TOOLS.has(toolBlock.name)) {
            toolResult = `Error: Tool ${toolBlock.name} is not available in the fast lane`;
            console.warn(`[fast-lane] Rejected tool call: ${toolBlock.name}`);
          } else {
            console.log(`[fast-lane] Tool call: ${toolBlock.name}`, JSON.stringify(toolBlock.input));
            allToolCalls.push({ name: toolBlock.name, input: toolBlock.input });

            try {
              toolResult = await executeTool(toolBlock.name, toolBlock.input as Record<string, unknown>, toolCtx);
            } catch (err: any) {
              toolResult = `Error: ${err.message}`;
              console.error(`[fast-lane] Tool error (${toolBlock.name}):`, err.message);
            }
          }

          (toolResults.content as Anthropic.ToolResultBlockParam[]).push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: toolResult,
          });
        }

        currentMessages.push({ role: 'assistant', content: result.response.content });
        currentMessages.push(toolResults);
      }

      if (iteration >= MAX_FAST_LANE_ITERATIONS) {
        console.warn(`[fast-lane] Forced stop after ${MAX_FAST_LANE_ITERATIONS} iterations`);
      }

      // Log tick summary
      await logger.logTick({
        timestamp: new Date().toISOString(),
        tick_id: 0,
        trigger: 'chat_message',
        events: [],
        tool_calls: allToolCalls,
        cost_usd: tickCost,
        cumulative_cost_usd: costTracker.getCumulativeCost(),
        lane: 'fast',
      });

      // Push impression
      impressionQueue.push({
        timestamp: new Date().toISOString(),
        channel,
        userSaid: text.slice(0, 200),
        agentReplied: agentReplyText.slice(0, 300),
      });

      console.log(`[fast-lane] Handled message from ${displayName} in ${channel.chatId}. Cost: $${tickCost.toFixed(4)}`);
    } catch (err: any) {
      // Release any outstanding reservation
      if (totalReserved > 0) {
        costTracker.releaseReservation(totalReserved);
      }

      console.error(`[fast-lane] Error handling message:`, err.message);

      // Send fallback message
      try {
        await bot.api.sendMessage(channel.chatId, 'I\'m having trouble thinking right now, try again in a moment.');
      } catch { /* best effort */ }

      // Log the error
      await logger.logTick({
        timestamp: new Date().toISOString(),
        tick_id: 0,
        trigger: 'chat_message',
        events: [],
        cost_usd: 0,
        cumulative_cost_usd: costTracker.getCumulativeCost(),
        response_summary: `error: ${err.message}`,
        lane: 'fast',
      });
    } finally {
      clearInterval(typingInterval);
    }
  }

  return { handleMessage };
}
