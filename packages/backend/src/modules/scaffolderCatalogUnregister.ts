/*
 * Custom scaffolder action: nezam:catalog:unregister (032 — close-app, the
 * 07-18 ghost-entry fix).
 *
 * Removes the app from the portal catalog via the catalog API: delete its
 * registered location (API path — safe: DefaultLocationStore.deleteLocation
 * applies a `removed` delta to the processing engine, so the in-memory store
 * stays consistent; the 07-18 "needs restart" trap is DB-row-surgery-only),
 * then the Component entity itself (immediate; orphanStrategy=delete would get
 * it eventually via the location deletion). Ownership-guarded server-side:
 * refuses entities whose spec.owner is not the initiator (the picker only
 * LISTS owned apps, but a crafted request must still be rejected).
 */
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import type { CatalogService } from '@backstage/plugin-catalog-node';

export const createCatalogUnregisterAction = (options: {
  catalog: CatalogService;
}) => {
  const { catalog } = options;
  return createTemplateAction({
    id: 'nezam:catalog:unregister',
    description:
      'Remove the app from the portal catalog: delete its registered ' +
      'location (API path — safe, updates DefaultLocationStore in-memory; ' +
      'the 07-18 restart trap is DB-surgery-only) then the Component entity ' +
      'itself (immediate; orphanStrategy delete would get it eventually). ' +
      'Ownership-guarded: refuses entities not owned by the initiator.',
    schema: {
      input: {
        app: z => z.string(),
        expectedOwner: z =>
          z.string().describe('signed-in login — spec.owner must match'),
      },
      output: { removed: z => z.boolean() },
    },
    async handler(ctx) {
      const { app, expectedOwner } = ctx.input;
      const credentials = await ctx.getInitiatorCredentials();
      const entityRef = `component:default/${app}`;
      const { items } = await catalog.getEntitiesByRefs(
        { entityRefs: [entityRef] },
        { credentials },
      );
      const entity = items[0];
      if (!entity) {
        ctx.logger.info(
          `unregister: ${entityRef} not in catalog — nothing to do`,
        );
        ctx.output('removed', false);
        return;
      }
      const owner = String((entity.spec as any)?.owner ?? '');
      if (
        owner !== expectedOwner &&
        owner !== `user:default/${expectedOwner}` &&
        owner !== `user:${expectedOwner}`
      ) {
        // The catalog namespace is flat — without this, any allowlisted user
        // could unregister a foreign app by typing its name into a crafted
        // request (the form only LISTS owned apps; the API must ENFORCE it).
        throw new Error(
          `unregister: ${entityRef} is owned by "${owner}", not the ` +
            `signed-in user — refusing.`,
        );
      }
      const location = await catalog
        .getLocationByEntity(entityRef, { credentials })
        .catch(() => undefined);
      if (location) {
        await catalog.removeLocationById(location.id, { credentials });
        ctx.logger.info(
          `unregister: removed location ${location.id} (${location.target})`,
        );
      }
      if (entity.metadata.uid) {
        await catalog.removeEntityByUid(entity.metadata.uid, { credentials });
      }
      ctx.output('removed', true);
    },
  });
};
