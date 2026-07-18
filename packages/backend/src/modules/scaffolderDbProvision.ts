/*
 * Custom scaffolder action: nezam:tenant:db-provision (ticket 037)
 *
 * Why this exists: until 037, the create-app flow automated everything EXCEPT
 * the DB registration — after the owner merged the tenant PR, someone still
 * had to hand-create the role password secrets and the CNPG managed.roles
 * entry. That was manual BY NECESSITY pre-ADR-027 (secrets could not touch
 * git). ADR-027 removed the blocker: sops encryption needs only the PUBLIC
 * age key, so this action can generate a password inside the task and emit it
 * ONLY in encrypted form, straight into the tenant-registration PR.
 *
 * What it does (all inside the scaffolder workspace, rides the platform PR):
 *   1. Generates the tenant DB password (never logged, never plaintext in
 *      the PR — a .plain.tmp file exists transiently in the task workspace
 *      and is removed in `finally`).
 *   2. Writes k8s/tenants/<user>/<app>/secrets.sops.yaml — `app-db` in both
 *      env namespaces + `<user>-<app>-db` (kubernetes.io/basic-auth, ns
 *      appdb; CNPG reconciles the role password from it). Encrypted by
 *      shelling out to the sops binary baked into the image (Dockerfile)
 *      with `--age <recipient> --encrypted-regex '^(data|stringData)$'` —
 *      exactly the platform's .sops.yaml rules, no config file needed.
 *   3. Appends the managed.roles entry to the fetched copy of
 *      k8s/platform/appdb/cluster.yaml (fetch:plain:file step). ASSUMES the
 *      roles list is the LAST block of that file (true since task 024; the
 *      file's own append-marker comment documents the convention).
 *
 * Result: merging the ONE tenant PR fully registers the app — Flux applies
 * secrets + tenant dir, CNPG creates role + databases, no kubectl anywhere.
 */
import { resolveSafeChildPath } from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const b64 = (v: string) => Buffer.from(v, 'utf8').toString('base64');

function secretDoc(
  name: string,
  namespace: string,
  data: Record<string, string>,
  type?: string,
): string {
  const lines = [
    'apiVersion: v1',
    'kind: Secret',
    'metadata:',
    `  name: ${name}`,
    `  namespace: ${namespace}`,
  ];
  if (type) {
    lines.push(`type: ${type}`);
  }
  lines.push('data:');
  for (const [k, v] of Object.entries(data)) {
    lines.push(`  ${k}: ${b64(v)}`);
  }
  return lines.join('\n');
}

export const createDbProvisionAction = () =>
  createTemplateAction({
    id: 'nezam:tenant:db-provision',
    description:
      'Generate the tenant DB password, emit it as a sops-encrypted secrets ' +
      'manifest in the tenant dir, and append the CNPG managed.roles entry ' +
      'to the fetched cluster.yaml — so ONE merged PR fully registers the ' +
      'app (ticket 037, enabled by ADR-027).',
    schema: {
      input: {
        user: z => z.string().describe('GitHub login of the tenant owner'),
        app: z => z.string().describe('app name'),
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
        clusterYamlPath: z =>
          z
            .string()
            .describe(
              'workspace-relative path of the fetched appdb cluster.yaml to append the managed role to',
            ),
      },
      output: {
        role: z => z.string(),
        dbSecretName: z => z.string(),
      },
    },
    async handler(ctx) {
      const { user, app, ageRecipient, secretsPath, clusterYamlPath } =
        ctx.input;
      const role = `${user}-${app}`.replace(/-/g, '_');
      const dbSecretName = `${user}-${app}-db`;
      // base64url → no YAML-hostile characters; 24 bytes ≈ 192 bits entropy.
      const password = randomBytes(24).toString('base64url');

      const common = {
        username: role,
        password,
        host: 'shared-pg-rw.appdb.svc',
        port: '5432',
      };
      const plaintext = `${[
        secretDoc('app-db', `${user}-${app}-staging`, {
          ...common,
          dbname: `${role}_staging`,
        }),
        secretDoc('app-db', `${user}-${app}-prod`, {
          ...common,
          dbname: `${role}_prod`,
        }),
        secretDoc(
          dbSecretName,
          'appdb',
          { username: role, password },
          'kubernetes.io/basic-auth',
        ),
      ].join('\n---\n')}\n`;

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
          `nezam:tenant:db-provision — sops encrypt failed: ${error}. ` +
            `Is the sops binary in the image (packages/backend/Dockerfile) ` +
            `and the age recipient valid?`,
        );
      } finally {
        await rm(tmpAbs, { force: true });
      }

      const cyAbs = resolveSafeChildPath(ctx.workspacePath, clusterYamlPath);
      let cy = await readFile(cyAbs, 'utf8');
      // Idempotent: task retries re-run the action against the same workspace.
      if (!cy.includes(`- name: ${role}`)) {
        if (!cy.endsWith('\n')) {
          cy += '\n';
        }
        cy += `${[
          `      - name: ${role}`,
          '        ensure: present',
          '        login: true',
          '        passwordSecret:',
          `          name: ${dbSecretName}`,
        ].join('\n')}\n`;
        await writeFile(cyAbs, cy);
      }

      ctx.logger.info(
        `nezam:tenant:db-provision — role ${role}: secrets encrypted to ` +
          `${secretsPath}, managed.roles entry appended to ${clusterYamlPath}`,
      );
      ctx.output('role', role);
      ctx.output('dbSecretName', dbSecretName);
    },
  });
