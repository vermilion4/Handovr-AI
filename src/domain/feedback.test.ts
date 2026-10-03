import { describe, expect, it } from 'vitest';
import { fundingProblemFeedback, signedFeedback } from './feedback';

describe('signedFeedback', () => {
  it('tells the signer the other side still has to sign', () => {
    expect(signedFeedback({ signed: 1, completed: 0, otherFirst: 'Tony', viewerRole: 'freelancer' })).toEqual({
      tone: 'success',
      title: 'You signed 1 milestone',
      message: 'Tony has not signed yet. Once Tony signs the same list, the checks are frozen and Tony can fund it.',
    });
    expect(signedFeedback({ signed: 2, completed: 0, otherFirst: 'John', viewerRole: 'client' }).message).toBe(
      'John has not signed yet. Once John signs the same list, the checks are frozen and you can fund it.',
    );
  });

  it('tells the last signer the milestones are now signed by both', () => {
    expect(signedFeedback({ signed: 2, completed: 2, otherFirst: 'John', viewerRole: 'client' })).toEqual({
      tone: 'success',
      title: 'Signed by both of you',
      message: 'These milestones are ready to fund. Fund the first one from the project page.',
    });
    expect(signedFeedback({ signed: 1, completed: 1, otherFirst: 'Tony', viewerRole: 'freelancer' }).message).toBe(
      'Tony can now fund this milestone. It shows on your Projects list once the money is held.',
    );
  });

  it('says which part is done when only some are now signed by both', () => {
    expect(signedFeedback({ signed: 3, completed: 1, otherFirst: 'Tony', viewerRole: 'freelancer' })).toEqual({
      tone: 'success',
      title: 'You signed 3 milestones',
      message: '1 is now signed by both of you. Tony still needs to sign the other 2.',
    });
  });
});

describe('fundingProblemFeedback', () => {
  it('explains each problem, and ignores anything it does not know', () => {
    expect(fundingProblemFeedback('cancelled')).toEqual({
      tone: 'warning',
      title: 'Nothing was held',
      message: 'You left PayPal before approving the hold. Fund again whenever you are ready.',
    });
    expect(fundingProblemFeedback('declined')?.tone).toBe('error');
    expect(fundingProblemFeedback('__proto__')).toBeNull();
    expect(fundingProblemFeedback(undefined)).toBeNull();
  });
});
