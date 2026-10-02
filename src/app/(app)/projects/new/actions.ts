'use server';

import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { claudeModel } from '@/ai/claude';
import { getCurrentUser } from '@/auth/current-user';
import { draftProject } from '@/criteria/draft-job';
import { db } from '@/db/client';
import { createProject } from '@/db/queries/contract';
import { freelancerEmailProblem } from '@/db/queries/users';
import { parseAmount } from '@/domain/money';
import { checkNewProject } from '@/domain/new-project';

export interface NewProjectForm {
  title: string;
  freelancerEmail: string;
  milestones: Array<{ title: string; brief: string; amount: string }>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export async function createProjectAction(form: NewProjectForm): Promise<{ error: string }> {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  if (user.role !== 'client') return { error: 'Only a client account can start a project.' };

  const title = text(form?.title);
  const freelancerEmail = text(form?.freelancerEmail);
  const milestones = (Array.isArray(form?.milestones) ? form.milestones : []).map((milestone) => ({
    title: text(milestone?.title),
    brief: text(milestone?.brief),
    amountCents: parseAmount(text(milestone?.amount)),
  }));

  const problem = checkNewProject({ title, clientEmail: user.email, freelancerEmail, milestones });
  if (problem) return { error: problem };

  const emailProblem = await freelancerEmailProblem(db, freelancerEmail);
  if (emailProblem) return { error: emailProblem };

  const projectId = await createProject(
    db,
    {
      clientId: user.id,
      title,
      freelancerEmail,
      milestones: milestones.map((milestone) => ({ ...milestone, amountCents: milestone.amountCents! })),
    },
    new Date(),
  );

  after(() => draftProject(db, claudeModel(), projectId));
  redirect(`/projects/${projectId}/criteria`);
}
