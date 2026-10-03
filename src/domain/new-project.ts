import { formatMoney } from './money';

export interface NewProjectFields {
  title: string;
  clientEmail: string;
  freelancerEmail: string;
  milestones: Array<{ title: string; brief: string; amountCents: number | null }>;
}

export const MAX_MILESTONES = 10;
const MAX_TITLE = 80;
const MIN_BRIEF = 20;
const MAX_BRIEF = 2000;
const MIN_AMOUNT_CENTS = 100;
const MAX_AMOUNT_CENTS = 5_000_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkNewProject(fields: NewProjectFields): string | null {
  const title = fields.title.trim();
  if (title === '') return 'Give the project a name.';
  if (title.length > MAX_TITLE) return `Keep the project name under ${MAX_TITLE} characters.`;

  const email = fields.freelancerEmail.trim().toLowerCase();
  if (!EMAIL.test(email)) return "Enter the freelancer's PayPal email address.";
  if (email === fields.clientEmail.trim().toLowerCase()) return 'The freelancer must be someone other than you.';

  if (fields.milestones.length === 0) return 'Add at least one milestone.';
  if (fields.milestones.length > MAX_MILESTONES) return `A project can have at most ${MAX_MILESTONES} milestones.`;

  for (const [index, milestone] of fields.milestones.entries()) {
    const label = `Milestone ${index + 1}`;
    const name = milestone.title.trim();
    const brief = milestone.brief.trim();
    if (name === '') return `${label} needs a name.`;
    if (name.length > MAX_TITLE) return `${label}: keep the name under ${MAX_TITLE} characters.`;
    if (brief.length < MIN_BRIEF) return `${label}: describe what should be delivered in at least a sentence.`;
    if (brief.length > MAX_BRIEF) return `${label}: keep the description under ${MAX_BRIEF} characters.`;
    if (milestone.amountCents === null) return `${label} needs an amount, such as 600.00.`;
    if (milestone.amountCents < MIN_AMOUNT_CENTS || milestone.amountCents > MAX_AMOUNT_CENTS) {
      return `${label}: the amount must be between ${formatMoney(MIN_AMOUNT_CENTS)} and ${formatMoney(MAX_AMOUNT_CENTS)}.`;
    }
  }
  return null;
}
