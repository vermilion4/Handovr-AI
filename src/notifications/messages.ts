export type NotificationKind =
  | 'lists_ready'
  | 'changes_suggested'
  | 'signed'
  | 'funded'
  | 'sent_back'
  | 'review_needed'
  | 'paid'
  | 'split_proposed'
  | 'cancelled';

export function notificationFor(
  kind: NotificationKind,
  input: { to: 'client' | 'freelancer'; otherFirst: string; projectTitle: string; milestoneTitle: string; amountText: string; link: string },
): { subject: string; body: string } {
  const client = input.to === 'client';
  const other = input.otherFirst;
  const m = input.milestoneTitle;
  const lines: Record<NotificationKind, [subject: string, body: string]> = {
    lists_ready: [
      `The checks for ${input.projectTitle} are ready`,
      `Handovr drafted the checks for ${input.projectTitle}. Read them, change anything that is wrong, and sign.`,
    ],
    changes_suggested: [`${other} suggested changes to ${m}`, `${other} changed the checks for ${m}. Accept or decline the changes before signing.`],
    signed: [
      `${m} is signed by both of you`,
      client ? `You and ${other} signed the checks for ${m}. Fund it to let work start.` : `You and ${other} signed the checks for ${m}. Work starts once ${other} funds it.`,
    ],
    funded: [
      client ? `${input.amountText} is held for ${m}` : `${m} is funded`,
      client
        ? `PayPal is holding ${input.amountText} for ${m}. Nothing leaves your account until the work passes.`
        : `${other} funded ${m}. PayPal is holding the money, so you can start work.`,
    ],
    sent_back: [
      `${m} needs changes`,
      client ? `Some checks on ${m} did not pass. ${other} can fix the work and resubmit.` : `Some checks on ${m} did not pass. See what failed, fix it and resubmit.`,
    ],
    review_needed: [
      client ? `${m} is ready for your review` : `${m} is with ${other} for review`,
      client ? `The tester finished ${m}. Some checks are yours to decide.` : `The tester finished ${m}. ${other} decides the remaining checks.`,
    ],
    paid: [
      client ? `${m} is paid` : `You were paid ${input.amountText} for ${m}`,
      client ? `${m} is settled and ${input.amountText} was released to ${other}.` : `${input.amountText} for ${m} was sent to your PayPal account.`,
    ],
    split_proposed: [
      `A split is proposed for ${m}`,
      `All four attempts on ${m} are used. Handovr proposed paying for the checks that passed. Accept or decline it.`,
    ],
    cancelled: [`${m} was cancelled`, client ? `${m} was cancelled and the hold was returned to you. Nothing was paid.` : `${m} was cancelled and nothing was paid.`],
  };
  const [subject, body] = lines[kind];
  return { subject, body: `${body}\n\n${input.link}` };
}
