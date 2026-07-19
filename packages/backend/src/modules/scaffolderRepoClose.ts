/*
 * Custom scaffolder action: nezam:github:repo-close (032 — close-app).
 *
 * The repo is the USER's property (ADR-026) → acts with the USER's OAuth
 * token, never an App credential. Ordered LAST in the template so a
 * platform-side failure never strands a deleted repo. Idempotent: 404 =
 * already gone (no-op), archived = no-op.
 *
 *   archive — PATCH /repos {archived:true} (reversible; needs `repo` scope).
 *   delete  — DELETE /repos (needs `delete_repo` scope; 403 without).
 */
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Octokit, RequestError } from 'octokit';

export const createRepoCloseAction = () =>
  createTemplateAction({
    id: 'nezam:github:repo-close',
    description:
      'Archive (PATCH archived:true — reversible, needs `repo` scope) or ' +
      'permanently delete (DELETE /repos — needs `delete_repo` scope) the ' +
      'USER OWN repository with THEIR OAuth token (ADR-026).',
    schema: {
      input: {
        owner: z => z.string(),
        repo: z => z.string(),
        mode: z => z.enum(['archive', 'delete']),
        token: z => z.string().describe('user OAuth token (scaffolder secret)'),
      },
      output: { result: z => z.string() },
    },
    async handler(ctx) {
      const { owner, repo, mode, token } = ctx.input;
      const octokit = new Octokit({ auth: token });
      let existing;
      try {
        existing = (
          await octokit.request('GET /repos/{owner}/{repo}', { owner, repo })
        ).data;
      } catch (e) {
        if (e instanceof RequestError && e.status === 404) {
          ctx.logger.info(`repo-close: ${owner}/${repo} already gone`);
          ctx.output('result', 'absent');
          return;
        }
        throw e;
      }
      if (mode === 'archive') {
        if (existing.archived) {
          ctx.output('result', 'already-archived');
          return;
        }
        await octokit.request('PATCH /repos/{owner}/{repo}', {
          owner,
          repo,
          archived: true,
        });
        ctx.output('result', 'archived');
      } else {
        try {
          await octokit.request('DELETE /repos/{owner}/{repo}', {
            owner,
            repo,
          });
        } catch (e) {
          if (e instanceof RequestError && e.status === 403) {
            throw new Error(
              `repo-close: GitHub refused the delete (403) — the OAuth ` +
                `token likely lacks the delete_repo scope. Re-run close and ` +
                `accept the GitHub consent popup.`,
            );
          }
          throw e;
        }
        ctx.output('result', 'deleted');
      }
    },
  });
