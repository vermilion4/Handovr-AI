import { describe, expect, it } from 'vitest';
import { contractStatus, draftingActive, namesMatch, type VersionSummary } from './contract';

const now = new Date('2026-10-02T12:00:00Z');
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

describe('draftingActive', () => {
  it('is true while a milestone was queued or claimed in the last three minutes', () => {
    expect(draftingActive([{ criteriaDraft: 'pending', criteriaDraftStartedAt: ago(5) }], now)).toBe(true);
    expect(draftingActive([{ criteriaDraft: 'drafting', criteriaDraftStartedAt: ago(170) }], now)).toBe(true);
  });

  it('is false once the work has gone quiet for three minutes', () => {
    expect(draftingActive([{ criteriaDraft: 'drafting', criteriaDraftStartedAt: ago(181) }], now)).toBe(false);
  });

  it('is false for milestones that were never queued, are ready, or stopped', () => {
    expect(
      draftingActive(
        [
          { criteriaDraft: 'pending', criteriaDraftStartedAt: null },
          { criteriaDraft: 'ready', criteriaDraftStartedAt: ago(5) },
          { criteriaDraft: 'failed', criteriaDraftStartedAt: ago(5) },
        ],
        now,
      ),
    ).toBe(false);
  });
});

describe('contractStatus', () => {
  const version = (over: Partial<VersionSummary> = {}): VersionSummary => ({
    authorId: null,
    acknowledged: false,
    signedBy: [],
    ...over,
  });
  const drafting = { state: 'drafting' as const, criteriaDraft: 'ready' as const };

  it('is drafting until the first list exists, and draft_failed when drafting stopped', () => {
    expect(contractStatus({ state: 'drafting', criteriaDraft: 'pending', version: null }, 'me')).toBe('drafting');
    expect(contractStatus({ state: 'drafting', criteriaDraft: 'failed', version: null }, 'me')).toBe('draft_failed');
  });

  it('is ready to sign for a list Handovr drafted', () => {
    expect(contractStatus({ ...drafting, version: version() }, 'me')).toBe('ready_to_sign');
  });

  it('asks the viewer to look at changes the other person made', () => {
    expect(contractStatus({ ...drafting, version: version({ authorId: 'them' }) }, 'me')).toBe('changes_suggested');
  });

  it('is ready to sign once those changes are accepted, and for the person who made them', () => {
    expect(contractStatus({ ...drafting, version: version({ authorId: 'them', acknowledged: true }) }, 'me')).toBe(
      'ready_to_sign',
    );
    expect(contractStatus({ ...drafting, version: version({ authorId: 'me' }) }, 'me')).toBe('ready_to_sign');
  });

  it('shows the viewer has signed while the other person has not', () => {
    expect(contractStatus({ ...drafting, version: version({ signedBy: ['me'] }) }, 'me')).toBe('signed_by_viewer');
    expect(contractStatus({ ...drafting, version: version({ signedBy: ['them'] }) }, 'me')).toBe('ready_to_sign');
  });

  it('is signed for any milestone past drafting', () => {
    expect(contractStatus({ state: 'funded', criteriaDraft: 'ready', version: version() }, 'me')).toBe('signed');
  });
});

describe('namesMatch', () => {
  it('ignores case, spacing and accents', () => {
    expect(namesMatch('  tomas   rivera ', 'Tomás Rivera')).toBe(true);
    expect(namesMatch('MAYA CHEN', 'Maya Chen')).toBe(true);
  });

  it('refuses a different or empty name', () => {
    expect(namesMatch('Maya', 'Maya Chen')).toBe(false);
    expect(namesMatch('', 'Maya Chen')).toBe(false);
    expect(namesMatch('   ', '   ')).toBe(false);
  });
});
