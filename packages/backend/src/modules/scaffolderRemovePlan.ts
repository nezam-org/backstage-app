/*
 * Custom scaffolder action: nezam:tenant:remove-plan (032 — close-app)
 *
 * Enumerates, server-side from the LIVE platform-repo git tree, every file the
 * close-app removal PR must delete: k8s/tenants/<user>/<app>/** plus, iff this
 * is the user's LAST app, the shared github-app-<user>.sops.yaml secret (the
 * runbook "preserve iff other apps exist" rule). Never a hardcoded list —
 * tenant dirs drift. Owner scoping is structural: paths are rooted at the
 * SIGNED-IN user, so a user can only ever plan the removal of their own tenant.
 *
 * Reads the platform repo with the internal bot App creds (same
 * DefaultGithubCredentialsProvider pattern as scaffolderMergePr.ts).
 */
import {
  DefaultGithubCredentialsProvider,
  ScmIntegrations,
} from '@backstage/integration';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Octokit } from 'octokit';

const OWNER = 'nezam-org';
const REPO = 'nezam-devops-k3s';

export const createRemovePlanAction = (options: {
  integrations: ScmIntegrations;
}) => {
  const credentialsProvider = DefaultGithubCredentialsProvider.fromIntegrations(
    options.integrations,
  );
  return createTemplateAction({
    id: 'nezam:tenant:remove-plan',
    description:
      'List every platform-repo file the close-app removal PR must delete: ' +
      'k8s/tenants/<user>/<app>/** plus, iff this is the user LAST app, the ' +
      'shared github-app-<user> sops secret (runbook rule). Owner scoping ' +
      'is structural: paths are rooted at the SIGNED-IN user.',
    schema: {
      input: {
        user: z => z.string().describe('signed-in GitHub login'),
        app: z => z.string().describe('app to close'),
      },
      output: {
        filesToDelete: z => z.array(z.string()),
        lastApp: z => z.boolean(),
        alreadyRemoved: z => z.boolean(),
      },
    },
    async handler(ctx) {
      const { user, app } = ctx.input;
      const { token } = await credentialsProvider.getCredentials({
        url: `https://github.com/${OWNER}/${REPO}`,
      });
      if (!token) throw new Error('remove-plan: no bot credentials resolved');
      const octokit = new Octokit({ auth: token });
      const { data: ref } = await octokit.request(
        'GET /repos/{owner}/{repo}/git/ref/{ref}',
        { owner: OWNER, repo: REPO, ref: 'heads/main' },
      );
      const { data: tree } = await octokit.request(
        'GET /repos/{owner}/{repo}/git/trees/{tree_sha}',
        { owner: OWNER, repo: REPO, tree_sha: ref.object.sha, recursive: '1' },
      );
      if (tree.truncated) {
        throw new Error(
          'remove-plan: recursive tree listing truncated — aborting before ' +
            'any change (would risk an incomplete deletion list).',
        );
      }
      const userPrefix = `k8s/tenants/${user}/`;
      const appPrefix = `${userPrefix}${app}/`;
      const sharedSecret = `${userPrefix}github-app-${user}.sops.yaml`;
      const blobs = tree.tree.filter(
        (e): e is { path: string; type: string } =>
          e.type === 'blob' && typeof e.path === 'string',
      );
      const appFiles = blobs
        .filter(e => e.path.startsWith(appPrefix))
        .map(e => e.path);
      const otherApps = blobs.filter(
        e =>
          e.path.startsWith(userPrefix) &&
          !e.path.startsWith(appPrefix) &&
          e.path !== sharedSecret,
      );
      const lastApp = otherApps.length === 0;
      const filesToDelete = [...appFiles];
      if (lastApp && blobs.some(e => e.path === sharedSecret)) {
        filesToDelete.push(sharedSecret); // preserve iff other apps exist
      }
      const alreadyRemoved = appFiles.length === 0;
      ctx.logger.info(
        `remove-plan: ${filesToDelete.length} file(s) to delete, ` +
          `lastApp=${lastApp}, alreadyRemoved=${alreadyRemoved}`,
      );
      ctx.output('filesToDelete', filesToDelete);
      ctx.output('lastApp', lastApp);
      ctx.output('alreadyRemoved', alreadyRemoved);
    },
  });
};
