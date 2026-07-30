import { useState } from 'react';
import {
  useTemplateSecrets,
  type FieldExtensionComponentProps,
} from '@backstage/plugin-scaffolder-react';
import FormControl from '@material-ui/core/FormControl';
import FormHelperText from '@material-ui/core/FormHelperText';
import TextField from '@material-ui/core/TextField';

/**
 * Custom scaffolder field `SecretText` (task 050 F2 — BYO backup creds).
 *
 * A masked text input whose typed value is written into the scaffolder
 * SECRETS context (not the form data), so it never lands in the persisted
 * task record. Templates read it as `${{ secrets.<secretKey> }}`. The field's
 * own form value is only a presence marker ('provided'/undefined) used for
 * `required` validation.
 *
 * ui:options.secretKey (required) = the secrets-context key to populate.
 * Same pattern as GithubRepoTokenField, generalised to arbitrary typed input.
 */
export const SecretText = (props: FieldExtensionComponentProps<string>) => {
  const { onChange, uiSchema, schema, rawErrors, required } = props;
  const { setSecrets } = useTemplateSecrets();
  const [value, setValue] = useState('');
  const secretKey =
    (uiSchema?.['ui:options']?.secretKey as string | undefined) ?? undefined;

  const handle = (v: string) => {
    setValue(v);
    if (secretKey) {
      setSecrets({ [secretKey]: v });
    }
    // keep the real value OUT of form data (task record) — store a marker
    onChange(v ? 'provided' : undefined);
  };

  return (
    <FormControl
      margin="normal"
      required={required}
      error={(rawErrors?.length ?? 0) > 0}
      fullWidth
    >
      <TextField
        type="password"
        label={schema.title}
        value={value}
        onChange={e => handle(e.target.value)}
        autoComplete="off"
        fullWidth
      />
      <FormHelperText>
        {schema.description ??
          'Stored encrypted; never saved in the task history.'}
      </FormHelperText>
    </FormControl>
  );
};
