/*
 * Custom scaffolder action: nezam:fs:replace
 *
 * Why this exists (027 T4 templating decision — option C):
 * The scaffold template (nezam-org/template-fastapi-react) is the SINGLE
 * source of truth for a new app. It personalises itself with LITERAL
 * placeholders __USER__ / __APP__ substituted by `sed` in its scripts/init.sh
 * — NOT with Backstage's nunjucks `${{ }}` syntax. The scaffolder's
 * `fetch:template` renders nunjucks, so it cannot consume those placeholders,
 * and converting the template to nunjucks would fork the scaffold (two sources
 * of truth, drift risk). Instead the portal does exactly what init.sh does:
 *   fetch:plain the template verbatim (no templating engine touches it)
 *     → nezam:fs:replace does the literal __USER__/__APP__ substitution
 *       → publish:github creates the repo in the user's account.
 *
 * We deliberately do NOT pull the roadiehq utils plugin for one sed-equivalent:
 * the app was trimmed to shrink RAM + supply-chain surface (see 027 log,
 * commit 3370cb0). A ~40-line in-repo action is more auditable and adds no
 * external dependency.
 *
 * The action walks the workspace, applies each {find → replaceWith} pair as a
 * global LITERAL (non-regex) replacement across every text file, and reports
 * how many files changed. Binary files are skipped by a NUL-byte heuristic.
 */
import { resolveSafeChildPath } from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { readFile, writeFile } from 'node:fs/promises';
import { glob } from 'glob';

/** Escape a literal string for use inside a RegExp (so `.` etc. are inert). */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const createReplaceAction = () =>
  createTemplateAction({
    id: 'nezam:fs:replace',
    description:
      'Literal (non-regex) find/replace of placeholder tokens across all ' +
      'text files in the workspace — the scaffolder equivalent of the ' +
      'template repo scripts/init.sh sed pass.',
    schema: {
      input: {
        replacements: z =>
          z
            .array(
              z.object({
                find: z.string().describe('literal token to find'),
                replaceWith: z
                  .string()
                  .describe('literal string to substitute'),
              }),
            )
            .describe(
              'ordered list of literal substitutions applied to every text ' +
                'file; ORDER MATTERS for overlapping tokens (compound token ' +
                'first, e.g. __USER_____APP__ before __USER__).',
            ),
        // Optional glob (relative to the workspace) to scope the pass; defaults
        // to every file. Kept simple: the template repo is small.
        globPattern: z =>
          z
            .string()
            .optional()
            .describe(
              'optional glob (relative to workspace) limiting which files are ' +
                'scanned; defaults to all files',
            ),
      },
      output: {
        filesChanged: z => z.number(),
      },
    },
    async handler(ctx) {
      const { replacements, globPattern } = ctx.input;

      const matches = await glob(globPattern ?? '**/*', {
        cwd: ctx.workspacePath,
        nodir: true,
        dot: true,
        ignore: ['.git/**'],
      });

      let filesChanged = 0;
      for (const rel of matches) {
        const abs = resolveSafeChildPath(ctx.workspacePath, rel);
        const buf = await readFile(abs);
        // Skip binaries: a NUL byte is the standard "not text" heuristic.
        if (buf.includes(0)) {
          continue;
        }
        const original = buf.toString('utf8');
        let next = original;
        for (const { find, replaceWith } of replacements) {
          next = next.replace(new RegExp(escapeRegExp(find), 'g'), replaceWith);
        }
        if (next !== original) {
          await writeFile(abs, next, 'utf8');
          filesChanged += 1;
          ctx.logger.info(`nezam:fs:replace — updated ${rel}`);
        }
      }

      ctx.logger.info(
        `nezam:fs:replace — ${filesChanged} file(s) changed by ${replacements.length} replacement(s)`,
      );
      ctx.output('filesChanged', filesChanged);
    },
  });
