import { scaffolderPlugin } from '@backstage/plugin-scaffolder';
import { createScaffolderFieldExtension } from '@backstage/plugin-scaffolder-react';
import {
  GithubRepoTokenField,
  githubRepoTokenValidation,
} from './GithubRepoTokenField';

/**
 * Custom scaffolder field extension `GithubRepoToken`.
 *
 * Mints a GitHub user OAuth token (repo + workflow scope) and injects it as
 * the scaffolder secret ${{ secrets.USER_OAUTH_TOKEN }}. Used by the
 * create-app template's publish:github step to create + push the user's new
 * repo in their OWN account, now that the RepoUrlPicker (which used to supply
 * this token via requestUserCredentials) has been removed.
 */
export const GithubRepoTokenFieldExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    name: 'GithubRepoToken',
    component: GithubRepoTokenField,
    validation: githubRepoTokenValidation,
  }),
);
