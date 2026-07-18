/*
 * Custom scaffolder action: nezam:github:merge-pr (ADR-028)
 *
 * ── GATE SUSPENDED (owner ruling 2026-07-18: UX over security for now) ──
 * The tenant-registration PR used to WAIT for the platform owner's manual
 * merge — that merge WAS the approval gate + audit trail. The owner suspended
 * the gate: this action merges the PR immediately after creation, authored
 * and merged by the internal bot App. The PR itself remains in history as the
 * audit trail; only the human pause is gone.
 *
 * TO RESTORE THE GATE: remove the `merge-tenant-pr` step from
 * templates/create-app/template.yaml (this action can stay registered,
 * unused) and revert the PR-description wording.
 *
 * Auth: no token input — resolves credentials from the configured GitHub
 * integrations exactly like publish:github:pull-request does, so the SAME
 * internal bot App (Contents + Pull-requests write on nezam-devops-k3s only,
 * allowedInstallationOwners: [nezam-org]) that authored the PR merges it.
 */
import {
  DefaultGithubCredentialsProvider,
  ScmIntegrations,
} from '@backstage/integration';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Octokit, RequestError } from 'octokit';

export const createMergePrAction = (options: {
  integrations: ScmIntegrations;
}) => {
  const credentialsProvider = DefaultGithubCredentialsProvider.fromIntegrations(
    options.integrations,
  );
  return createTemplateAction({
    id: 'nezam:github:merge-pr',
    description:
      'Merge a just-created PR with the platform bot App credentials ' +
      '(ADR-028 — the human approval gate is suspended; the PR remains as ' +
      'the audit trail).',
    schema: {
      input: {
        owner: z => z.string().describe('repository owner'),
        repo: z => z.string().describe('repository name'),
        pullNumber: z => z.number().describe('PR number to merge'),
      },
      output: {
        merged: z => z.boolean(),
        sha: z => z.string(),
      },
    },
    async handler(ctx) {
      const { owner, repo, pullNumber } = ctx.input;
      const url = `https://github.com/${owner}/${repo}`;
      const { token } = await credentialsProvider.getCredentials({ url });
      if (!token) {
        throw new Error(
          `nezam:github:merge-pr — no credentials resolved for ${url}; ` +
            `check the GitHub App integrations in app-config.`,
        );
      }
      const octokit = new Octokit({ auth: token });
      try {
        const res = await octokit.request(
          'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge',
          {
            owner,
            repo,
            pull_number: pullNumber,
            merge_method: 'squash',
          },
        );
        ctx.logger.info(
          `nezam:github:merge-pr — merged ${owner}/${repo}#${pullNumber} ` +
            `(${res.data.sha}) — ADR-028 auto-approval`,
        );
        ctx.output('merged', true);
        ctx.output('sha', res.data.sha ?? '');
      } catch (error) {
        if (error instanceof RequestError) {
          throw new Error(
            `nezam:github:merge-pr — merging ${owner}/${repo}#${pullNumber} ` +
              `failed: GitHub returned ${error.status} — ${error.message}. ` +
              `The tenant PR is left OPEN; merge it manually (the app ` +
              `registers on merge).`,
          );
        }
        throw error;
      }
    },
  });
};
