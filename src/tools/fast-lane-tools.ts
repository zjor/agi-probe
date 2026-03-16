import type Anthropic from '@anthropic-ai/sdk';
import { toolDefinitions } from './index.js';

const FAST_LANE_TOOL_NAMES = new Set(['send_telegram', 'log_thought', 'web_search']);

export const fastLaneToolDefinitions: Anthropic.Tool[] = toolDefinitions.filter(
  t => FAST_LANE_TOOL_NAMES.has(t.name),
);

export const FAST_LANE_ALLOWED_TOOLS = FAST_LANE_TOOL_NAMES;
