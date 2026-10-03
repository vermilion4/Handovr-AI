import { describe, expect, it } from 'vitest';
import { milestoneStatus, summariseProject, type SummaryInput, type SummaryMilestone } from './project-summary';

const m = (
  position: number,
  title: string,
  amountCents: number,
  state: SummaryMilestone['state'],
  criteriaDraft: SummaryMilestone['criteriaDraft'] = 'ready',
): SummaryMilestone => ({ position, title, amountCents, state, criteriaDraft });

const bakery: SummaryMilestone[] = [
  m(1, 'Homepage', 90000, 'released'),
  m(2, 'Contact page', 60000, 'client_review'),
  m(3, 'Online ordering', 120000, 'drafting'),
];

const input = (over: Partial<SummaryInput>): SummaryInput => ({
  role: 'client',
  counterpartName: 'Tomás Rivera',
  finishedAt: null,
  milestones: bakery,
  ...over,
});

describe('summariseProject', () => {
  it('tells the client a milestone is waiting for their review', () => {
    expect(summariseProject(input({}))).toEqual({
      finished: false,
      milestoneLabel: 'Milestone 2 of 3: Contact page',
      status: { icon: 'person', text: 'Waiting for your review', tone: 'attention' },
      segments: [
        { amountCents: 90000, kind: 'released' },
        { amountCents: 60000, kind: 'held' },
        { amountCents: 120000, kind: 'none' },
      ],
      progress: { done: 3, tone: 'held', short: 'Checked', label: 'held and tested, waiting for review' },
      caption: '$600.00 held, $900.00 released of $2,700.00',
      actionLabel: 'Review now',
      needsViewer: true,
    });
  });

  it('words the same project from the freelancer side', () => {
    const summary = summariseProject(input({ role: 'freelancer', counterpartName: 'Maya Chen' }));
    expect(summary.status).toEqual({ icon: 'schedule', text: "Waiting for Maya's review", tone: 'neutral' });
    expect(summary.caption).toBe('$600.00 held for you, $900.00 paid of $2,700.00');
    expect(summary.actionLabel).toBe('Open');
    expect(summary.needsViewer).toBe(false);
  });

  it('shows the AI drafting status with the milestone count', () => {
    const summary = summariseProject(
      input({
        milestones: [
          m(1, 'Landing page', 70000, 'drafting', 'pending'),
          m(2, 'Menu', 70000, 'drafting', 'pending'),
          m(3, 'Booking link', 70000, 'drafting', 'pending'),
        ],
      }),
    );
    expect(summary.milestoneLabel).toBe('3 milestones');
    expect(summary.status).toEqual({ icon: 'smart_toy', text: 'Handovr is drafting the criteria', tone: 'progress' });
    expect(summary.caption).toBe('Nothing held yet of $2,100.00');
    expect(summary.actionLabel).toBe('View progress');
  });

  it('asks either side to sign once the criteria are drafted', () => {
    const milestones = [m(1, 'Login and account pages', 90000, 'drafting'), m(2, 'Order history', 90000, 'drafting')];
    for (const role of ['client', 'freelancer'] as const) {
      const summary = summariseProject(input({ role, milestones }));
      expect(summary.status).toEqual({ icon: 'edit', text: 'Criteria ready for you to sign', tone: 'attention' });
      expect(summary.actionLabel).toBe('Sign criteria');
      expect(summary.milestoneLabel).toBe('Milestone 1 of 2: Login and account pages');
    }
  });

  it('tells the freelancer a funded milestone is ready to submit', () => {
    const summary = summariseProject(
      input({ role: 'freelancer', counterpartName: 'Maya Chen', milestones: [m(1, 'Contact page', 60000, 'funded')] }),
    );
    expect(summary.status).toEqual({ icon: 'upload', text: 'Funded and ready for you to submit', tone: 'attention' });
    expect(summary.actionLabel).toBe('Submit work');
    expect(summary.caption).toBe('$600.00 held for you of $600.00');
  });

  it('shows testing in progress to both sides', () => {
    const summary = summariseProject(input({ milestones: [m(1, 'Enquiry form', 45000, 'verifying'), m(2, 'Menu page', 60000, 'drafting')] }));
    expect(summary.status).toEqual({ icon: 'progress_activity', text: 'Being tested now', tone: 'progress' });
    expect(summary.caption).toBe('$450.00 held of $1,050.00');
  });

  it('summarises a finished project with its finish date', () => {
    const summary = summariseProject(
      input({ finishedAt: new Date('2026-08-12T15:00:00Z'), milestones: [m(1, 'Pre-order page', 40000, 'released')] }),
    );
    expect(summary).toMatchObject({
      finished: true,
      milestoneLabel: '1 milestone',
      status: { icon: 'check_circle', text: 'Finished 12 August', tone: 'done' },
      caption: '$400.00 released',
      actionLabel: 'Open',
    });
  });

  it('treats a project as finished when every milestone has ended, even without a finish date', () => {
    const summary = summariseProject(input({ milestones: [m(1, 'A', 1000, 'released'), m(2, 'B', 1000, 'cancelled')] }));
    expect(summary.finished).toBe(true);
    expect(summary.status.text).toBe('Finished');
  });

  it('does not throw for a project with no milestones', () => {
    const summary = summariseProject(input({ milestones: [] }));
    expect(summary).toMatchObject({
      finished: false,
      milestoneLabel: 'No milestones yet',
      status: { icon: 'edit', text: 'Add a milestone to get started', tone: 'attention' },
      segments: [],
      caption: 'Nothing held yet',
      actionLabel: 'Open',
    });
  });

  it('tells both sides when drafting stopped', () => {
    const summary = summariseProject(input({ milestones: [m(1, 'Landing page', 70000, 'drafting', 'failed')] }));
    expect(summary.status).toEqual({ icon: 'error', text: 'Drafting stopped, open to try again', tone: 'attention' });
    expect(summary.actionLabel).toBe('Open');
  });

  it('treats a milestone being written as still drafting', () => {
    const summary = summariseProject(input({ milestones: [m(1, 'Landing page', 70000, 'drafting', 'drafting')] }));
    expect(summary.status.text).toBe('Handovr is drafting the criteria');
    expect(summary.milestoneLabel).toBe('1 milestone');
  });

  it('tells the person who has signed that it is waiting for the other side', () => {
    const signed = [{ ...m(1, 'Login page', 10000, 'drafting'), contract: 'signed_by_viewer' as const }];
    const summary = summariseProject(input({ role: 'freelancer', counterpartName: 'Tony Client', milestones: signed }));
    expect(summary.status).toEqual({ icon: 'schedule', text: 'You signed. Waiting for Tony to sign', tone: 'neutral' });
    expect(summary.actionLabel).toBe('Open');
    expect(summary.needsViewer).toBe(false);
  });

  it('tells a person when the other side changed the list', () => {
    const changed = [{ ...m(1, 'Login page', 10000, 'drafting'), contract: 'changes_suggested' as const }];
    const summary = summariseProject(input({ milestones: changed }));
    expect(summary.status).toEqual({ icon: 'rate_review', text: 'Tomás suggested changes', tone: 'attention' });
    expect(summary.actionLabel).toBe('Review changes');
  });

  it('shows the progress of the milestone it names, or the last one once the project is finished', () => {
    const finished = summariseProject(input({ milestones: [m(1, 'Homepage', 90000, 'released'), m(2, 'Contact page', 60000, 'released')] }));
    expect(finished.progress?.done).toBe(4);
    const signed = summariseProject(input({ milestones: [m(1, 'Landing page', 15000, 'signed'), m(2, 'Menu', 20000, 'drafting')] }));
    expect(signed.progress).toMatchObject({ done: 1, short: 'Agreed' });
    expect(summariseProject(input({ milestones: [] })).progress).toBeNull();
  });
});

describe('milestoneStatus', () => {
  it('tells the client a signed milestone is theirs to fund, and the freelancer to wait', () => {
    const signed = m(2, 'Contact page', 60000, 'signed');
    expect(milestoneStatus(signed, 'client', 'Tomás')).toEqual({
      icon: 'lock',
      text: 'Ready for you to fund',
      tone: 'attention',
      action: 'Fund milestone',
    });
    expect(milestoneStatus(signed, 'freelancer', 'Maya').text).toBe('Waiting for Maya to fund');
  });

  it('does not call a cancelled or expired milestone finished', () => {
    expect(milestoneStatus(m(1, 'Landing page', 15000, 'cancelled'), 'client', 'John')).toMatchObject({
      icon: 'block',
      text: 'Cancelled. Your hold was returned and nothing was paid',
    });
    expect(milestoneStatus(m(1, 'Landing page', 15000, 'cancelled'), 'freelancer', 'Tony').text).toBe(
      'Cancelled. The hold was returned to Tony',
    );
    expect(milestoneStatus(m(1, 'Landing page', 15000, 'lapsed'), 'client', 'John').text).toBe(
      'Hold expired before the work was released. Nothing was paid',
    );
    expect(milestoneStatus(m(1, 'Landing page', 15000, 'released'), 'client', 'John').text).toBe('Finished');
  });
});
