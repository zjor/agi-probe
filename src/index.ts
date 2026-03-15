import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createStateManager } from './state.js';
import { createLogger } from './logger.js';
import { createEventQueue } from './events.js';
import { createConversationManager } from './conversations.js';
import { createCognitiveCore } from './core.js';
import { createHeartbeat } from './heartbeat.js';
import { createTelegramAdapter } from './telegram.js';

async function main(): Promise<void> {
  console.log('[main] AGI Probe v0 starting...');

  // Load config
  const config = loadConfig();
  console.log(`[main] Runtime dir: ${config.runtimeDir}`);
  console.log(`[main] Heartbeat: ${config.heartbeatIntervalMs}ms`);
  console.log(`[main] Cost limit: $${config.costLimitUsd}`);
  console.log(`[main] Model: ${config.claudeModel}`);

  // Initialize modules
  const stateManager = createStateManager(config);
  const logger = createLogger(config);
  const eventQueue = createEventQueue();
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

  // Create Telegram adapter (creates the bot instance)
  const telegram = createTelegramAdapter({
    config,
    eventQueue,
    conversationManager,
  });

  // Create cognitive core with bot reference
  const core = createCognitiveCore({
    config,
    stateManager,
    logger,
    eventQueue,
    conversationManager,
    bot: telegram.bot,
  });

  // Wire core into telegram adapter (resolves circular dep)
  telegram.setCore(core);

  // Create heartbeat
  const heartbeat = createHeartbeat(config, eventQueue, core);

  // Graceful shutdown
  let shuttingDown = false;
  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[main] Received ${signal}, shutting down...`);
    heartbeat.stop();
    telegram.stop();
    console.log(`[main] Final cost: $${core.getCumulativeCost().toFixed(4)} over ${core.getTickCount()} ticks`);
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start
  telegram.start();
  heartbeat.start();

  console.log('[main] AGI Probe v0 is alive.');
}

main().catch((err) => {
  console.error('[main] Fatal error:', err);
  process.exit(1);
});
