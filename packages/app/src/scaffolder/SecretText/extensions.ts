import { scaffolderPlugin } from '@backstage/plugin-scaffolder';
import { createScaffolderFieldExtension } from '@backstage/plugin-scaffolder-react';
import { SecretText } from './SecretText';

/**
 * `SecretText` field extension (050 F2). Masked input that stashes its value
 * in the scaffolder secrets context (ui:options.secretKey) instead of the
 * persisted form data — for the user's BYO backup credentials.
 */
export const SecretTextExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    name: 'SecretText',
    component: SecretText,
  }),
);
