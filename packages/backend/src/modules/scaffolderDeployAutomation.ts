/*
 * Custom scaffolder action: nezam:github:deploy-automation
 *
 * Why this exists (031 — trunk-based deploy-PR flow):
 * The deploy model is trunk-based. The tenant repo's `main` is protected at
 * 1 required approval (publish:github applies that protection at creation).
 * The scaffolded repo's 025 CI does NOT direct-push the resolved staging image
 * tag; it opens a SHORT-LIVED PR bumping the tag, the app owner approves it, and
 * auto-merge lands it on main with [skip ci]. Flux then deploys the tag off main.
 *
 * For that to work two repo settings must be enabled at creation time, because
 * this GitHub account has them OFF by default:
 *   (a) Allow auto-merge — so an approved deploy PR merges itself.
 *       This one is handled by publish:github's `allowAutoMerge: true` input
 *       (it sets `allow_auto_merge` on the create-repo call), NOT here.
 *   (b) Allow GitHub Actions to create pull requests + default workflow
 *       permissions = write — so the CI's GITHUB_TOKEN can open the deploy PR.
 *       publish:github has NO input for this, so this action sets it via the
 *       one GitHub REST endpoint that controls it:
 *         PUT /repos/{owner}/{repo}/actions/permissions/workflow
 *           { default_workflow_permissions: "write",
 *             can_approve_pull_request_reviews: true }
 *       `can_approve_pull_request_reviews` is GitHub's field name for the
 *       "Allow GitHub Actions to create and approve pull requests" toggle.
 *
 * Runs AFTER publish:github (the repo must exist first) and authenticates with
 * the SAME user OAuth token that created the repo. Reuses the `octokit`
 * meta-package already present in the tree (via @backstage/*), so no new
 * dependency — same createTemplateAction + scaffolderActionsExtensionPoint
 * pattern as modules/scaffolderReplace.ts / scaffolderAssert.ts.
 */
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Octokit, RequestError } from 'octokit';

export const createDeployAutomationAction = () =>
  createTemplateAction({
    id: 'nezam:github:deploy-automation',
    description:
      'Enable "GitHub Actions can create pull requests" and set default ' +
      'workflow permissions to write on a freshly-created repo, so its CI ' +
      'GITHUB_TOKEN can open the trunk-based staging deploy PR (031). ' +
      '(Auto-merge itself is enabled by publish:github allowAutoMerge.)',
    schema: {
      input: {
        owner: z =>
          z
            .string()
            .describe('repository owner (GitHub login of the signed-in user)'),
        repo: z => z.string().describe('repository name'),
        token: z =>
          z
            .string()
            .describe(
              'user OAuth token (repo scope) — the same secret publish:github ' +
                'used to create the repo',
            ),
      },
      output: {
        defaultWorkflowPermissions: z => z.string(),
        canApprovePullRequestReviews: z => z.boolean(),
      },
    },
    async handler(ctx) {
      const { owner, repo, token } = ctx.input;
      const octokit = new Octokit({ auth: token });

      try {
        // Set default workflow permissions = write AND allow GitHub Actions to
        // create (and approve) pull requests. This is the single REST endpoint
        // behind the repo Settings → Actions → "Workflow permissions" section.
        await octokit.request(
          'PUT /repos/{owner}/{repo}/actions/permissions/workflow',
          {
            owner,
            repo,
            default_workflow_permissions: 'write',
            can_approve_pull_request_reviews: true,
          },
        );
      } catch (error) {
        if (error instanceof RequestError) {
          throw new Error(
            `nezam:github:deploy-automation — failed to set workflow ` +
              `permissions on ${owner}/${repo}: GitHub returned ` +
              `${error.status} — ${error.message}. The CI cannot open the ` +
              `staging deploy PR without "Allow GitHub Actions to create pull ` +
              `requests" and write workflow permissions.`,
          );
        }
        throw error;
      }

      ctx.logger.info(
        `nezam:github:deploy-automation — ${owner}/${repo}: default workflow ` +
          `permissions=write, GitHub Actions may create PRs — OK`,
      );
      ctx.output('defaultWorkflowPermissions', 'write');
      ctx.output('canApprovePullRequestReviews', true);
    },
  });
