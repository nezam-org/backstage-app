/*
 * Custom scaffolder actions for dev environments (ticket 050):
 *
 *   - nezam:devenv:assert-none   — D5 "1 env per user", enforced SERVER-SIDE
 *     against the live platform-repo git tree (the form can't be trusted and
 *     the catalog can lag). Same bot-App tree-scan pattern as
 *     scaffolderRemovePlan.ts.
 *
 *   - nezam:devenv:seal-secrets  — generate the env's web password + restic
 *     password INSIDE the action; emit them only sops-encrypted (age public
 *     key, ADR-027) as the env's devbox-secrets manifest. The web password is
 *     argon2id-hashed (code-server HASHED_PASSWORD; hash-wasm = pure WASM, no
 *     native build) and the PLAINTEXT leaves the action exactly once: as the
 *     `webPassword` output the template shows on the completion page (D15).
 *     Shared B2 credentials come from the backstage env
 *     (DEVENVS_B2_KEY_ID/SECRET — dedicated devenvs app key, NEVER the
 *     etcd/appdb DR keys); absent creds degrade cleanly (backup disabled,
 *     web IDE unaffected).
 *
 *   - nezam:devenv:remove-plan   — close-devenv analog of tenant remove-plan:
 *     enumerate k8s/devenvs/<user>/<env>/** from the live tree. No lastApp
 *     logic — the devenvs tree has no shared per-user secret.
 */
import { resolveSafeChildPath } from '@backstage/backend-plugin-api';
import {
  DefaultGithubCredentialsProvider,
  ScmIntegrations,
} from '@backstage/integration';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { argon2id } from 'hash-wasm';
import { Octokit } from 'octokit';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OWNER = 'nezam-org';
const REPO = 'nezam-devops-k3s';
const DEVENVS_ROOT = 'k8s/devenvs';

async function listDevenvBlobs(token: string): Promise<string[]> {
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
      'devenv tree scan: recursive listing truncated — aborting rather than ' +
        'acting on an incomplete view.',
    );
  }
  return tree.tree
    .filter(
      (e): e is { path: string; type: string } =>
        e.type === 'blob' && typeof e.path === 'string',
    )
    .map(e => e.path);
}

export const createDevenvAssertNoneAction = (options: {
  integrations: ScmIntegrations;
}) => {
  const credentialsProvider = DefaultGithubCredentialsProvider.fromIntegrations(
    options.integrations,
  );
  return createTemplateAction({
    id: 'nezam:devenv:assert-none',
    description:
      'Fail unless the signed-in user has ZERO dev environments in the live ' +
      'platform tree (050 D5: one env per user, server-side enforcement).',
    schema: {
      input: {
        user: z => z.string().describe('signed-in GitHub login'),
      },
      output: {},
    },
    async handler(ctx) {
      const { user } = ctx.input;
      const { token } = await credentialsProvider.getCredentials({
        url: `https://github.com/${OWNER}/${REPO}`,
      });
      if (!token) throw new Error('devenv:assert-none: no bot credentials');
      const blobs = await listDevenvBlobs(token);
      const prefix = `${DEVENVS_ROOT}/${user}/`;
      const existing = blobs.find(p => p.startsWith(prefix));
      if (existing) {
        const env = existing.slice(prefix.length).split('/')[0];
        throw new Error(
          `You already have a dev environment ("${env}"). The platform ` +
            `currently allows ONE env per user — close it first ` +
            `(Close a dev environment), then request a new one. Your ` +
            `backups (if enabled) survive the close and devbox-restore ` +
            `brings your home dir back.`,
        );
      }
      ctx.logger.info(`devenv:assert-none — ${user} has no env, proceeding`);
    },
  });
};

// stringData values land in single-quoted YAML scalars; PHC hashes and
// base64url secrets contain no single quotes, but escape defensively anyway.
const yq = (v: string) => `'${v.replace(/'/g, "''")}'`;

export const createDevenvSealSecretsAction = () =>
  createTemplateAction({
    id: 'nezam:devenv:seal-secrets',
    description:
      'Generate the devenv web password (argon2id-hashed for code-server) ' +
      'and restic password, add the shared devenvs B2 key from the backstage ' +
      'env, and emit the devbox-secrets manifest sops-encrypted (ADR-027). ' +
      'Outputs the plaintext web password ONCE for the completion page.',
    schema: {
      input: {
        user: z => z.string(),
        env: z => z.string(),
        namespace: z => z.string().describe('the env namespace <user>-<env>-dev'),
        ageRecipient: z =>
          z
            .string()
            .describe(
              'age PUBLIC key (recipient) — must match the platform repo .sops.yaml',
            ),
        secretsPath: z =>
          z
            .string()
            .describe(
              'workspace-relative output path for the ENCRYPTED secrets manifest',
            ),
      },
      output: {
        webPassword: z =>
          z.string().describe('plaintext web password — shown once'),
        backupConfigured: z => z.boolean(),
      },
    },
    async handler(ctx) {
      const { user, env, namespace, ageRecipient, secretsPath } = ctx.input;
      const webPassword = randomBytes(18).toString('base64url'); // 24 chars
      const resticPassword = randomBytes(24).toString('base64url'); // 32 chars
      const hashed = await argon2id({
        password: webPassword,
        salt: randomBytes(16),
        parallelism: 1,
        iterations: 3,
        memorySize: 65536, // KiB = 64 MiB — transient, well under the pod limit
        hashLength: 32,
        outputType: 'encoded', // $argon2id$v=19$... PHC string
      });

      const b2KeyId = process.env.DEVENVS_B2_KEY_ID ?? '';
      const b2KeySecret = process.env.DEVENVS_B2_KEY_SECRET ?? '';
      const b2Endpoint =
        process.env.DEVENVS_B2_ENDPOINT ?? 's3.eu-central-003.backblazeb2.com';
      const b2Bucket = process.env.DEVENVS_B2_BUCKET ?? 'nezam-devenvs';
      const backupConfigured = Boolean(b2KeyId && b2KeySecret);
      if (!backupConfigured) {
        ctx.logger.warn(
          'devenv:seal-secrets — DEVENVS_B2_KEY_ID/SECRET not set in the ' +
            'backstage env; sealing EMPTY B2 creds (web IDE fine, backups ' +
            'off until the secret is updated).',
        );
      }

      const plaintext = [
        'apiVersion: v1',
        'kind: Secret',
        'metadata:',
        '  name: devbox-secrets',
        `  namespace: ${namespace}`,
        'type: Opaque',
        'stringData:',
        `  HASHED_PASSWORD: ${yq(hashed)}`,
        `  RESTIC_PASSWORD: ${yq(resticPassword)}`,
        `  AWS_ACCESS_KEY_ID: ${yq(b2KeyId)}`,
        `  AWS_SECRET_ACCESS_KEY: ${yq(b2KeySecret)}`,
        `  B2_S3_ENDPOINT: ${yq(b2Endpoint)}`,
        `  B2_BUCKET: ${yq(b2Bucket)}`,
        '',
      ].join('\n');

      const outAbs = resolveSafeChildPath(ctx.workspacePath, secretsPath);
      const tmpAbs = `${outAbs}.plain.tmp`;
      await writeFile(tmpAbs, plaintext, { mode: 0o600 });
      try {
        const sopsBin = process.env.SOPS_BIN ?? 'sops';
        const { stdout } = await execFileAsync(sopsBin, [
          'encrypt',
          '--input-type',
          'yaml',
          '--output-type',
          'yaml',
          '--age',
          ageRecipient,
          '--encrypted-regex',
          '^(data|stringData)$',
          tmpAbs,
        ]);
        await writeFile(outAbs, stdout);
      } catch (error) {
        throw new Error(
          `nezam:devenv:seal-secrets — sops encrypt failed: ${error}. Is the ` +
            `sops binary in the image and the age recipient valid?`,
        );
      } finally {
        await rm(tmpAbs, { force: true });
      }

      ctx.logger.info(
        `devenv:seal-secrets — sealed devbox-secrets for ${user}/${env} ` +
          `(backupConfigured=${backupConfigured})`,
      );
      ctx.output('webPassword', webPassword);
      ctx.output('backupConfigured', backupConfigured);
    },
  });

export const createDevenvRemovePlanAction = (options: {
  integrations: ScmIntegrations;
}) => {
  const credentialsProvider = DefaultGithubCredentialsProvider.fromIntegrations(
    options.integrations,
  );
  return createTemplateAction({
    id: 'nezam:devenv:remove-plan',
    description:
      'List every platform-repo file the close-devenv removal PR must ' +
      'delete: k8s/devenvs/<user>/<env>/**. Owner scoping is structural — ' +
      'paths are rooted at the SIGNED-IN user. No shared-secret logic ' +
      '(devenvs tree has none).',
    schema: {
      input: {
        user: z => z.string().describe('signed-in GitHub login'),
        env: z => z.string().describe('env to close'),
      },
      output: {
        filesToDelete: z => z.array(z.string()),
        alreadyRemoved: z => z.boolean(),
      },
    },
    async handler(ctx) {
      const { user, env } = ctx.input;
      const { token } = await credentialsProvider.getCredentials({
        url: `https://github.com/${OWNER}/${REPO}`,
      });
      if (!token) throw new Error('devenv:remove-plan: no bot credentials');
      const blobs = await listDevenvBlobs(token);
      const envPrefix = `${DEVENVS_ROOT}/${user}/${env}/`;
      const filesToDelete = blobs.filter(p => p.startsWith(envPrefix));
      const alreadyRemoved = filesToDelete.length === 0;
      ctx.logger.info(
        `devenv:remove-plan: ${filesToDelete.length} file(s), ` +
          `alreadyRemoved=${alreadyRemoved}`,
      );
      ctx.output('filesToDelete', filesToDelete);
      ctx.output('alreadyRemoved', alreadyRemoved);
    },
  });
};
