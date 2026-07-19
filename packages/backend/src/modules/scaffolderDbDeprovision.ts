/*
 * Custom scaffolder actions: nezam:tenant:db-deprovision +
 * nezam:tenant:db-drop-prepare (032 — close-app, inverse of 037 db-provision).
 *
 * db-deprovision edits the fetched appdb cluster.yaml:
 *   drop=false (retain, default): REMOVE the managed.roles block → CNPG
 *     abandons the role (verified devel docs: unlisted roles are ignored);
 *     role + DBs stay in Postgres, runbook documents the manual DROP.
 *   drop=true: flip `ensure: present` → `ensure: absent` (block STAYS so CNPG
 *     actively drops the role once its DBs are gone — DROP ROLE is retried on
 *     dependency errors, verified devel docs). Residue entry cleanup is a
 *     documented owner follow-up (see runbook).
 *
 * db-drop-prepare (phase 1 of the two-phase DB drop) edits the fetched tenant
 * database.yaml, giving BOTH Database docs `databaseReclaimPolicy: delete`.
 * It MUST be merged + live-applied BEFORE the CRs are deleted (Flux GC uses
 * the live object's spec — one-commit flip+delete is structurally impossible;
 * same trap class as the flux-selfref-prune sweep).
 */
import { resolveSafeChildPath } from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { readFile, writeFile } from 'node:fs/promises';

const roleBlock = (role: string, secret: string, ensure: string) =>
  [
    `      - name: ${role}`,
    `        ensure: ${ensure}`,
    '        login: true',
    '        passwordSecret:',
    `          name: ${secret}`,
  ].join('\n') + '\n';

export const createDbDeprovisionAction = () =>
  createTemplateAction({
    id: 'nezam:tenant:db-deprovision',
    description:
      'Inverse of nezam:tenant:db-provision (037): remove (retain path) or ' +
      'flip to ensure:absent (drop path) the tenant managed.roles entry in ' +
      'the fetched appdb cluster.yaml.',
    schema: {
      input: {
        user: z => z.string(),
        app: z => z.string(),
        drop: z => z.boolean().describe('true = DB-drop path'),
        clusterYamlPath: z => z.string(),
      },
      output: { changed: z => z.boolean() },
    },
    async handler(ctx) {
      const { user, app, drop, clusterYamlPath } = ctx.input;
      const role = `${user}-${app}`.replace(/-/g, '_');
      const secret = `${user}-${app}-db`;
      const abs = resolveSafeChildPath(ctx.workspacePath, clusterYamlPath);
      const cy = await readFile(abs, 'utf8');
      const present = roleBlock(role, secret, 'present');
      let next = cy;
      if (cy.includes(present)) {
        next = drop
          ? cy.replace(
              present,
              `      # 032 close-app: role being dropped (absent); remove this\n` +
                `      # entry once cluster status shows it applied.\n` +
                roleBlock(role, secret, 'absent'),
            )
          : cy.replace(present, '');
      } else {
        // Not found: re-run after a previous close, or a drifted manual
        // registration. Log loudly, proceed (the PR still removes the dir).
        ctx.logger.warn(
          `db-deprovision: managed.roles block for ${role} not found in ` +
            `${clusterYamlPath} — no cluster.yaml change will ride the PR. ` +
            `If this is the FIRST close of this app, inspect cluster.yaml ` +
            `manually (drifted entry?).`,
        );
      }
      const changed = next !== cy;
      if (changed) await writeFile(abs, next);
      ctx.output('changed', changed);
    },
  });

export const createDbDropPrepareAction = () =>
  createTemplateAction({
    id: 'nezam:tenant:db-drop-prepare',
    description:
      'Insert databaseReclaimPolicy: delete into every Database doc of the ' +
      'fetched tenant database.yaml (phase 1 of the two-phase DB drop).',
    schema: {
      input: { databaseYamlPath: z => z.string() },
      output: { changed: z => z.boolean() },
    },
    async handler(ctx) {
      const abs = resolveSafeChildPath(
        ctx.workspacePath,
        ctx.input.databaseYamlPath,
      );
      const raw = await readFile(abs, 'utf8');
      const docs = raw.split(/^---$/m).map(doc => {
        if (!/kind:\s*Database\b/.test(doc)) return doc;
        if (/databaseReclaimPolicy:/.test(doc)) return doc; // idempotent
        return `${doc.replace(/\s*$/, '')}\n  databaseReclaimPolicy: delete\n`;
      });
      const next = docs.join('---');
      const changed = next !== raw;
      if (changed) await writeFile(abs, next);
      ctx.output('changed', changed);
    },
  });
