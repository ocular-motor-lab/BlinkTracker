import type { PropsWithChildren } from 'react';

interface FieldGroupProps extends PropsWithChildren {
  label: string;
  helper?: string;
}

export const FieldGroup = ({ label, helper, children }: FieldGroupProps): JSX.Element => {
  return (
    <label className="field-group">
      <span className="field-label">{label}</span>
      {children}
      {helper ? <span className="field-helper">{helper}</span> : null}
    </label>
  );
};

