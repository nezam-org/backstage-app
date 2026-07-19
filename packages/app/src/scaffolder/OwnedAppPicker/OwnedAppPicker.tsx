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
 * Custom scaffolder field: lists the Component apps the SIGNED-IN user owns
 * (catalog getEntities filtered on spec.owner == login) and yields the bare
 * app NAME (== repo == tenant dir) as the field value.
 *
 * Why custom (not EntityPicker): EntityPicker's catalogFilter cannot template
 * the current user, and we need the bare-name value. Ownership is also
 * ENFORCED server-side in nezam:catalog:unregister — this picker is only the
 * convenience listing.
 */
export const OwnedAppPicker = (
  props: FieldExtensionComponentProps<string>,
) => {
  const { onChange, formData, rawErrors } = props;
  const catalogApi = useApi(catalogApiRef);
  const identityApi = useApi(identityApiRef);
  const [apps, setApps] = useState<string[] | undefined>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const identity = await identityApi.getBackstageIdentity();
        const login = parseEntityRef(identity.userEntityRef).name;
        // spec.owner is stamped as the bare login by the scaffolded
        // catalog-info.yaml; match raw string + entity-ref spellings.
        const { items } = await catalogApi.getEntities({
          filter: {
            kind: 'Component',
            'spec.owner': [
              login,
              `user:default/${login}`,
              `group:default/${login}`,
            ],
          },
          fields: ['metadata.name'],
        });
        if (!cancelled) setApps(items.map(e => e.metadata.name).sort());
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : String(e));
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
      <InputLabel htmlFor="owned-app">App to close</InputLabel>
      <Select
        id="owned-app"
        value={formData ?? ''}
        onChange={e => onChange(e.target.value as string)}
      >
        {(apps ?? []).map(name => (
          <MenuItem key={name} value={name}>
            {name}
          </MenuItem>
        ))}
      </Select>
      <FormHelperText>
        {error ??
          (apps && apps.length === 0
            ? 'You have no apps registered in the portal.'
            : 'Only apps YOU own are listed.')}
      </FormHelperText>
    </FormControl>
  );
};

export const ownedAppPickerValidation = (
  value: string,
  validation: { addError: (msg: string) => void },
) => {
  if (!value) validation.addError('Pick the app to close.');
};
