import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import {
  BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS,
  listReceiptScanQualityPolicies,
  receiptQualityPolicyError,
  retireReceiptScanQualityPolicy,
  saveReceiptScanQualityPolicy,
  type ReceiptScanQualityThresholds,
} from '@/lib/driver/receiptQualityPolicy';

type Props = { tenantId: string; actorId: string };
type NumericThreshold = Exclude<keyof ReceiptScanQualityThresholds, 'edge_cut_action'>;

const thresholdFields: Array<{ key: NumericThreshold; label: string; step?: string }> = [
  { key: 'min_source_pixels', label: 'Pixels mínimos no original' },
  { key: 'min_processed_short_side', label: 'Lado menor do scan (px)' },
  { key: 'min_brightness_reject', label: 'Iluminação mínima para aceitar', step: '0.1' },
  { key: 'min_brightness_warn', label: 'Iluminação mínima sem alerta', step: '0.1' },
  { key: 'max_brightness_reject', label: 'Iluminação máxima', step: '0.1' },
  { key: 'max_glare_warn', label: 'Reflexo máximo (0–1)', step: '0.01' },
  { key: 'min_contrast_reject', label: 'Contraste mínimo para aceitar', step: '0.1' },
  { key: 'min_contrast_warn', label: 'Contraste mínimo sem alerta', step: '0.1' },
  { key: 'min_sharpness_reject', label: 'Nitidez mínima para aceitar', step: '0.1' },
  { key: 'min_sharpness_warn', label: 'Nitidez mínima sem alerta', step: '0.1' },
];

export function DeliveryReceiptQualityPolicyPanel({ tenantId, actorId }: Props) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState('');
  const [thresholds, setThresholds] = useState<ReceiptScanQualityThresholds>(() => ({ ...BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS }));
  const policies = useQuery({
    queryKey: ['delivery-receipt-quality-policies', tenantId, actorId],
    queryFn: () => listReceiptScanQualityPolicies(tenantId, actorId),
    retry: false,
  });
  const clients = useQuery({
    queryKey: ['delivery-receipt-quality-policy-clients', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, company_name')
        .eq('tenant_id', tenantId).order('company_name');
      if (error) throw error;
      return data ?? [];
    },
    retry: false,
  });
  const activePolicy = policies.data?.rows.find((row) => row.is_active
    && (row.client_id ?? '') === scope) ?? null;

  useEffect(() => {
    setThresholds({ ...(activePolicy?.thresholds ?? policies.data?.baseline ?? BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS) });
  }, [activePolicy, policies.data?.baseline, scope]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['delivery-receipt-quality-policies', tenantId, actorId] });
  };
  const save = useMutation({
    mutationFn: () => saveReceiptScanQualityPolicy({
      tenantId, clientId: scope || null, thresholds, expectedActivePolicyId: activePolicy?.id ?? null,
    }),
    onSuccess: refresh,
  });
  const retire = useMutation({
    mutationFn: () => {
      if (!activePolicy) throw new Error('Não há política ativa para remover.');
      return retireReceiptScanQualityPolicy({ tenantId, clientId: scope || null, expectedActivePolicyId: activePolicy.id });
    },
    onSuccess: refresh,
  });
  const error = policies.error ?? clients.error ?? save.error ?? retire.error;

  return <Card>
    <CardHeader className="pb-3">
      <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4"/>Regras de qualidade do scan</CardTitle>
      <p className="text-xs text-muted-foreground">A regra do cliente prevalece sobre a regra da empresa. Sem configuração, vale o padrão do aplicativo.</p>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="receipt-quality-scope">Aplicar a</Label>
        <select id="receipt-quality-scope" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={scope}
          onChange={(event) => setScope(event.target.value)}>
          <option value="">Toda a empresa</option>
          {(clients.data ?? []).map((client) => <option key={client.id} value={client.id}>{client.company_name}</option>)}
        </select>
        <p className="text-xs text-muted-foreground" data-testid="active-quality-policy">
          {activePolicy ? `Política ativa · versão ${activePolicy.version}` : scope ? 'Usando fallback da empresa ou padrão' : 'Usando padrão do aplicativo'}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {thresholdFields.map((field) => <div className="space-y-1" key={field.key}>
          <Label htmlFor={`receipt-quality-${field.key}`} className="text-xs">{field.label}</Label>
          <Input id={`receipt-quality-${field.key}`} type="number" min="0" step={field.step ?? '1'} value={thresholds[field.key]}
            onChange={(event) => setThresholds((current) => ({ ...current, [field.key]: Number(event.target.value) }))}/>
        </div>)}
        <div className="space-y-1">
          <Label htmlFor="receipt-quality-edge-action" className="text-xs">Papel tocando a borda</Label>
          <select id="receipt-quality-edge-action" className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={thresholds.edge_cut_action} onChange={(event) => setThresholds((current) => ({
              ...current, edge_cut_action: event.target.value as ReceiptScanQualityThresholds['edge_cut_action'],
            }))}>
            <option value="warn">Alertar e pedir confirmação</option><option value="reject">Rejeitar o scan</option>
          </select>
        </div>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{receiptQualityPolicyError(error)}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={save.isPending || retire.isPending || policies.isPending}
          onClick={() => save.mutate()}>{save.isPending ? 'Salvando…' : 'Salvar nova versão'}</Button>
        {activePolicy ? <Button type="button" variant="outline" disabled={save.isPending || retire.isPending}
          onClick={() => retire.mutate()}>{retire.isPending ? 'Removendo…' : 'Usar fallback'}</Button> : null}
      </div>
      {policies.data?.rows.length ? <details>
        <summary className="cursor-pointer text-xs font-medium">Histórico versionado ({policies.data.rows.length})</summary>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {policies.data.rows.map((row) => <li key={row.id}>{row.client_name ?? 'Toda a empresa'} · v{row.version} · {row.is_active ? 'ativa' : 'encerrada'}</li>)}
        </ul>
      </details> : null}
    </CardContent>
  </Card>;
}
