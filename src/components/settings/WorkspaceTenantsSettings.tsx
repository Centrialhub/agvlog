import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Loader2, Pencil, Plus, ReceiptText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTenant } from '@/hooks/useTenant';
import type { CompanyProfile } from '@/hooks/useCompanyProfile';
import {
  useCreateWorkspaceTenant, useSetWorkspaceTenantDefaultEmitter, useUpdateWorkspaceTenant,
  useWorkspaceTenants, type WorkspaceTenant, type WorkspaceTenantInput,
} from '@/hooks/useWorkspaceTenants';

const digits = (value: string) => value.replace(/\D/g, '');
const formatCnpj = (value: string) => {
  const d = digits(value);
  if (d.length !== 14) return value || 'Não informado';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

export function WorkspaceTenantsSettings() {
  const navigate = useNavigate();
  const { currentTenant, activateTenantId } = useTenant();
  const { data: tenants = [], isLoading, error } = useWorkspaceTenants();
  const setDefault = useSetWorkspaceTenantDefaultEmitter();
  const [editing, setEditing] = useState<WorkspaceTenant | 'new' | null>(null);

  const openEmitters = async (tenantId: string) => {
    if (tenantId !== currentTenant?.id && !(await activateTenantId(tenantId))) return;
    navigate('/settings?tab=emitters');
  };

  return (
    <Card>
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4" /> Empresas do grupo</CardTitle>
          <CardDescription>
            Cada empresa mantém documentos, financeiro e fiscal separados. Pessoas, clientes, fornecedores, caminhões e SSX pertencem ao grupo.
          </CardDescription>
        </div>
        <Button onClick={() => setEditing('new')}><Plus className="mr-2 h-4 w-4" />Cadastrar empresa</Button>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando empresas…</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar as empresas do grupo.</p> : null}
        <div className="grid gap-3 lg:grid-cols-2">
          {tenants.map((tenant) => {
            const activeEmitters = tenant.emitters.filter((emitter) => emitter.active);
            const defaultEmitter = activeEmitters.find((emitter) => emitter.is_default);
            return (
              <div key={tenant.id} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{tenant.company.trade_name || tenant.company.legal_name || tenant.name}</p>
                      {tenant.id === currentTenant?.id ? <Badge>Empresa ativa</Badge> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{tenant.company.legal_name || tenant.name}</p>
                    <p className="text-xs text-muted-foreground">CNPJ {formatCnpj(tenant.company.tax_id || '')}</p>
                  </div>
                  <Button size="icon" variant="ghost" aria-label={`Editar ${tenant.name}`} onClick={() => setEditing(tenant)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`default-emitter-${tenant.id}`}>Emitente fiscal padrão</Label>
                  {activeEmitters.length ? (
                    <Select
                      value={defaultEmitter?.id || ''}
                      onValueChange={(emitterId) => setDefault.mutate({ tenantId: tenant.id, emitterId })}
                      disabled={setDefault.isPending}
                    >
                      <SelectTrigger id={`default-emitter-${tenant.id}`} className={!defaultEmitter ? 'border-amber-500' : ''}>
                        <SelectValue placeholder="Escolha obrigatória para emitir" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeEmitters.map((emitter) => (
                          <SelectItem key={emitter.id} value={emitter.id}>
                            {emitter.razao_social} · {formatCnpj(emitter.cnpj)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                      Nenhum emitente ativo. Esta empresa não pode emitir documentos fiscais.
                    </div>
                  )}
                  {!defaultEmitter && activeEmitters.length ? <p className="text-xs text-amber-700">Selecione o CNPJ que será usado por padrão.</p> : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  {tenant.id !== currentTenant?.id ? (
                    <Button size="sm" variant="outline" onClick={() => { void activateTenantId(tenant.id); }}>Abrir empresa</Button>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={() => { void openEmitters(tenant.id); }}>
                    <ReceiptText className="mr-2 h-3.5 w-3.5" />Gerenciar emitentes
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
      {editing ? <TenantDialog tenant={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function TenantDialog({ tenant, onClose }: { tenant: WorkspaceTenant | null; onClose: () => void }) {
  const createTenant = useCreateWorkspaceTenant();
  const updateTenant = useUpdateWorkspaceTenant();
  const initialCompany = tenant?.company || {};
  const [name, setName] = useState(tenant?.name || '');
  const [company, setCompany] = useState<CompanyProfile>(initialCompany);
  const [includeEmitter, setIncludeEmitter] = useState(!tenant);
  const [emitter, setEmitter] = useState({ cnpj: initialCompany.tax_id || '', razao_social: initialCompany.legal_name || '', nome_fantasia: initialCompany.trade_name || '' });
  const pending = createTenant.isPending || updateTenant.isPending;
  const companyIsValid = !!name.trim() && !!company.legal_name?.trim() && digits(company.tax_id || '').length === 14;
  const emitterIsValid = !!tenant || !includeEmitter || (digits(emitter.cnpj).length === 14 && !!emitter.razao_social.trim());
  const valid = companyIsValid && emitterIsValid;
  const setCompanyField = (key: keyof CompanyProfile, value: string) => setCompany((current) => ({ ...current, [key]: value }));

  const save = async () => {
    const payload: WorkspaceTenantInput = {
      name: name.trim(), timezone: tenant?.timezone || 'America/Sao_Paulo', company,
      initial_emitter: !tenant && includeEmitter ? { ...emitter, cnpj: digits(emitter.cnpj), branch_code: 'MATRIZ' } : null,
    };
    try {
      if (tenant) await updateTenant.mutateAsync({ ...payload, id: tenant.id });
      else await createTenant.mutateAsync(payload);
      onClose();
    } catch { /* mutations retain the dialog and display the actionable error */ }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{tenant ? 'Editar empresa tenant' : 'Cadastrar empresa tenant'}</DialogTitle></DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div><Label htmlFor="tenant-name">Nome no seletor *</Label><Input id="tenant-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: AGV Logística MG" /></div>
          <div><Label htmlFor="tenant-legal-name">Razão social *</Label><Input id="tenant-legal-name" value={company.legal_name || ''} onChange={(event) => setCompanyField('legal_name', event.target.value)} /></div>
          <div><Label htmlFor="tenant-trade-name">Nome fantasia</Label><Input id="tenant-trade-name" value={company.trade_name || ''} onChange={(event) => setCompanyField('trade_name', event.target.value)} /></div>
          <div><Label htmlFor="tenant-tax-id">CNPJ da empresa *</Label><Input id="tenant-tax-id" value={company.tax_id || ''} onChange={(event) => setCompanyField('tax_id', event.target.value)} placeholder="00.000.000/0000-00" /></div>
          <div><Label htmlFor="tenant-state-registration">Inscrição Estadual</Label><Input id="tenant-state-registration" value={company.state_registration || ''} onChange={(event) => setCompanyField('state_registration', event.target.value)} /></div>
          <div><Label htmlFor="tenant-city">Cidade</Label><Input id="tenant-city" value={company.city || ''} onChange={(event) => setCompanyField('city', event.target.value)} /></div>
          <div><Label htmlFor="tenant-state">UF</Label><Input id="tenant-state" maxLength={2} value={company.state || ''} onChange={(event) => setCompanyField('state', event.target.value.toUpperCase())} /></div>
          <div><Label htmlFor="tenant-zip">CEP</Label><Input id="tenant-zip" value={company.zip || ''} onChange={(event) => setCompanyField('zip', event.target.value)} /></div>
          <div className="md:col-span-2"><Label htmlFor="tenant-address">Endereço</Label><Input id="tenant-address" value={company.address || ''} onChange={(event) => setCompanyField('address', event.target.value)} /></div>
        </div>

        {!tenant ? (
          <div className="rounded-lg border p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={includeEmitter} onCheckedChange={(checked) => setIncludeEmitter(checked === true)} />
              Cadastrar o primeiro emitente fiscal e defini-lo como padrão
            </label>
            {includeEmitter ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div><Label htmlFor="emitter-tax-id">CNPJ emitente *</Label><Input id="emitter-tax-id" value={emitter.cnpj} onChange={(event) => setEmitter((current) => ({ ...current, cnpj: event.target.value }))} /></div>
                <div><Label htmlFor="emitter-legal-name">Razão social do emitente *</Label><Input id="emitter-legal-name" value={emitter.razao_social} onChange={(event) => setEmitter((current) => ({ ...current, razao_social: event.target.value }))} /></div>
                <div className="md:col-span-2"><Label htmlFor="emitter-trade-name">Nome fantasia do emitente</Label><Input id="emitter-trade-name" value={emitter.nome_fantasia} onChange={(event) => setEmitter((current) => ({ ...current, nome_fantasia: event.target.value }))} /></div>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancelar</Button>
          <Button onClick={() => { void save(); }} disabled={!valid || pending}>
            {pending ? 'Salvando…' : tenant ? 'Salvar empresa' : 'Cadastrar empresa'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
