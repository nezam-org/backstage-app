/*
 * Custom scaffolder action: nezam:k8s:wait-db-reclaim (032 — close-app,
 * DB-drop phase 1 barrier).
 *
 * Polls the LIVE tenant Database CRs (pod ServiceAccount, read-only — NEVER a
 * mutation) until both carry spec.databaseReclaimPolicy: delete (Flux has
 * applied the prepare PR) or are already gone, so phase 2 can never delete a
 * retain-policy CR. Timeout FAILS the run BEFORE anything is deleted; RBAC
 * (401/403) and sustained 5xx fail FAST with the real cause instead of
 * blaming Flux. Node https against the in-cluster API — no new deps.
 *
 * RBAC: backstage-read-only ClusterRole already grants get/list/watch on
 * databases.postgresql.cnpg.io (027 T3) — zero RBAC change.
 */
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { readFile } from 'node:fs/promises';
import https from 'node:https';

const SA = '/var/run/secrets/kubernetes.io/serviceaccount';

function getJson(
  path: string,
  token: string,
  ca: Buffer,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: 'kubernetes.default.svc',
        path,
        ca,
        headers: { Authorization: `Bearer ${token}` },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          let body: any;
          try {
            body = data ? JSON.parse(data) : undefined;
          } catch {
            body = undefined; // non-JSON error page — status is enough
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

export const createWaitDbReclaimAction = () =>
  createTemplateAction({
    id: 'nezam:k8s:wait-db-reclaim',
    description:
      'Poll (read-only, pod SA) until both tenant Database CRs in ns appdb ' +
      'show spec.databaseReclaimPolicy=delete (Flux has applied phase 1) or ' +
      'are already absent. Timeout FAILS the run BEFORE anything is deleted; ' +
      '401/403 (RBAC) and sustained 5xx fail FAST with the real cause.',
    schema: {
      input: {
        user: z => z.string(),
        app: z => z.string(),
        timeoutSeconds: z => z.number().optional(),
      },
      output: {},
    },
    async handler(ctx) {
      const { user, app } = ctx.input;
      const timeout = (ctx.input.timeoutSeconds ?? 600) * 1000;
      const token = await readFile(`${SA}/token`, 'utf8');
      const ca = await readFile(`${SA}/ca.crt`);
      const names = [`${user}-${app}-staging`, `${user}-${app}-prod`];
      const deadline = Date.now() + timeout;
      let serverErrorPolls = 0;
      for (;;) {
        const states = await Promise.all(
          names.map(n =>
            getJson(
              `/apis/postgresql.cnpg.io/v1/namespaces/appdb/databases/${n}`,
              token,
              ca,
            ),
          ),
        );
        // Fail FAST on RBAC breakage — polling 401/403 to the timeout would
        // emit a misleading "waiting for Flux" error and send the operator
        // to debug the wrong subsystem.
        const denied = states.find(s => s.status === 401 || s.status === 403);
        if (denied) {
          throw new Error(
            `wait-db-reclaim: Kubernetes API returned ${denied.status} — ` +
              'the backstage pod ServiceAccount can no longer read Database ' +
              'CRs. This is an RBAC regression, NOT a Flux delay: check the ' +
              'backstage-read-only ClusterRole (get/list/watch on ' +
              'databases.postgresql.cnpg.io, 027 T3) and its binding to the ' +
              'backstage pod SA. NOTHING has been deleted.',
          );
        }
        // API-server trouble: tolerate blips, fail after ~1 min of straight
        // 5xx instead of burning the full timeout.
        if (states.some(s => s.status >= 500)) {
          serverErrorPolls += 1;
          if (serverErrorPolls >= 4) {
            throw new Error(
              'wait-db-reclaim: Kubernetes API kept failing (statuses ' +
                `${states.map(s => s.status).join('/')}) across ` +
                `${serverErrorPolls} consecutive polls — API-server trouble, ` +
                'NOT a Flux delay. NOTHING has been deleted.',
            );
          }
        } else {
          serverErrorPolls = 0;
        }
        const ok = states.every(
          s =>
            s.status === 404 || // already gone (re-run)
            (s.status === 200 &&
              s.body?.spec?.databaseReclaimPolicy === 'delete'),
        );
        if (ok) {
          ctx.logger.info('wait-db-reclaim: reclaim policy live on both CRs');
          return;
        }
        if (Date.now() > deadline) {
          throw new Error(
            'wait-db-reclaim: timed out waiting for Flux to apply ' +
              'databaseReclaimPolicy=delete. NOTHING has been deleted — ' +
              'check `flux get kustomizations tenants` and re-run close.',
          );
        }
        await new Promise(r => setTimeout(r, 15000));
      }
    },
  });
