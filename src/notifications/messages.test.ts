import { describe, expect, it } from 'vitest';
import { notificationFor, type NotificationKind } from './messages';

const input = {
  otherFirst: 'Tomás',
  projectTitle: "Chen's Bakery website",
  milestoneTitle: 'Contact page',
  amountText: '$600.00',
  link: 'https://handovr.example/m/1',
};

describe('notificationFor', () => {
  it('writes a subject and a body ending with the link for every moment', () => {
    const kinds: NotificationKind[] = ['lists_ready', 'changes_suggested', 'signed', 'funded', 'sent_back', 'review_needed', 'paid', 'split_proposed', 'cancelled'];
    for (const kind of kinds) {
      for (const to of ['client', 'freelancer'] as const) {
        const message = notificationFor(kind, { ...input, to });
        expect(message.subject.length).toBeGreaterThan(5);
        expect(message.subject.length).toBeLessThan(90);
        expect(message.body.endsWith(input.link)).toBe(true);
      }
    }
  });

  it('speaks to each side about what is theirs to do', () => {
    expect(notificationFor('review_needed', { ...input, to: 'client' }).subject).toBe('Contact page is ready for your review');
    expect(notificationFor('paid', { ...input, to: 'freelancer', otherFirst: 'Maya' }).subject).toBe('You were paid $600.00 for Contact page');
    expect(notificationFor('funded', { ...input, to: 'freelancer', otherFirst: 'Maya' }).body).toContain('Maya funded Contact page');
  });
});
