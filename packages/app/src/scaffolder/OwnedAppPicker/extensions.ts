import { scaffolderPlugin } from '@backstage/plugin-scaffolder';
import { createScaffolderFieldExtension } from '@backstage/plugin-scaffolder-react';
import { OwnedAppPicker, ownedAppPickerValidation } from './OwnedAppPicker';

/**
 * Custom scaffolder field extension `OwnedAppPicker` (032 — close-app).
 *
 * Lists the Component apps the signed-in user owns and yields the bare app
 * name (== repo == tenant dir). Used by the close-app template's `app` field.
 */
export const OwnedAppPickerExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    name: 'OwnedAppPicker', // MUST match ui:field in close-app template
    component: OwnedAppPicker,
    validation: ownedAppPickerValidation,
  }),
);
