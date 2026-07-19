/*
 * Backend module that registers the custom nezam scaffolder actions:
 *   - nezam:fs:replace              — literal placeholder substitution
 *   - nezam:assert:maxLength        — fail-fast length guard (role-length parity)
 *   - nezam:assert:equals           — typed-name confirmation gate (032 close-app)
 *   - nezam:github:deploy-automation — enable Actions-can-create-PRs + write
 *                                      workflow permissions on the new repo
 *                                      (trunk-based deploy-PR flow, 031)
 *   - nezam:tenant:db-provision     — 037 tenant DB role + sops secrets
 *   - nezam:github:merge-pr         — ADR-028 bot auto-merge
 *   Close-app (032):
 *   - nezam:tenant:remove-plan      — enumerate the removal-PR file list
 *   - nezam:tenant:db-deprovision   — inverse of db-provision (retain/drop)
 *   - nezam:tenant:db-drop-prepare  — phase-1 reclaimPolicy=delete flip
 *   - nezam:k8s:wait-db-reclaim     — read-only barrier before CR deletion
 *   - nezam:catalog:unregister      — remove the app from the portal catalog
 *   - nezam:github:repo-close       — archive/delete the user's own repo
 * (New backend system — extends the scaffolder plugin via its actions
 * extension point.)
 */
import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { ScmIntegrations } from '@backstage/integration';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { createReplaceAction } from './scaffolderReplace';
import {
  createAssertMaxLengthAction,
  createAssertEqualsAction,
} from './scaffolderAssert';
import { createDeployAutomationAction } from './scaffolderDeployAutomation';
import { createDbProvisionAction } from './scaffolderDbProvision';
import { createMergePrAction } from './scaffolderMergePr';
import { createRemovePlanAction } from './scaffolderRemovePlan';
import {
  createDbDeprovisionAction,
  createDbDropPrepareAction,
} from './scaffolderDbDeprovision';
import { createWaitDbReclaimAction } from './scaffolderWaitDbReclaim';
import { createCatalogUnregisterAction } from './scaffolderCatalogUnregister';
import { createRepoCloseAction } from './scaffolderRepoClose';

export const scaffolderModuleNezamReplace = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'nezam-replace',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        config: coreServices.rootConfig,
        catalog: catalogServiceRef,
      },
      async init({ scaffolder, config, catalog }) {
        const integrations = ScmIntegrations.fromConfig(config);
        scaffolder.addActions(
          createReplaceAction(),
          createAssertMaxLengthAction(),
          createDeployAutomationAction(),
          createDbProvisionAction(),
          createMergePrAction({ integrations }),
          // Close-app (032):
          createAssertEqualsAction(),
          createRemovePlanAction({ integrations }),
          createDbDeprovisionAction(),
          createDbDropPrepareAction(),
          createWaitDbReclaimAction(),
          createCatalogUnregisterAction({ catalog }),
          createRepoCloseAction(),
        );
      },
    });
  },
});
