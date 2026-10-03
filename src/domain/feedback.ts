export interface Feedback {
  tone: 'success' | 'warning' | 'error';
  title: string;
  message: string;
}

const milestonesLabel = (count: number) => (count === 1 ? '1 milestone' : `${count} milestones`);

export function signedFeedback(input: {
  signed: number;
  completed: number;
  otherFirst: string;
  viewerRole: 'client' | 'freelancer';
}): Feedback {
  const { signed, completed, otherFirst: other, viewerRole } = input;
  const client = viewerRole === 'client';

  if (completed === signed) {
    return {
      tone: 'success',
      title: 'Signed by both of you',
      message: client
        ? `${signed === 1 ? 'This milestone is' : 'These milestones are'} ready to fund. Fund the first one from the project page.`
        : `${other} can now fund ${signed === 1 ? 'this milestone' : 'these milestones'}. It shows on your Projects list once the money is held.`,
    };
  }
  if (completed === 0) {
    return {
      tone: 'success',
      title: `You signed ${milestonesLabel(signed)}`,
      message: `${other} has not signed yet. Once ${other} signs the same list, the checks are frozen and ${client ? 'you' : other} can fund it.`,
    };
  }
  return {
    tone: 'success',
    title: `You signed ${milestonesLabel(signed)}`,
    message: `${completed} ${completed === 1 ? 'is' : 'are'} now signed by both of you. ${other} still needs to sign the other ${signed - completed}.`,
  };
}

export function answeredFeedback(accepted: boolean, otherFirst: string): Feedback {
  return accepted
    ? { tone: 'success', title: 'Changes accepted', message: 'The list is ready for you to sign.' }
    : {
        tone: 'success',
        title: 'Changes declined',
        message: `The list is back as it was before ${otherFirst}'s changes, and ${otherFirst} has been asked to look at it again.`,
      };
}

export function savedFeedback(otherFirst: string): Feedback {
  return {
    tone: 'success',
    title: `Changes sent to ${otherFirst}`,
    message: `${otherFirst} sees them marked on the list. Signatures on this milestone were cleared until you both sign the new list.`,
  };
}

const FUNDING_PROBLEMS: Record<string, Feedback> = {
  cancelled: {
    tone: 'warning',
    title: 'Nothing was held',
    message: 'You left PayPal before approving the hold. Fund again whenever you are ready.',
  },
  declined: {
    tone: 'error',
    title: 'PayPal did not place the hold',
    message: 'Nothing was taken from your account. Try again, or use a different payment method in PayPal.',
  },
  unreachable: {
    tone: 'error',
    title: 'PayPal could not be reached',
    message: 'The hold was not confirmed. Fund again; you will not be charged twice.',
  },
  closed: {
    tone: 'warning',
    title: 'That payment attempt had ended',
    message: 'Fund again to start a new one.',
  },
};

export function fundingProblemFeedback(problem: string | undefined): Feedback | null {
  return problem && Object.hasOwn(FUNDING_PROBLEMS, problem) ? FUNDING_PROBLEMS[problem] : null;
}
