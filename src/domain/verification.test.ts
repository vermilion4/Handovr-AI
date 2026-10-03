import { describe, expect, it } from 'vitest';
import {
  allMachineUnclear,
  checkDisplay,
  checkUrl,
  combineRuns,
  itemsForClient,
  reviewOutcome,
  reviewWindowSeconds,
  verificationOutcome,
  type CheckOutcome,
} from './verification';

describe('combineRuns', () => {
  it('keeps a pass or an unclear from the first run', () => {
    expect(combineRuns('pass', null)).toBe('pass');
    expect(combineRuns('unclear', null)).toBe('unclear');
  });

  it('fails only when the second run fails too', () => {
    expect(combineRuns('fail', 'fail')).toBe('fail');
    expect(combineRuns('fail', 'pass')).toBe('unclear');
    expect(combineRuns('fail', 'unclear')).toBe('unclear');
  });

  it('does not fail a check whose second run never happened', () => {
    expect(combineRuns('fail', null)).toBe('unclear');
  });
});

const check = (criterionId: string, kind: 'machine' | 'human', verdict: CheckOutcome['verdict']): CheckOutcome => ({
  criterionId,
  kind,
  verdict,
});

describe('verificationOutcome and itemsForClient', () => {
  it('fails when any automatic check failed', () => {
    expect(verificationOutcome([check('a', 'machine', 'pass'), check('b', 'machine', 'fail'), check('c', 'human', null)])).toBe('failed');
  });

  it('passes when nothing failed, leaving the human and unclear checks to the client', () => {
    const checks = [check('a', 'machine', 'pass'), check('b', 'machine', 'unclear'), check('c', 'human', null), check('d', 'machine', null)];
    expect(verificationOutcome(checks)).toBe('passed');
    expect(itemsForClient(checks)).toEqual(['b', 'c', 'd']);
  });

  it('leaves nothing to the client when every check is automatic and passed', () => {
    expect(itemsForClient([check('a', 'machine', 'pass'), check('b', 'machine', 'pass')])).toEqual([]);
  });
});

describe('reviewOutcome', () => {
  it('is incomplete until every open check has a decision', () => {
    expect(reviewOutcome(['a', 'b'], { a: 'approved' })).toBe('incomplete');
  });

  it('approves when everything is approved, ignoring decisions on other checks', () => {
    expect(reviewOutcome(['a', 'b'], { a: 'approved', b: 'approved', z: 'rejected' })).toBe('approved');
  });

  it('rejects when any open check is rejected', () => {
    expect(reviewOutcome(['a', 'b'], { a: 'approved', b: 'rejected' })).toBe('rejected');
  });

  it('approves an empty review', () => {
    expect(reviewOutcome([], {})).toBe('approved');
  });
});

describe('reviewWindowSeconds', () => {
  it('reads a positive whole number of seconds and falls back to five days', () => {
    expect(reviewWindowSeconds('120')).toBe(120);
    for (const value of [undefined, '', 'abc', '0', '-5', '1.5']) expect(reviewWindowSeconds(value)).toBe(432000);
  });
});

describe('checkUrl', () => {
  it('accepts a public web address and tidies it', () => {
    expect(checkUrl(' https://chens-bakery.example/contact ')).toEqual({ ok: true, url: 'https://chens-bakery.example/contact' });
    expect(checkUrl('http://raw.githack.com/a/b/c/index.html')).toMatchObject({ ok: true });
  });

  it('refuses something that is not a web address', () => {
    for (const text of ['', 'chensbakery', 'ftp://files.example/x', 'javascript:alert(1)']) {
      expect(checkUrl(text)).toEqual({ ok: false, reason: 'Enter the full address of the live site, starting with https://.' });
    }
  });

  it('refuses addresses the tester cannot reach from the internet', () => {
    for (const text of [
      'http://localhost:3000',
      'http://app.localhost',
      'http://127.0.0.1:3000',
      'http://10.0.0.5',
      'http://172.20.1.1',
      'http://192.168.1.10',
      'http://169.254.169.254/latest',
      'http://[::1]:3000',
      'http://printer.local',
      'http://intranet',
      'http://localhost.',
      'http://metadata.google.internal.',
      'http://100.64.0.1',
    ]) {
      expect(checkUrl(text)).toEqual({
        ok: false,
        reason: 'Use an address the tester can reach on the internet, not one on your own computer or network.',
      });
    }
  });

  it('refuses an address with a password in it', () => {
    expect(checkUrl('https://user:secret@site.example')).toEqual({
      ok: false,
      reason: 'Remove the username and password from the address.',
    });
  });
});

describe('checkDisplay', () => {
  const base = { kind: 'machine' as const, aiVerdict: null, clientDecision: null, isCurrent: false, running: false, settled: false };

  it('shows an undecided check as not reviewed once a split is proposed', () => {
    const settled = { ...base, settled: true };
    expect(checkDisplay({ ...settled, kind: 'human' })).toBe('not_reviewed');
    expect(checkDisplay({ ...settled, aiVerdict: 'unclear' })).toBe('not_reviewed');
    expect(checkDisplay({ ...settled, aiVerdict: 'fail' })).toBe('failed');
    expect(checkDisplay({ ...settled, kind: 'human', clientDecision: 'approved' })).toBe('approved');
  });

  it("shows the client's decision over the tester's verdict", () => {
    expect(checkDisplay({ ...base, aiVerdict: 'unclear', clientDecision: 'approved' })).toBe('approved');
    expect(checkDisplay({ ...base, kind: 'human', clientDecision: 'rejected' })).toBe('changes_requested');
  });

  it("shows the tester's verdict", () => {
    expect(checkDisplay({ ...base, aiVerdict: 'pass' })).toBe('passed');
    expect(checkDisplay({ ...base, aiVerdict: 'fail' })).toBe('failed');
    expect(checkDisplay({ ...base, aiVerdict: 'unclear' })).toBe('unclear');
  });

  it('shows which automatic check is being tested and which wait their turn', () => {
    expect(checkDisplay({ ...base, running: true, isCurrent: true })).toBe('testing');
    expect(checkDisplay({ ...base, running: true })).toBe('queued');
    expect(checkDisplay(base)).toBe('not_started');
  });

  it("shows a human check as the client's call", () => {
    expect(checkDisplay({ ...base, kind: 'human', running: true })).toBe('yours');
  });
});

describe('allMachineUnclear', () => {
  it('is true only when there are automatic checks and the tester decided none of them', () => {
    expect(allMachineUnclear([check('a', 'machine', 'unclear'), check('b', 'machine', 'unclear'), check('c', 'human', null)])).toBe(true);
    expect(allMachineUnclear([check('a', 'machine', 'unclear'), check('b', 'machine', 'pass')])).toBe(false);
    expect(allMachineUnclear([check('c', 'human', null)])).toBe(false);
  });
});
