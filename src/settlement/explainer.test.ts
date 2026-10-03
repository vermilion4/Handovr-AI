import { describe, expect, it } from 'vitest';
import type { StructuredModel } from '../criteria/drafter';
import { explainSettlement } from './explainer';

const input = {
  title: 'Contact page',
  amountCents: 60000,
  freelancerCents: 48000,
  clientCents: 12000,
  checks: [
    { description: 'The form sends a message', shareCents: 15000, outcome: 'approved' as const, summary: 'Sent and confirmed.' },
    { description: 'The page loads in under 3 seconds', shareCents: 10000, outcome: 'failed' as const, summary: 'Loads took 5.6, 5.8 and 6.1 seconds.' },
  ],
};

const answering = (...answers: unknown[]): StructuredModel & { prompts: string[] } => {
  const prompts: string[] = [];
  return {
    prompts,
    async generate({ user }) {
      prompts.push(user);
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
};

describe('explainSettlement', () => {
  it("returns the model's explanation, having shown it the amounts and the evidence", async () => {
    const model = answering({
      explanation: 'The form worked, but the page loaded in about six seconds against the three agreed. That check carried $100.00, so Tomás receives $480.00 and $120.00 returns to Maya.',
    });
    expect(await explainSettlement(model, input)).toContain('$480.00');
    expect(model.prompts[0]).toContain('$480.00 to the freelancer');
    expect(model.prompts[0]).toContain('Loads took 5.6, 5.8 and 6.1 seconds.');
  });

  it('refuses an explanation that does not state the real amounts', async () => {
    const wrong = { explanation: 'Most checks passed, so the freelancer receives $550.00 and $50.00 returns to the client.' };
    await expect(explainSettlement(answering(wrong, wrong), input)).rejects.toThrow();
  });

  it('asks once more after an unusable answer, then gives up', async () => {
    expect(
      await explainSettlement(answering({ explanation: '' }, { explanation: 'A clear account of what passed: $480.00 goes to the freelancer and $120.00 goes back.' }), input),
    ).toContain('clear account');
    await expect(explainSettlement(answering(new Error('overloaded'), { nope: true }), input)).rejects.toThrow();
  });
});
