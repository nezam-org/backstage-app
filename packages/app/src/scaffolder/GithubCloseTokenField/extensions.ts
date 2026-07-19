import { scaffolderPlugin } from '@backstage/plugin-scaffolder';
import { createScaffolderFieldExtension } from '@backstage/plugin-scaffolder-react';
import {
  GithubCloseTokenField,
  githubCloseTokenValidation,
} from './GithubCloseTokenField';

/**
 * Custom scaffolder field extension `GithubCloseToken` (032 — close-app).
 *
 * Mints a GitHub user OAuth token scoped to the chosen repo action (archive →
 * repo, delete → repo+delete_repo) and injects it as the scaffolder secret
 * ${{ secrets.USER_OAUTH_TOKEN }} for nezam:github:repo-close.
 */
export const GithubCloseTokenFieldExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    name: 'GithubCloseToken', // MUST match ui:field in close-app template
    component: GithubCloseTokenField,
    validation: githubCloseTokenValidation,
  }),
);
