import { describe, expect, it } from 'vitest';
import { checkNewProject, type NewProjectFields } from './new-project';

const valid: NewProjectFields = {
  title: "Chen's Bakery website",
  clientEmail: 'maya@chensbakery.example',
  freelancerEmail: 'tomas@riverastudio.example',
  milestones: [
    { title: 'Contact page', brief: 'A contact page with a form that emails the bakery.', amountCents: 60000 },
  ],
};
const withMilestone = (over: Partial<NewProjectFields['milestones'][number]>): NewProjectFields => ({
  ...valid,
  milestones: [{ ...valid.milestones[0], ...over }],
});

describe('checkNewProject', () => {
  it('accepts a complete project', () => {
    expect(checkNewProject(valid)).toBeNull();
  });

  it('needs a project name', () => {
    expect(checkNewProject({ ...valid, title: ' ' })).toBe('Give the project a name.');
  });

  it('needs a real-looking email for the freelancer', () => {
    expect(checkNewProject({ ...valid, freelancerEmail: 'tomas' })).toBe(
      "Enter the freelancer's PayPal email address.",
    );
  });

  it('refuses the client inviting themselves, whatever the capitals', () => {
    expect(checkNewProject({ ...valid, freelancerEmail: 'Maya@ChensBakery.example' })).toBe(
      'The freelancer must be someone other than you.',
    );
  });

  it('needs between one and ten milestones', () => {
    expect(checkNewProject({ ...valid, milestones: [] })).toBe('Add at least one milestone.');
    const eleven = Array.from({ length: 11 }, () => valid.milestones[0]);
    expect(checkNewProject({ ...valid, milestones: eleven })).toBe('A project can have at most 10 milestones.');
  });

  it('names the milestone that is incomplete', () => {
    expect(checkNewProject(withMilestone({ title: '' }))).toBe('Milestone 1 needs a name.');
    expect(checkNewProject(withMilestone({ brief: 'Too short' }))).toBe(
      'Milestone 1: describe what should be delivered in at least a sentence.',
    );
    expect(checkNewProject(withMilestone({ amountCents: null }))).toBe(
      'Milestone 1 needs an amount, such as 600.00.',
    );
    expect(checkNewProject(withMilestone({ amountCents: 50 }))).toBe(
      'Milestone 1: the amount must be between $1.00 and $50,000.00.',
    );
  });
});
