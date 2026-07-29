import { useEffect, useState } from 'react';
import { identityApiRef, useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { parseEntityRef } from '@backstage/catalog-model';
import type { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import FormControl from '@material-ui/core/FormControl';
import FormHelperText from '@material-ui/core/FormHelperText';
import InputLabel from '@material-ui/core/InputLabel';
import MenuItem from '@material-ui/core/MenuItem';
import Select from '@material-ui/core/Select';

/**
 * Custom scaffolder field: lists the dev environments the SIGNED-IN user owns
 * (Resource entities with spec.type dev-environment, 050) and yields the bare
 * ENV name (entity name is <user>-<env>-devenv; the template needs "<env>").
 *
 * Copy-adapted from OwnedAppPicker (032). Ownership stays ENFORCED
 * server-side (nezam:catalog:unregister + remove-plan's user-rooted paths) —
 * this picker is only the convenience listing.
 */
export const OwnedDevenvPicker = (
  props: FieldExtensionComponentProps<string>,
) => {
  const { onChange, formData, rawErrors } = props;
  const catalogApi = useApi(catalogApiRef);
  const identityApi = useApi(identityApiRef);
  const [envs, setEnvs] = useState<string[] | undefined>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const identity = await identityApi.getBackstageIdentity();
        const login = parseEntityRef(identity.userEntityRef).name;
        const { items } = await catalogApi.getEntities({
          filter: {
            kind: 'Resource',
            'spec.type': 'dev-environment',
            'spec.owner': [
              login,
              `user:default/${login}`,
              `group:default/${login}`,
            ],
          },
          fields: ['metadata.name'],
        });
        const prefix = `${login}-`;
        const names = items
          .map(e => e.metadata.name)
          .filter(n => n.startsWith(prefix) && n.endsWith('-devenv'))
          .map(n => n.slice(prefix.length, -'-devenv'.length))
          .sort();
        if (!cancelled) setEnvs(names);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <FormControl
      margin="normal"
      required
      error={(rawErrors?.length ?? 0) > 0 || Boolean(error)}
      fullWidth
    >
      <InputLabel htmlFor="owned-devenv">Environment to close</InputLabel>
      <Select
        id="owned-devenv"
        value={formData ?? ''}
        onChange={e => onChange(e.target.value as string)}
      >
        {(envs ?? []).map(name => (
          <MenuItem key={name} value={name}>
            {name}
          </MenuItem>
        ))}
      </Select>
      <FormHelperText>
        {error ??
          (envs && envs.length === 0
            ? 'You have no dev environments.'
            : 'Only environments YOU own are listed.')}
      </FormHelperText>
    </FormControl>
  );
};

export const ownedDevenvPickerValidation = (
  value: string,
  validation: { addError: (msg: string) => void },
) => {
  if (!value) validation.addError('Pick the environment to close.');
};
