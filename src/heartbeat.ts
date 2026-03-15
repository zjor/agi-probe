import type { Config } from './config.js';
import type { EventQueue } from './events.js';
import type { CognitiveCore } from './core.js';

export interface Heartbeat {
  start(): void;
  stop(): void;
}

export function createHeartbeat(config: Config, eventQueue: EventQueue, core: CognitiveCore): Heartbeat {
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    start(): void {
      if (timer) return;
      console.log(`[heartbeat] Starting with interval ${config.heartbeatIntervalMs}ms`);

      timer = setInterval(() => {
        eventQueue.push({
          type: 'heartbeat',
          timestamp: new Date().toISOString(),
          payload: {},
        });
        core.runTick('heartbeat').catch(err => {
          console.error('[heartbeat] Tick error:', err.message);
        });
      }, config.heartbeatIntervalMs);
    },

    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
        console.log('[heartbeat] Stopped');
      }
    },
  };
}
