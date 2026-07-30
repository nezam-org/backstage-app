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

// Build the restic S3 repository URL from the user's bucket details (F2).
// restic S3 backend works against ANY S3-compatible provider (B2, AWS, R2,
// MinIO, Wasabi…): s3:https://<endpoint>/<bucket>/<prefix>.
function buildResticRepo(
  endpoint: string,
  bucket: string,
  prefix: string,
): string {
  const host = endpoint.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const p = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
  return `s3:https://${host}/${bucket}${p ? `/${p}` : ''}`;
}

export const createDevenvSealSecretsAction = () =>
  createTemplateAction({
    id: 'nezam:devenv:seal-secrets',
    description:
      'Generate the devenv web password (argon2id-hashed for code-server), ' +
      'assemble the user-supplied S3 backup credentials into a restic ' +
      'repository, and emit the devbox-secrets manifest sops-encrypted ' +
      '(ADR-027). Backup is BYO: the user brings their own S3-compatible ' +
      'bucket + keys (task 050 F2). Outputs the plaintext web password ONCE.',
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
        // Backup (all optional; backup is enabled iff bucket+keys+password
        // are all present). The user brings their OWN storage.
        backupEndpoint: z =>
          z
            .string()
            .optional()
            .describe('S3 endpoint host, no scheme (e.g. s3.eu-central-003.backblazeb2.com)'),
        backupRegion: z =>
          z.string().optional().describe('region (AWS_DEFAULT_REGION); optional for B2'),
        backupBucket: z => z.string().optional().describe('bucket name'),
        backupPrefix: z =>
          z
            .string()
            .optional()
            .describe('repo path/prefix within the bucket (default devbox/<user>-<env>)'),
        backupAccessKey: z =>
          z.string().optional().describe('S3 access key id (from scaffolder secret)'),
        backupSecretKey: z =>
          z.string().optional().describe('S3 secret access key (from scaffolder secret)'),
        resticPassword: z =>
          z
            .string()
            .optional()
            .describe(
              'restic repo password; if blank one is generated and returned ONCE. ' +
                'Must match to restore an existing repo (e.g. on env reopen).',
            ),
      },
      output: {
        webPassword: z =>
          z.string().describe('plaintext web password — shown once'),
        resticPassword: z =>
          z
            .string()
            .describe('restic password (generated or provided) — shown once if backup on'),
        backupConfigured: z => z.boolean(),
      },
    },
    async handler(ctx) {
      const {
        user,
        env,
        namespace,
        ageRecipient,
        secretsPath,
        backupEndpoint,
        backupRegion,
        backupBucket,
        backupAccessKey,
        backupSecretKey,
      } = ctx.input;

      const webPassword = randomBytes(18).toString('base64url'); // 24 chars
      const hashed = await argon2id({
        password: webPassword,
        salt: randomBytes(16),
        parallelism: 1,
        iterations: 3,
        memorySize: 65536, // KiB = 64 MiB — transient, well under the pod limit
        hashLength: 32,
        outputType: 'encoded', // $argon2id$v=19$... PHC string
      });

      // Backup is configured only when the user supplied a full set.
      const wantBackup = Boolean(
        backupEndpoint && backupBucket && backupAccessKey && backupSecretKey,
      );
      const prefix =
        (ctx.input.backupPrefix ?? '').trim() || `devbox/${user}-${env}`;
      // Provided password wins (needed to attach to an existing repo on
      // reopen); otherwise generate one and surface it once.
      const resticPassword =
        (ctx.input.resticPassword ?? '').trim() ||
        randomBytes(24).toString('base64url');

      const stringData: Array<[string, string]> = [
        ['HASHED_PASSWORD', hashed],
      ];
      if (wantBackup) {
        stringData.push(
          ['RESTIC_REPOSITORY', buildResticRepo(backupEndpoint!, backupBucket!, prefix)],
          ['RESTIC_PASSWORD', resticPassword],
          ['AWS_ACCESS_KEY_ID', backupAccessKey!],
          ['AWS_SECRET_ACCESS_KEY', backupSecretKey!],
        );
        if (backupRegion) {
          stringData.push(['AWS_DEFAULT_REGION', backupRegion]);
        }
      } else {
        ctx.logger.info(
          'devenv:seal-secrets — no backup bucket supplied; sealing web ' +
            'credentials only (backup off).',
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
        ...stringData.map(([k, v]) => `  ${k}: ${yq(v)}`),
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
          `(backupConfigured=${wantBackup})`,
      );
      ctx.output('webPassword', webPassword);
      ctx.output('resticPassword', wantBackup ? resticPassword : '');
      ctx.output('backupConfigured', wantBackup);
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
