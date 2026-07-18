/*
 * Backend module that registers the custom nezam scaffolder actions:
 *   - nezam:fs:replace              — literal placeholder substitution
 *   - nezam:assert:maxLength        — fail-fast length guard (role-length parity)
 *   - nezam:github:deploy-automation — enable Actions-can-create-PRs + write
 *                                      workflow permissions on the new repo
 *                                      (trunk-based deploy-PR flow, 031)
 * (New backend system — extends the scaffolder plugin via its actions
 * extension point.)
 */
import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { ScmIntegrations } from '@backstage/integration';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { createReplaceAction } from './scaffolderReplace';
import { createAssertMaxLengthAction } from './scaffolderAssert';
import { createDeployAutomationAction } from './scaffolderDeployAutomation';
import { createDbProvisionAction } from './scaffolderDbProvision';
import { createMergePrAction } from './scaffolderMergePr';

export const scaffolderModuleNezamReplace = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'nezam-replace',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        config: coreServices.rootConfig,
      },
      async init({ scaffolder, config }) {
        const integrations = ScmIntegrations.fromConfig(config);
        scaffolder.addActions(
          createReplaceAction(),
          createAssertMaxLengthAction(),
          createDeployAutomationAction(),
          createDbProvisionAction(),
          createMergePrAction({ integrations }),
        );
      },
    });
  },
});
