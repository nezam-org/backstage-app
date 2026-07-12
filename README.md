# backstage-app

The Nezam developer portal — a [Backstage](https://backstage.io) app
(release line **1.52.x**, legacy frontend system) that serves as the UI over
the Nezam platform. The platform machine (tenancy contract, GitOps, CNPG)
lives in the platform repo and stays the only writer; this portal drives it.

- **Phase 1 (current):** tailnet-only at `backstage.<tailnet>.ts.net`,
  invite-gated via a GitHub-username allowlist.
- **Phase 2 (later):** public at `portal.nezam.site`.

## How this deploys

CI on `main` builds and pushes a container image:

```
ghcr.io/nezam-org/backstage-app:main-<shortsha>   (immutable)
ghcr.io/nezam-org/backstage-app:latest            (convenience)
```

There is **no writeback**: the deployed tag is pinned by hand in the platform
repo at `k8s/apps/backstage/` (HelmRelease on the community `backstage` chart
with `postgresql.enabled=false`, this image, extra app-config via ConfigMap,
env from Secrets) and reconciled by Flux. Database is the `backstage`
database on the shared CNPG cluster, provisioned by a CNPG `Database` CR —
the app never creates databases (`ensureExists: false`), only its per-plugin
schemas (`pluginDivisionMode: schema`).

## The two GitHub credentials (do not confuse them)

| | GitHub **OAuth app** (`Nezam Platform OAuth`) | GitHub **App** (`nezam-platform`) |
|---|---|---|
| Purpose | User **sign-in** (AuthN) | **Repo actions**: scaffolder publish, catalog reads |
| Config | `auth.providers.github.development` in `app-config.yaml` | `integrations.github[].apps` in `app-config.production.yaml` |
| Env vars | `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` (full PEM), `GITHUB_APP_WEBHOOK_SECRET` |
| Notes | One callback URL per OAuth app → phase 2 needs OAuth app #2 | Never gets `Contents: write` on user installations; platform-repo writes use a separate internal credential |

Sign-in is allowlisted: the `usernameMatchingUserEntityName` resolver only
admits GitHub usernames that exist as `User` entities, ingested from the
platform repo (`k8s/portal/allowlist-users.yaml`). There is deliberately no
`dangerouslyAllowSignInWithoutUserInCatalog`.

## Runtime environment variables

| Variable | Meaning |
|---|---|
| `APP_BASE_URL` | Public base URL of the portal (phase 1: tailnet URL) — used for both `app.baseUrl` and `backend.baseUrl` |
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | shared-pg connection (`POSTGRES_DB=backstage`) |
| (CA file) | CNPG cluster CA mounted at `/etc/cnpg/ca.crt` |
| `GITHUB_OAUTH_*`, `GITHUB_APP_*` | See table above |

Kubernetes plugin runs in-cluster: `authProvider: serviceAccount` with no
token configured → uses the pod's mounted service account (read-only
ClusterRole bound in the platform repo).

## Local development

Requires Node 22 or 24 and yarn 4 (via corepack).

```sh
yarn install
export GITHUB_OAUTH_CLIENT_ID=... GITHUB_OAUTH_CLIENT_SECRET=...
yarn start
```

`yarn start` uses `app-config.yaml` (+ `app-config.local.yaml` if present,
gitignored) — SQLite in-memory DB, example catalog data, GitHub sign-in.

## Building the image locally

Host-build pattern (same as CI):

```sh
yarn install --immutable
yarn tsc
yarn build:backend
docker build -f packages/backend/Dockerfile -t backstage-app .
```
