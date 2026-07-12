/*
 * Custom scaffolder action: nezam:assert:maxLength
 *
 * Why this exists (027 T4 — Issue 1, role-length parity):
 * The create-app template derives a Postgres role of the form
 *   <owner>_<appName>   (owner from the RepoUrlPicker, appName a form field;
 *                        dashes → underscores — see template.yaml step 6 and
 *                        skeleton-tenant/database.yaml's `owner:` field).
 * The platform's scripts/register-tenant.sh HARD-FAILS when that role exceeds
 * 55 characters. The form can only bound `appName` (maxLength 40) — it cannot
 * see the variable-length `owner`, so a long username + long app name can
 * compose a role > 55 chars that the scaffolder would happily stamp into the
 * tenant PR, only to fail MUCH later when register-tenant.sh (or CNPG) rejects
 * the role.
 *
 * Backstage's built-in action set has no "assert/fail" primitive, so this tiny
 * sibling action throws a clear Error at scaffold time (the FIRST template
 * step, before any repo is created) when a supplied string is longer than a
 * supplied limit. Zero new dependencies — pure JS throw — reusing the exact
 * createTemplateAction + scaffolderActionsExtensionPoint registration pattern
 * as modules/scaffolderReplace.ts.
 */
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';

export const createAssertMaxLengthAction = () =>
  createTemplateAction({
    id: 'nezam:assert:maxLength',
    description:
      'Fail the scaffold FAST if `value` is longer than `max` characters. ' +
      'Used to mirror register-tenant.sh’s 55-char Postgres-role limit on ' +
      'the composed <owner>_<appName> role, which no single form field can ' +
      'bound (owner comes from the RepoUrlPicker, not a typed field).',
    schema: {
      input: {
        value: z => z.string().describe('the composed string to length-check'),
        max: z =>
          z
            .number()
            .int()
            .positive()
            .describe('maximum allowed length (inclusive)'),
        message: z =>
          z
            .string()
            .optional()
            .describe(
              'optional human-readable label for `value` used in the error ' +
                'message (e.g. "Postgres role")',
            ),
      },
      output: {
        length: z => z.number(),
      },
    },
    async handler(ctx) {
      const { value, max, message } = ctx.input;
      const label = message ?? 'value';

      if (value.length > max) {
        throw new Error(
          `${label} "${value}" is ${value.length} characters, which exceeds ` +
            `the ${max}-character limit. Shorten the app name and try again.`,
        );
      }

      ctx.logger.info(
        `nezam:assert:maxLength — ${label} is ${value.length}/${max} chars — OK`,
      );
      ctx.output('length', value.length);
    },
  });
