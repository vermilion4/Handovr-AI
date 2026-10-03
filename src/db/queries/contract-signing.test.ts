import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CriterionFields, DraftedCriterion } from '../../domain/criteria';
import { signatures, users, type Db } from '../schema';
import { createTestDb } from '../test-db';
import {
  acknowledgeVersion,
  claimDraft,
  createProject,
  declineVersion,
  getContract,
  listPendingDrafts,
  saveDraft,
  saveEdit,
  signMilestones,
  type ContractMilestone,
} from './contract';

const now = new Date('2026-10-02T12:00:00Z');

const drafted: DraftedCriterion[] = [
  { description: 'The form sends a message', testPlan: 'Fill it in and press Send.', kind: 'machine', category: 'function', shareCents: 30000 },
  { description: 'Works at phone width', testPlan: 'View at 390 pixels wide.', kind: 'machine', category: 'responsive', shareCents: 20000 },
  { description: 'Matches the homepage', testPlan: 'The client compares the two pages.', kind: 'human', category: null, shareCents: 10000 },
];

let db: Db;
let mayaId: string;
let tomasId: string;
let strangerId: string;
let projectId: string;

async function person(name: string, email: string, role: 'client' | 'freelancer'): Promise<string> {
  const [row] = await db.insert(users).values({ name, email, role }).returning({ id: users.id });
  return row.id;
}

async function milestonesNow(): Promise<ContractMilestone[]> {
  return (await getContract(db, projectId, mayaId))!.milestones;
}

function reworded(items: CriterionFields[]): CriterionFields[] {
  return items.map((item, index) => (index === 0 ? { ...item, description: 'The form emails the bakery' } : item));
}

const sign = (userId: string, versionIds: string[], typedName: string, agreed = true) =>
  signMilestones(db, { projectId, userId, versionIds, typedName, agreed, now });

beforeEach(async () => {
  db = await createTestDb();
  mayaId = await person('Maya Chen', 'maya@chensbakery.example', 'client');
  tomasId = await person('Tomás Rivera', 'tomas@riverastudio.example', 'freelancer');
  strangerId = await person('Sam Stranger', 'sam@elsewhere.example', 'client');
  projectId = await createProject(
    db,
    {
      clientId: mayaId,
      title: "Chen's Bakery website",
      freelancerEmail: 'tomas@riverastudio.example',
      milestones: [
        { title: 'Homepage', brief: 'A homepage with opening hours.', amountCents: 60000 },
        { title: 'Contact page', brief: 'A contact page with a form.', amountCents: 60000 },
      ],
    },
    now,
  );
  for (const id of await listPendingDrafts(db, projectId)) {
    await claimDraft(db, id, now);
    await saveDraft(db, id, drafted);
  }
});

describe('saveEdit', () => {
  it('stores a change as the next version, written by its author, with the reason', async () => {
    const [home] = await milestonesNow();
    const result = await saveEdit(db, {
      milestoneId: home.id,
      authorId: tomasId,
      baseVersionId: home.version!.id,
      items: reworded(home.version!.criteria),
      reason: ' The form goes to an inbox. ',
    });
    expect(result).toEqual({ ok: true });

    const [after] = await milestonesNow();
    expect(after.version).toMatchObject({ number: 2, authorId: tomasId, reason: 'The form goes to an inbox.', acknowledged: false });
    expect(after.version!.criteria[0].description).toBe('The form emails the bakery');
    expect(after.version!.previous).toEqual(home.version!.criteria);
  });

  it('leaves earlier signatures behind, so nobody has signed the new list', async () => {
    const [home] = await milestonesNow();
    await sign(mayaId, [home.version!.id], 'Maya Chen');
    await saveEdit(db, { milestoneId: home.id, authorId: tomasId, baseVersionId: home.version!.id, items: reworded(home.version!.criteria), reason: '' });
    expect((await milestonesNow())[0].version!.signedBy).toEqual([]);
  });

  it('refuses a second save made from the same starting list', async () => {
    const [home] = await milestonesNow();
    const edit = { milestoneId: home.id, baseVersionId: home.version!.id, items: reworded(home.version!.criteria), reason: '' };
    await saveEdit(db, { ...edit, authorId: tomasId });

    expect(await saveEdit(db, { ...edit, authorId: mayaId })).toEqual({
      ok: false,
      reason: 'The list changed while you were editing. Reload to see the latest version.',
    });
    expect((await milestonesNow())[0].version!.number).toBe(2);
  });

  it('refuses a list whose shares do not total the milestone amount', async () => {
    const [home] = await milestonesNow();
    const items = home.version!.criteria.slice(0, 2);
    expect(await saveEdit(db, { milestoneId: home.id, authorId: mayaId, baseVersionId: home.version!.id, items, reason: '' })).toEqual({
      ok: false,
      reason: 'Shares add up to $500.00, but the milestone is $600.00.',
    });
  });

  it('refuses a save that changes nothing', async () => {
    const [home] = await milestonesNow();
    expect(
      await saveEdit(db, { milestoneId: home.id, authorId: mayaId, baseVersionId: home.version!.id, items: home.version!.criteria, reason: '' }),
    ).toEqual({ ok: false, reason: 'Nothing has changed.' });
  });

  it('refuses someone who is not on the project', async () => {
    const [home] = await milestonesNow();
    expect(
      await saveEdit(db, { milestoneId: home.id, authorId: strangerId, baseVersionId: home.version!.id, items: reworded(home.version!.criteria), reason: '' }),
    ).toEqual({ ok: false, reason: 'You are not on this project.' });
  });

  it('refuses a change once both have signed', async () => {
    const [home] = await milestonesNow();
    await sign(mayaId, [home.version!.id], 'Maya Chen');
    await sign(tomasId, [home.version!.id], 'Tomas Rivera');
    expect(
      await saveEdit(db, { milestoneId: home.id, authorId: mayaId, baseVersionId: home.version!.id, items: reworded(home.version!.criteria), reason: '' }),
    ).toEqual({ ok: false, reason: 'These checks are signed and can no longer be changed.' });
  });
});

describe('what changed, as shown to the other person', () => {
  it('compares against the last list they saw when the author saved twice in a row', async () => {
    const [home] = await milestonesNow();
    const original = home.version!.criteria;
    const moved = original.map((item, index) =>
      index === 0 ? { ...item, shareCents: 10000 } : index === 2 ? { ...item, shareCents: 30000 } : item,
    );
    await saveEdit(db, { milestoneId: home.id, authorId: tomasId, baseVersionId: home.version!.id, items: moved, reason: '' });
    const second = (await milestonesNow())[0].version!;
    await saveEdit(db, { milestoneId: home.id, authorId: tomasId, baseVersionId: second.id, items: reworded(moved), reason: '' });

    const third = (await milestonesNow())[0].version!;
    expect(third.number).toBe(3);
    expect(third.previous).toEqual(original);
  });

  it('compares against the other person\'s list once they have answered with their own change', async () => {
    const [home] = await milestonesNow();
    await saveEdit(db, { milestoneId: home.id, authorId: tomasId, baseVersionId: home.version!.id, items: reworded(home.version!.criteria), reason: '' });
    const second = (await milestonesNow())[0].version!;
    const again = second.criteria.map((item, index) => (index === 1 ? { ...item, description: 'Works on a phone' } : item));
    await saveEdit(db, { milestoneId: home.id, authorId: mayaId, baseVersionId: second.id, items: again, reason: '' });

    expect((await milestonesNow())[0].version!.previous).toEqual(second.criteria);
  });
});

describe('acknowledgeVersion', () => {
  async function tomasChangesHomepage(): Promise<string> {
    const [home] = await milestonesNow();
    await saveEdit(db, { milestoneId: home.id, authorId: tomasId, baseVersionId: home.version!.id, items: reworded(home.version!.criteria), reason: '' });
    return (await milestonesNow())[0].version!.id;
  }

  it('lets the other person accept a change', async () => {
    const versionId = await tomasChangesHomepage();
    expect(await acknowledgeVersion(db, { versionId, userId: mayaId, now })).toEqual({ ok: true });
    expect((await milestonesNow())[0].version!.acknowledged).toBe(true);
  });

  it('refuses the author accepting their own change, and a stranger', async () => {
    const versionId = await tomasChangesHomepage();
    expect(await acknowledgeVersion(db, { versionId, userId: tomasId, now })).toEqual({ ok: false, reason: 'There is nothing to accept.' });
    expect(await acknowledgeVersion(db, { versionId, userId: strangerId, now })).toEqual({ ok: false, reason: 'You are not on this project.' });
  });
});

describe('declineVersion', () => {
  async function tomasChangesHomepageTwice() {
    const [home] = await milestonesNow();
    const original = home.version!.criteria;
    const moved = original.map((item, index) =>
      index === 0 ? { ...item, shareCents: 10000 } : index === 2 ? { ...item, shareCents: 30000 } : item,
    );
    await saveEdit(db, { milestoneId: home.id, authorId: tomasId, baseVersionId: home.version!.id, items: moved, reason: '' });
    const second = (await milestonesNow())[0].version!;
    await saveEdit(db, { milestoneId: home.id, authorId: tomasId, baseVersionId: second.id, items: reworded(moved), reason: '' });
    return { original, versionId: (await milestonesNow())[0].version!.id };
  }

  it('puts back the list as it was before the other person changed it, as a new version by the decliner', async () => {
    const { original, versionId } = await tomasChangesHomepageTwice();
    expect(await declineVersion(db, { versionId, userId: mayaId })).toEqual({ ok: true });

    const [home] = await milestonesNow();
    expect(home.version).toMatchObject({ number: 4, authorId: mayaId, reason: 'Declined the changes and kept the earlier list.' });
    expect(home.version!.criteria).toEqual(original);
  });

  it('shows the other person what was put back, for them to accept', async () => {
    const { versionId } = await tomasChangesHomepageTwice();
    const tomasList = (await milestonesNow())[0].version!.criteria;
    await declineVersion(db, { versionId, userId: mayaId });

    const home = (await getContract(db, projectId, tomasId))!.milestones[0];
    expect(home.version!.previous).toEqual(tomasList);
    expect(home.version!.acknowledged).toBe(false);
  });

  it('refuses the author declining their own change, a stranger, and a list that is no longer the latest', async () => {
    const { versionId } = await tomasChangesHomepageTwice();
    expect(await declineVersion(db, { versionId, userId: tomasId })).toEqual({ ok: false, reason: 'There is nothing to decline.' });
    expect(await declineVersion(db, { versionId, userId: strangerId })).toEqual({ ok: false, reason: 'You are not on this project.' });

    await declineVersion(db, { versionId, userId: mayaId });
    expect(await declineVersion(db, { versionId, userId: mayaId })).toEqual({
      ok: false,
      reason: 'The list changed. Reload to see the latest version.',
    });
  });

  it('refuses once the change has been accepted', async () => {
    const { versionId } = await tomasChangesHomepageTwice();
    await acknowledgeVersion(db, { versionId, userId: mayaId, now });
    expect(await declineVersion(db, { versionId, userId: mayaId })).toEqual({ ok: false, reason: 'There is nothing to decline.' });
  });
});

describe('signMilestones', () => {
  it('records the signer, the typed name and the email against each list', async () => {
    const [home, contact] = await milestonesNow();
    expect(await sign(mayaId, [home.version!.id, contact.version!.id], 'maya chen')).toEqual({ ok: true, signed: 2, completed: 0, completedIds: [] });

    const rows = await db.select().from(signatures).where(eq(signatures.userId, mayaId));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ signedName: 'maya chen', signedEmail: 'maya@chensbakery.example', signedAt: now });
    expect((await milestonesNow()).map((m) => m.state)).toEqual(['drafting', 'drafting']);
  });

  it('moves a milestone to signed once both have signed the same list', async () => {
    const [home, contact] = await milestonesNow();
    await sign(mayaId, [home.version!.id, contact.version!.id], 'Maya Chen');
    expect(await sign(tomasId, [home.version!.id], 'Tomás Rivera')).toEqual({ ok: true, signed: 1, completed: 1, completedIds: [home.id] });
    expect((await milestonesNow()).map((m) => m.state)).toEqual(['signed', 'drafting']);
  });

  it('counts a repeated signature once', async () => {
    const [home] = await milestonesNow();
    await sign(mayaId, [home.version!.id], 'Maya Chen');
    await sign(mayaId, [home.version!.id, home.version!.id], 'Maya Chen');
    expect(await db.select().from(signatures)).toHaveLength(1);
  });

  it('refuses a name that is not the account name', async () => {
    const [home] = await milestonesNow();
    expect(await sign(mayaId, [home.version!.id], 'Maya')).toEqual({
      ok: false,
      reason: 'Type your full name as it appears on your account: Maya Chen.',
    });
    expect(await db.select().from(signatures)).toHaveLength(0);
  });

  it('refuses when the agreement box is not ticked, or nothing is chosen', async () => {
    const [home] = await milestonesNow();
    expect(await sign(mayaId, [home.version!.id], 'Maya Chen', false)).toEqual({ ok: false, reason: 'Tick the box to agree before signing.' });
    expect(await sign(mayaId, [], 'Maya Chen')).toEqual({ ok: false, reason: 'Choose at least one milestone to sign.' });
  });

  it('refuses a list that has been replaced, and records nothing for the other milestones either', async () => {
    const [home, contact] = await milestonesNow();
    await saveEdit(db, { milestoneId: contact.id, authorId: tomasId, baseVersionId: contact.version!.id, items: reworded(contact.version!.criteria), reason: '' });

    expect(await sign(mayaId, [home.version!.id, contact.version!.id], 'Maya Chen')).toEqual({
      ok: false,
      reason: 'The "Contact page" list changed. Reload to see the latest version.',
    });
    expect(await db.select().from(signatures)).toHaveLength(0);
  });

  it("refuses to sign the other person's change before it is accepted", async () => {
    const [home] = await milestonesNow();
    await saveEdit(db, { milestoneId: home.id, authorId: tomasId, baseVersionId: home.version!.id, items: reworded(home.version!.criteria), reason: '' });
    const versionId = (await milestonesNow())[0].version!.id;

    expect(await sign(mayaId, [versionId], 'Maya Chen')).toEqual({
      ok: false,
      reason: 'Accept the changes to "Homepage" before signing it.',
    });
    expect(await sign(tomasId, [versionId], 'Tomás Rivera')).toMatchObject({ ok: true });

    await acknowledgeVersion(db, { versionId, userId: mayaId, now });
    expect(await sign(mayaId, [versionId], 'Maya Chen')).toEqual({ ok: true, signed: 1, completed: 1, completedIds: [home.id] });
  });

  it('refuses someone who is not on the project, and a list from another project', async () => {
    const [home] = await milestonesNow();
    expect(await signMilestones(db, { projectId, userId: strangerId, versionIds: [home.version!.id], typedName: 'Sam Stranger', agreed: true, now })).toEqual({
      ok: false,
      reason: 'You are not on this project.',
    });

    const otherProject = await createProject(
      db,
      { clientId: strangerId, title: 'Other', freelancerEmail: 'tomas@riverastudio.example', milestones: [{ title: 'Page', brief: 'A page for another project.', amountCents: 60000 }] },
      now,
    );
    const [otherMilestone] = await listPendingDrafts(db, otherProject);
    await claimDraft(db, otherMilestone, now);
    await saveDraft(db, otherMilestone, drafted);
    const otherVersion = (await getContract(db, otherProject, strangerId))!.milestones[0].version!.id;

    expect(await sign(tomasId, [otherVersion], 'Tomás Rivera')).toEqual({
      ok: false,
      reason: 'That list does not belong to this project.',
    });
  });

  it('refuses a milestone that is already signed by both', async () => {
    const [home] = await milestonesNow();
    await sign(mayaId, [home.version!.id], 'Maya Chen');
    await sign(tomasId, [home.version!.id], 'Tomás Rivera');
    expect(await sign(mayaId, [home.version!.id], 'Maya Chen')).toEqual({
      ok: false,
      reason: '"Homepage" is already signed by both of you.',
    });
  });
});
