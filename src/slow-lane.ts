import Anthropic from '@anthropic-ai/sdk';
import type { Config } from './config.js';
import type { StateManager } from './state.js';
import type { Logger } from './logger.js';
import type { EventQueue } from './events.js';
import type { ConversationManager } from './conversations.js';
import type { CostTracker } from './cost-tracker.js';
import type { ImpressionQueue } from './impressions.js';
import type { ToolContext } from './tools/index.js';
import { toolDefinitions, executeTool } from './tools/index.js';
import { assemblePrompt, type TickContext } from './prompt.js';
import { callClaude } from './claude-client.js';
import { computeCost } from './cost-tracker.js';
import type { Bot } from 'grammy';

export interface SlowLane {
  runTick(trigger: string): Promise<void>;
  isRunning(): boolean;
  getTickCount(): number;
}

export function createSlowLane(deps: {
  config: Config;
  stateManager: StateManager;
  logger: Logger;
  eventQueue: EventQueue;
  conversationManager: ConversationManager;
  costTracker: CostTracker;
  impressionQueue: ImpressionQueue;
  bot: Bot;
}): SlowLane {
  const { config, stateManager, logger, eventQueue, conversationManager, costTracker, impressionQueue, bot } = deps;
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  let tickInProgress = false;
  let tickCount = 0;
  let lastTickTime: number | null = null;

  async function runTick(trigger: string): Promise<void> {
    if (tickInProgress) {
      console.log(`[slow-lane] Tick skipped (in progress). Trigger: ${trigger}, queued events: ${eventQueue.size()}`);
      await logger.logTick({
        timestamp: new Date().toISOString(),
        tick_id: tickCount,
        trigger,
        events: [],
        cost_usd: 0,
        cumulative_cost_usd: costTracker.getCumulativeCost(),
        response_summary: 'tick_skipped',
        lane: 'slow',
      });
      return;
    }

    tickInProgress = true;
    const currentTickId = ++tickCount;
    let tickCost = 0;

    try {
      // Cost gate check
      if (!costTracker.isWithinBudget()) {
        console.error(`[slow-lane] Cost limit reached ($${costTracker.getCumulativeCost().toFixed(4)}). Shutting down.`);
        try {
          const channels = await conversationManager.listChannels();
          if (channels.length > 0) {
            const ch = channels[0];
            await bot.api.sendMessage(
              ch.chatId,
              `⚠️ Cost limit reached ($${costTracker.getCumulativeCost().toFixed(2)} / $${config.costLimitUsd}). Shutting down.`,
            );
          }
        } catch { /* best effort */ }
        process.exit(1);
      }

      const timeSinceLastTick = lastTickTime ? Date.now() - lastTickTime : null;
      lastTickTime = Date.now();

      // Drain events and impressions
      const events = eventQueue.drain();
      const impressions = impressionQueue.drain();

      // Assemble prompt
      const tickContext: TickContext = {
        tickId: currentTickId,
        trigger,
        events,
        impressions,
        timeSinceLastTickMs: timeSinceLastTick,
        tickCostUsd: 0,
        cumulativeCostUsd: costTracker.getCumulativeCost(),
        costLimitUsd: config.costLimitUsd,
      };

      const { system, messages } = await assemblePrompt(stateManager, conversationManager, logger, tickContext);

      // Log raw request
      await logger.logRaw({
        timestamp: new Date().toISOString(),
        tick_id: currentTickId,
        direction: 'request',
        data: { lane: 'slow', system, messages },
      });

      // Agentic loop
      let currentMessages: Anthropic.MessageParam[] = [...messages];
      let iteration = 0;

      const toolCtx: ToolContext = {
        config,
        stateManager,
        logger,
        conversationManager,
        bot,
        tickId: currentTickId,
      };

      const allToolCalls: unknown[] = [];

      while (iteration < config.maxToolIterations) {
        // Cost gate before each API call
        if (!costTracker.isWithinBudget()) {
          console.warn(`[slow-lane] Cost limit would be exceeded. Ending tick early.`);
          break;
        }

        iteration++;

        const result = await callClaude({
          client,
          model: config.claudeModel,
          system,
          messages: currentMessages,
          tools: toolDefinitions,
        });

        // Track cost
        const callCostUsd = computeCost(result.inputTokens, result.outputTokens);
        tickCost += callCostUsd;
        // Directly add to cost tracker (no reservation for slow lane — it's serialized by mutex)
        costTracker.settleCost(0, result.inputTokens, result.outputTokens);

        // Log raw response
        await logger.logRaw({
          timestamp: new Date().toISOString(),
          tick_id: currentTickId,
          direction: 'response',
          data: { lane: 'slow', response: result.response },
        });

        // Check if there are tool uses
        const toolUseBlocks = result.response.content.filter(
          (block): block is Anthropic.ContentBlock & { type: 'tool_use' } => block.type === 'tool_use',
        );

        if (toolUseBlocks.length === 0 || result.response.stop_reason === 'end_turn') {
          const textBlocks = result.response.content.filter(
            (block): block is Anthropic.TextBlock => block.type === 'text',
          );
          const responseText = textBlocks.map(b => b.text).join('\n');
          if (responseText) {
            console.log(`[slow-lane] Tick #${currentTickId} final response: ${responseText.slice(0, 200)}`);
          }
          break;
        }

        // Execute tool calls
        const toolResults: Anthropic.MessageParam = {
          role: 'user',
          content: [],
        };

        for (const toolBlock of toolUseBlocks) {
          console.log(`[slow-lane] Tick #${currentTickId} tool call: ${toolBlock.name}`, JSON.stringify(toolBlock.input));
          allToolCalls.push({ name: toolBlock.name, input: toolBlock.input });

          let result: string;
          try {
            result = await executeTool(toolBlock.name, toolBlock.input as Record<string, unknown>, toolCtx);
          } catch (err: any) {
            result = `Error: ${err.message}`;
            console.error(`[slow-lane] Tool error (${toolBlock.name}):`, err.message);
          }

          (toolResults.content as Anthropic.ToolResultBlockParam[]).push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: result,
          });
        }

        currentMessages.push({ role: 'assistant', content: result.response.content });
        currentMessages.push(toolResults);
      }

      if (iteration >= config.maxToolIterations) {
        console.warn(`[slow-lane] Tick #${currentTickId}: forced stop after ${config.maxToolIterations} iterations`);
      }

      // Log tick summary
      await logger.logTick({
        timestamp: new Date().toISOString(),
        tick_id: currentTickId,
        trigger,
        events,
        tool_calls: allToolCalls,
        cost_usd: tickCost,
        cumulative_cost_usd: costTracker.getCumulativeCost(),
        lane: 'slow',
      });

      console.log(`[slow-lane] Tick #${currentTickId} complete. Cost: $${tickCost.toFixed(4)}, Total: $${costTracker.getCumulativeCost().toFixed(4)}`);
    } catch (err: any) {
      console.error(`[slow-lane] Tick #${currentTickId} error:`, err.message);
      await logger.logTick({
        timestamp: new Date().toISOString(),
        tick_id: currentTickId,
        trigger,
        events: [],
        cost_usd: tickCost,
        cumulative_cost_usd: costTracker.getCumulativeCost(),
        response_summary: `error: ${err.message}`,
        lane: 'slow',
      });
    } finally {
      tickInProgress = false;
    }
  }

  return {
    runTick,
    isRunning: () => tickInProgress,
    getTickCount: () => tickCount,
  };
}
