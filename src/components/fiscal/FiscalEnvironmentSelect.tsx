import { useId } from 'react';
import { HUB_ENVIRONMENTS, requireHubEnvironment, type HubEnvironment } from '../../../supabase/functions/_shared/fiscal-environment';

export function FiscalEnvironmentSelect({ value, onChange, disabled = false }: {
  value: HubEnvironment; onChange: (value: HubEnvironment) => void; disabled?: boolean;
}) {
  const id = useId();
  const labels: Record<HubEnvironment, string> = { sandbox: 'Sandbox', homologation: 'Homologação', production: 'Produção — documento real' };
  return <div className="space-y-1">
    <label htmlFor={id} className="text-xs font-medium">Ambiente fiscal</label>
    <select id={id} value={value} disabled={disabled} className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      onChange={event => onChange(requireHubEnvironment(event.target.value))}>
      {HUB_ENVIRONMENTS.map(environment => <option key={environment} value={environment}>{labels[environment]}</option>)}
    </select>
  </div>;
}
