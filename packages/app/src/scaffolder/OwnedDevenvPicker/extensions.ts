import { scaffolderPlugin } from '@backstage/plugin-scaffolder';
import { createScaffolderFieldExtension } from '@backstage/plugin-scaffolder-react';
import {
  OwnedDevenvPicker,
  ownedDevenvPickerValidation,
} from './OwnedDevenvPicker';

/**
 * Custom scaffolder field extension `OwnedDevenvPicker` (050 — close-devenv).
 *
 * Lists the dev environments the signed-in user owns (Resource /
 * dev-environment) and yields the bare env name.
 */
export const OwnedDevenvPickerExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    name: 'OwnedDevenvPicker', // MUST match ui:field in close-devenv template
    component: OwnedDevenvPicker,
    validation: ownedDevenvPickerValidation,
  }),
);
