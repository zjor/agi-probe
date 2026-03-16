import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createStateManager } from './state.js';
import { createLogger } from './logger.js';
import { createEventQueue } from './events.js';
import { createImpressionQueue } from './impressions.js';
import { createCostTracker } from './cost-tracker.js';
import { createConversationManager } from './conversations.js';
import { createFastLane } from './fast-lane.js';
import { createSlowLane } from './slow-lane.js';
import { createHeartbeat } from './heartbeat.js';
import { createTelegramAdapter } from './telegram.js';

async function main(): Promise<void> {
  console.log('[main] AGI Probe v0 starting (dual-lane architecture)...');

  // Load config
  const config = loadConfig();
  console.log(`[main] Runtime dir: ${config.runtimeDir}`);
  console.log(`[main] Heartbeat: ${config.heartbeatIntervalMs}ms`);
  console.log(`[main] Cost limit: $${config.costLimitUsd}`);
  console.log(`[main] Model: ${config.claudeModel}`);

  // Initialize shared infrastructure
  const stateManager = createStateManager(config);
  const logger = createLogger(config);
  const eventQueue = createEventQueue();
  const impressionQueue = createImpressionQueue();
  const costTracker = createCostTracker(config.costLimitUsd);
  const conversationManager = createConversationManager(config);

  // Bootstrap runtime directory
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const seedDir = path.resolve(thisDir, '..', 'seed', 'prompts', 'en');
  const freshBootstrap = await stateManager.bootstrap(seedDir);
  if (freshBootstrap) {
    console.log('[main] Runtime bootstrapped from seed prompts');
    await logger.logRaw({
      timestamp: new Date().toISOString(),
      tick_id: 0,
      direction: 'request',
      data: { event: 'runtime_bootstrapped', seedDir },
    });
  } else {
    console.log('[main] Runtime directory already exists, using existing state');
  }

  // Create Telegram adapter
  const telegram = createTelegramAdapter({
    config,
    conversationManager,
  });

  // Create Fast Lane
  const fastLane = createFastLane({
    config,
    stateManager,
    conversationManager,
    logger,
    costTracker,
    impressionQueue,
    bot: telegram.bot,
  });

  // Create Slow Lane
  const slowLane = createSlowLane({
    config,
    stateManager,
    logger,
    eventQueue,
    conversationManager,
    costTracker,
    impressionQueue,
    bot: telegram.bot,
  });

  // Wire: telegram → fast lane
  telegram.setFastLane(fastLane);

  // Create heartbeat → slow lane
  const heartbeat = createHeartbeat(config, eventQueue, slowLane);

  // Graceful shutdown
  let shuttingDown = false;
  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[main] Received ${signal}, shutting down...`);
    heartbeat.stop();
    telegram.stop();
    console.log(`[main] Final cost: $${costTracker.getCumulativeCost().toFixed(4)} over ${slowLane.getTickCount()} slow ticks`);
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start
  telegram.start();
  heartbeat.start();

  console.log('[main] AGI Probe v0 is alive. Fast lane: chat → immediate. Slow lane: heartbeat → background thinking.');
}

main().catch((err) => {
  console.error('[main] Fatal error:', err);
  process.exit(1);
});
