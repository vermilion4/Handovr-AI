export type AiVerdict = 'pass' | 'fail' | 'unclear';
export type ClientDecision = 'approved' | 'rejected';

/** A failed check is run twice; only two failures make a fail. */
export function combineRuns(first: AiVerdict, second: AiVerdict | null): AiVerdict {
  if (first !== 'fail') return first;
  return second === 'fail' ? 'fail' : 'unclear';
}

export interface CheckOutcome {
  criterionId: string;
  kind: 'machine' | 'human';
  /** The tester's verdict, or null for a check it did not decide. */
  verdict: AiVerdict | null;
}

export function verificationOutcome(checks: CheckOutcome[]): 'passed' | 'failed' {
  return checks.some((check) => check.kind === 'machine' && check.verdict === 'fail') ? 'failed' : 'passed';
}

/** True when the tester decided none of the automatic checks, so the run proved nothing. */
export function allMachineUnclear(checks: CheckOutcome[]): boolean {
  const machine = checks.filter((check) => check.kind === 'machine');
  return machine.length > 0 && machine.every((check) => check.verdict === 'unclear');
}

export function itemsForClient(checks: CheckOutcome[]): string[] {
  return checks.filter((check) => check.kind === 'human' || check.verdict !== 'pass').map((check) => check.criterionId);
}

export function reviewOutcome(
  items: string[],
  decisions: Record<string, ClientDecision>,
): 'incomplete' | 'approved' | 'rejected' {
  if (items.some((id) => !Object.hasOwn(decisions, id))) return 'incomplete';
  return items.some((id) => decisions[id] === 'rejected') ? 'rejected' : 'approved';
}

export const DEFAULT_REVIEW_WINDOW_SECONDS = 5 * 24 * 60 * 60;

export function reviewWindowSeconds(value: string | undefined): number {
  return value && /^[1-9]\d*$/.test(value) ? Number(value) : DEFAULT_REVIEW_WINDOW_SECONDS;
}

const NOT_AN_ADDRESS = 'Enter the full address of the live site, starting with https://.';
const NOT_REACHABLE = 'Use an address the tester can reach on the internet, not one on your own computer or network.';

function privateHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host.startsWith('[')) return true;
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return !host.includes('.');
}

export function checkUrl(text: string): { ok: true; url: string } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) return { ok: false, reason: NOT_AN_ADDRESS };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: NOT_AN_ADDRESS };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: NOT_AN_ADDRESS };
  if (url.username || url.password) return { ok: false, reason: 'Remove the username and password from the address.' };
  if (privateHost(url.hostname.toLowerCase().replace(/\.$/, ''))) return { ok: false, reason: NOT_REACHABLE };
  return { ok: true, url: url.href };
}

export type CheckDisplay =
  | 'passed'
  | 'failed'
  | 'unclear'
  | 'yours'
  | 'approved'
  | 'changes_requested'
  | 'testing'
  | 'queued'
  | 'not_started';

export function checkDisplay(input: {
  kind: 'machine' | 'human';
  aiVerdict: AiVerdict | null;
  clientDecision: ClientDecision | null;
  isCurrent: boolean;
  running: boolean;
}): CheckDisplay {
  if (input.clientDecision) return input.clientDecision === 'approved' ? 'approved' : 'changes_requested';
  if (input.aiVerdict === 'pass') return 'passed';
  if (input.aiVerdict === 'fail') return 'failed';
  if (input.aiVerdict === 'unclear') return 'unclear';
  if (input.kind === 'human') return 'yours';
  if (input.running) return input.isCurrent ? 'testing' : 'queued';
  return 'not_started';
}
