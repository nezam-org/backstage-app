import { useEffect, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { scmAuthApiRef } from '@backstage/integration-react';
import {
  useTemplateSecrets,
  type CustomFieldValidator,
  type FieldExtensionComponentProps,
} from '@backstage/plugin-scaffolder-react';
import FormControl from '@material-ui/core/FormControl';
import FormHelperText from '@material-ui/core/FormHelperText';
import Typography from '@material-ui/core/Typography';

/**
 * Custom scaffolder field (032 — close-app): mints a GitHub user OAuth token
 * scoped to the chosen repo action and injects it as the scaffolder secret
 * ${{ secrets.USER_OAUTH_TOKEN }} so nezam:github:repo-close can archive or
 * delete the user's OWN repository (ADR-026: their property, their token).
 *
 * Mechanism mirrors GithubRepoTokenField 1:1 (scmAuthApi.getCredentials +
 * additionalScope.customScopes). Scope behaviour (honest): the field mounts
 * in archive mode and mints `repo`; flipping to delete refetches with
 * `delete_repo` added — scm-auth sessions UNION scopes, so the delete-mode
 * token carries repo+delete_repo (and flipping BACK to archive does not shed
 * delete_repo from the session). Mode-minimal means only: archive mode never
 * REQUESTS delete_repo. Delete mode requests ['repo','delete_repo'] explicitly
 * (matches the effective union; avoids a mount-race on a fast flip).
 */
export const GITHUB_CLOSE_TOKEN_SECRET = 'USER_OAUTH_TOKEN';

const scopesFor = (repoAction: unknown): string[] =>
  repoAction === 'delete' ? ['repo', 'delete_repo'] : ['repo'];

export const GithubCloseTokenField = (
  props: FieldExtensionComponentProps<void>,
) => {
  const scmAuthApi = useApi(scmAuthApiRef);
  const { setSecrets } = useTemplateSecrets();
  const [error, setError] = useState<string | undefined>();
  const [ready, setReady] = useState(false);
  // Stepper passes the page's formData in formContext (verified installed
  // plugin-scaffolder source) — read the sibling repoAction field from it.
  const repoAction: string =
    (props.formContext as { formData?: { repoAction?: string } } | undefined)
      ?.formData?.repoAction ?? 'archive';

  useEffect(() => {
    // Refetch whenever the archive/delete choice changes: delete needs
    // delete_repo on top. Sessions UNION scopes — no scope is ever shed.
    let cancelled = false;
    setReady(false);
    (async () => {
      try {
        const { token } = await scmAuthApi.getCredentials({
          url: 'https://github.com',
          additionalScope: {
            customScopes: { github: scopesFor(repoAction) },
          },
        });
        if (!cancelled) {
          setSecrets({ [GITHUB_CLOSE_TOKEN_SECRET]: token });
          setReady(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            `Could not get GitHub access: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scmAuthApi, repoAction]);

  return (
    <FormControl margin="normal" error={Boolean(error)}>
      <Typography variant="body2">
        {ready
          ? repoAction === 'delete'
            ? 'GitHub connected — your repository will be PERMANENTLY deleted.'
            : 'GitHub connected — your repository will be archived (reversible).'
          : 'Connecting to GitHub…'}
      </Typography>
      {error && <FormHelperText>{error}</FormHelperText>}
    </FormControl>
  );
};

/**
 * Blocks submission until a token with the mode's scopes is obtainable.
 * The validator context DOES carry formData (verified in the installed
 * plugin-scaffolder-react CustomFieldValidator type: `formData: JsonObject`)
 * — so it validates with the REAL mode's scopes, not a fallback. Session is
 * cached from the mount fetch → no second consent popup.
 */
export const githubCloseTokenValidation: CustomFieldValidator<void> = async (
  _data,
  field,
  { apiHolder, formData },
) => {
  const scmAuthApi = apiHolder.get(scmAuthApiRef);
  if (!scmAuthApi) {
    field.addError('GitHub auth is not available.');
    return;
  }
  try {
    const { token } = await scmAuthApi.getCredentials({
      url: 'https://github.com',
      additionalScope: {
        customScopes: { github: scopesFor(formData?.repoAction) },
      },
    });
    if (!token) {
      field.addError('Still connecting to GitHub — try again in a moment.');
    }
  } catch (e) {
    field.addError(
      `Could not get GitHub access: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
};
