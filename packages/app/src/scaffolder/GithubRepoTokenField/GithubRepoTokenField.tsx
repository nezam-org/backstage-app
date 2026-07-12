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
 * Custom scaffolder field: obtains a GitHub user OAuth token carrying
 * `repo` + `workflow` scope and injects it as the scaffolder secret
 * ${{ secrets.USER_OAUTH_TOKEN }} so the publish:github step can create +
 * push the user's new repository in THEIR OWN account.
 *
 * Why this exists: the create-app template used to carry a RepoUrlPicker
 * purely so its `requestUserCredentials` could mint that token. We removed the
 * picker (it let the user type a repo name that could diverge from the app
 * name — the exact bug this change fixes). This field replaces ONLY the
 * credential-minting behaviour; the app/repo name is now a single `appName`
 * field and the owner is auto-derived from the signed-in user.
 *
 * Mechanism mirrors RepoUrlPicker's internal credential fetch 1:1:
 *   scmAuthApi.getCredentials({ url, additionalScope:{ repoWrite:true,
 *     customScopes:{ github:[repo,workflow] } } }) → setSecrets(...)
 * so the same host/scope/consent flow applies (github.com, repo+workflow).
 *
 *   repo     — create + push the user's new repository.
 *   workflow — the batteries-included scaffold ships .github/workflows/ci.yaml;
 *              GitHub refuses to let an OAuth token push ANY file under
 *              .github/workflows/ without this scope.
 */
export const GITHUB_REPO_TOKEN_SECRET = 'USER_OAUTH_TOKEN';

export const GithubRepoTokenField = (
  _props: FieldExtensionComponentProps<void>,
) => {
  const scmAuthApi = useApi(scmAuthApiRef);
  const { secrets, setSecrets } = useTemplateSecrets();
  const [error, setError] = useState<string | undefined>();
  const ready = Boolean(secrets[GITHUB_REPO_TOKEN_SECRET]);

  useEffect(() => {
    // Fetch once; the token is cached in the secrets context for the rest of
    // the run. Mirrors RepoUrlPicker's requestUserCredentials fetch — same
    // github.com host, same repo+workflow scopes, same one-time consent popup.
    if (secrets[GITHUB_REPO_TOKEN_SECRET]) {
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const { token } = await scmAuthApi.getCredentials({
          url: 'https://github.com',
          additionalScope: {
            repoWrite: true,
            customScopes: {
              github: ['repo', 'workflow'],
            },
          },
        });
        if (!cancelled) {
          setSecrets({ [GITHUB_REPO_TOKEN_SECRET]: token });
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
  }, [scmAuthApi]);

  return (
    <FormControl margin="normal" error={Boolean(error)}>
      <Typography variant="body2">
        {ready
          ? 'GitHub connected — your new repository will be created in your account.'
          : 'Connecting to GitHub to create the repository in your account…'}
      </Typography>
      {error && <FormHelperText>{error}</FormHelperText>}
    </FormControl>
  );
};

/**
 * Field-level validation: block form submission until the token secret is
 * actually in the scaffolder secrets context, so publish:github never runs
 * without credentials. The validator can't read the secrets context directly,
 * so it re-derives the token via scmAuthApi (already cached from the mount
 * fetch → no second consent popup) and confirms one is obtainable.
 */
export const githubRepoTokenValidation: CustomFieldValidator<void> = async (
  _data,
  field,
  { apiHolder },
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
        repoWrite: true,
        customScopes: { github: ['repo', 'workflow'] },
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
