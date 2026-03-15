import Anthropic from '@anthropic-ai/sdk';
import type { Config } from './config.js';
import type { StateManager } from './state.js';
import type { Logger } from './logger.js';
import type { EventQueue, AgentEvent } from './events.js';
import type { ConversationManager } from './conversations.js';
import type { ToolContext } from './tools/index.js';
import { toolDefinitions, executeTool } from './tools/index.js';
import { assemblePrompt, type TickContext } from './prompt.js';
import type { Bot } from 'grammy';

// Claude pricing per million tokens (sonnet 4)
const INPUT_COST_PER_M = 3.0;
const OUTPUT_COST_PER_M = 15.0;

function computeCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_COST_PER_M + (outputTokens / 1_000_000) * OUTPUT_COST_PER_M;
}

export interface CognitiveCore {
  runTick(trigger: string): Promise<void>;
  getCumulativeCost(): number;
  getTickCount(): number;
  isRunning(): boolean;
}

export function createCognitiveCore(deps: {
  config: Config;
  stateManager: StateManager;
  logger: Logger;
  eventQueue: EventQueue;
  conversationManager: ConversationManager;
  bot: Bot;
}): CognitiveCore {
  const { config, stateManager, logger, eventQueue, conversationManager, bot } = deps;
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  let tickInProgress = false;
  let tickCount = 0;
  let cumulativeCostUsd = 0;
  let lastTickTime: number | null = null;

  async function runTick(trigger: string): Promise<void> {
    if (tickInProgress) {
      console.log(`[core] Tick skipped (in progress). Trigger: ${trigger}, queued events: ${eventQueue.size()}`);
      await logger.logTick({
        timestamp: new Date().toISOString(),
        tick_id: tickCount,
        trigger,
        events: [],
        cost_usd: 0,
        cumulative_cost_usd: cumulativeCostUsd,
        response_summary: 'tick_skipped',
      });
      return;
    }

    tickInProgress = true;
    const currentTickId = ++tickCount;
    let tickCost = 0;

    try {
      // Cost gate check
      if (cumulativeCostUsd >= config.costLimitUsd) {
        console.error(`[core] Cost limit reached ($${cumulativeCostUsd.toFixed(4)} >= $${config.costLimitUsd}). Shutting down.`);
        try {
          // Try to alert via first known chat
          const channels = await conversationManager.listChannels();
          if (channels.length > 0) {
            const ch = channels[0];
            await bot.api.sendMessage(
              ch.chatId,
              `⚠️ Cost limit reached ($${cumulativeCostUsd.toFixed(2)} / $${config.costLimitUsd}). Shutting down.`,
            );
          }
        } catch { /* best effort */ }
        process.exit(1);
      }

      const timeSinceLastTick = lastTickTime ? Date.now() - lastTickTime : null;
      lastTickTime = Date.now();

      // Drain events
      const events = eventQueue.drain();

      // Assemble prompt
      const tickContext: TickContext = {
        tickId: currentTickId,
        trigger,
        events,
        timeSinceLastTickMs: timeSinceLastTick,
        tickCostUsd: 0,
        cumulativeCostUsd,
        costLimitUsd: config.costLimitUsd,
      };

      const { system, messages } = await assemblePrompt(stateManager, conversationManager, logger, tickContext);

      // Log raw request
      await logger.logRaw({
        timestamp: new Date().toISOString(),
        tick_id: currentTickId,
        direction: 'request',
        data: { system, messages },
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
        if (cumulativeCostUsd + tickCost >= config.costLimitUsd) {
          console.warn(`[core] Cost limit would be exceeded. Ending tick early.`);
          break;
        }

        iteration++;

        const response = await client.messages.create({
          model: config.claudeModel,
          max_tokens: 4096,
          system,
          tools: toolDefinitions,
          messages: currentMessages,
        });

        // Track cost
        const callCost = computeCost(
          response.usage.input_tokens,
          response.usage.output_tokens,
        );
        tickCost += callCost;

        // Log raw response
        await logger.logRaw({
          timestamp: new Date().toISOString(),
          tick_id: currentTickId,
          direction: 'response',
          data: response,
        });

        // Check if there are tool uses
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ContentBlock & { type: 'tool_use' } => block.type === 'tool_use',
        );

        if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
          // Final response — extract text
          const textBlocks = response.content.filter(
            (block): block is Anthropic.TextBlock => block.type === 'text',
          );
          const responseText = textBlocks.map(b => b.text).join('\n');
          if (responseText) {
            console.log(`[core] Tick #${currentTickId} final response: ${responseText.slice(0, 200)}`);
          }
          break;
        }

        // Execute tool calls
        const toolResults: Anthropic.MessageParam = {
          role: 'user',
          content: [],
        };

        for (const toolBlock of toolUseBlocks) {
          console.log(`[core] Tick #${currentTickId} tool call: ${toolBlock.name}`, JSON.stringify(toolBlock.input));
          allToolCalls.push({ name: toolBlock.name, input: toolBlock.input });

          let result: string;
          try {
            result = await executeTool(toolBlock.name, toolBlock.input as Record<string, unknown>, toolCtx);
          } catch (err: any) {
            result = `Error: ${err.message}`;
            console.error(`[core] Tool error (${toolBlock.name}):`, err.message);
          }

          (toolResults.content as Anthropic.ToolResultBlockParam[]).push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: result,
          });
        }

        // Append assistant message and tool results
        currentMessages.push({ role: 'assistant', content: response.content });
        currentMessages.push(toolResults);
      }

      if (iteration >= config.maxToolIterations) {
        console.warn(`[core] Tick #${currentTickId}: forced stop after ${config.maxToolIterations} iterations`);
      }

      // Update cumulative cost
      cumulativeCostUsd += tickCost;

      // Log tick summary
      await logger.logTick({
        timestamp: new Date().toISOString(),
        tick_id: currentTickId,
        trigger,
        events,
        tool_calls: allToolCalls,
        cost_usd: tickCost,
        cumulative_cost_usd: cumulativeCostUsd,
      });

      console.log(`[core] Tick #${currentTickId} complete. Cost: $${tickCost.toFixed(4)}, Total: $${cumulativeCostUsd.toFixed(4)}`);
    } catch (err: any) {
      console.error(`[core] Tick #${currentTickId} error:`, err.message);
      await logger.logTick({
        timestamp: new Date().toISOString(),
        tick_id: currentTickId,
        trigger,
        events: [],
        cost_usd: tickCost,
        cumulative_cost_usd: cumulativeCostUsd,
        response_summary: `error: ${err.message}`,
      });
    } finally {
      tickInProgress = false;
    }

    // If events accumulated while this tick was running, process them immediately
    if (eventQueue.size() > 0) {
      console.log(`[core] ${eventQueue.size()} events queued during tick, running follow-up tick`);
      await runTick('queued_events');
    }
  }

  return {
    runTick,
    getCumulativeCost: () => cumulativeCostUsd,
    getTickCount: () => tickCount,
    isRunning: () => tickInProgress,
  };
}
