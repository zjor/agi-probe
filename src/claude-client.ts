import Anthropic from '@anthropic-ai/sdk';

export interface ClaudeCallResult {
  response: Anthropic.Message;
  inputTokens: number;
  outputTokens: number;
}

export async function callClaude(params: {
  client: Anthropic;
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  maxTokens?: number;
}): Promise<ClaudeCallResult> {
  const response = await params.client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens ?? 4096,
    system: params.system,
    tools: params.tools,
    messages: params.messages,
  });

  return {
    response,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
