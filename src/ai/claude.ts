import Anthropic from '@anthropic-ai/sdk';
import type { StructuredModel } from '../criteria/drafter';

export function claudeModel(): StructuredModel {
  // Two attempts must finish well inside the three minutes after which drafting can be restarted.
  const client = new Anthropic({ timeout: 40_000, maxRetries: 0 });
  const model = process.env.HANDOVR_MODEL ?? 'claude-sonnet-5-5';

  return {
    async generate({ system, user, schema }) {
      const message = await client.messages.create({
        model,
        max_tokens: 4000,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { format: { type: 'json_schema', schema } },
      });
      const block = message.content.find((part) => part.type === 'text');
      if (block?.type !== 'text') throw new Error('The model returned no text.');
      return JSON.parse(block.text);
    },
  };
}
