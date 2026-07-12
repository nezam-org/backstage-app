/*
 * Backend module that registers the custom nezam scaffolder actions:
 *   - nezam:fs:replace       — literal placeholder substitution
 *   - nezam:assert:maxLength — fail-fast length guard (role-length parity)
 * (New backend system — extends the scaffolder plugin via its actions
 * extension point.)
 */
import { createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { createReplaceAction } from './scaffolderReplace';
import { createAssertMaxLengthAction } from './scaffolderAssert';

export const scaffolderModuleNezamReplace = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'nezam-replace',
  register(env) {
    env.registerInit({
      deps: { scaffolder: scaffolderActionsExtensionPoint },
      async init({ scaffolder }) {
        scaffolder.addActions(
          createReplaceAction(),
          createAssertMaxLengthAction(),
        );
      },
    });
  },
});
