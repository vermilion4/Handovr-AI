import { writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

const model = process.argv[2] ?? 'claude-sonnet-5-5';
const client = new Anthropic();

const criteriaSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'Short plain-language name of the check.' },
          kind: {
            type: 'string',
            enum: ['machine', 'client'],
            description: 'machine: a browser can test it objectively. client: needs human judgement.',
          },
          how_tested: { type: 'string', description: 'Exactly what will be done to test it.' },
          weight: { type: 'integer', description: 'Importance from 1 (minor) to 5 (essential).' },
        },
        required: ['title', 'kind', 'how_tested', 'weight'],
      },
    },
  },
  required: ['criteria'],
};

const started = Date.now();
const message = await client.messages.create({
  model,
  max_tokens: 2000,
  system:
    'You draft acceptance criteria for freelance web development milestones. ' +
    'Each criterion must be something a client and a freelancer can both agree is met or not met. ' +
    'Mark a criterion "machine" only if a browser visiting the live site can decide it without opinion. ' +
    'Write for a client who is not technical. Give between 3 and 8 criteria.',
  output_config: { format: { type: 'json_schema', schema: criteriaSchema } },
  messages: [
    {
      role: 'user',
      content:
        "Project: Chen's Bakery website\n" +
        'Milestone: Contact page\n' +
        'Amount: $600.00\n' +
        'Brief: A contact page with a form (name, email, message) that emails the bakery, ' +
        'a map of the shop, opening hours, and it should look good on phones and match the rest of the site.',
    },
  ],
});

const block = message.content.find((part) => part.type === 'text');
const drafted = block?.type === 'text' ? JSON.parse(block.text) : null;
console.log('model', message.model, 'stop', message.stop_reason, `${Date.now() - started}ms`);
console.log('usage', JSON.stringify(message.usage));
console.log(JSON.stringify(drafted, null, 2));
writeFileSync(`spikes/out/criteria-${model}.json`, JSON.stringify({ usage: message.usage, drafted }, null, 2));
