/*
 * Backend module that registers the nezam:fs:replace scaffolder action.
 * (New backend system — extends the scaffolder plugin via its actions
 * extension point.)
 */
import { createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { createReplaceAction } from './scaffolderReplace';

export const scaffolderModuleNezamReplace = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'nezam-replace',
  register(env) {
    env.registerInit({
      deps: { scaffolder: scaffolderActionsExtensionPoint },
      async init({ scaffolder }) {
        scaffolder.addActions(createReplaceAction());
      },
    });
  },
});
