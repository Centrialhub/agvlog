import { confirmAction } from '@/hooks/useAlertStore';
import { useState } from 'react';
import {
  useEmitters, useSaveEmitter, useDeleteEmitter, useMakeDefaultEmitter,
  useHubCredentials, useSaveHubCredential, useSaveHubCredentialToken, useDeleteHubCredential,
  type TenantEmitter, type HubFiscalCredential,
} from '@/hooks/useEmitters';
import { useIsAdmin } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Pencil, Trash2, Star, Key, Building2 } from 'lucide-react';
import { hubFiscal } from '@/lib/fiscal/hubFiscalClient';
import { toast } from '@/components/ui/sonner';

export default function EmittersSettings() {
  const isAdmin = useIsAdmin();
  const { data: emitters = [], isLoading } = useEmitters();
  const [editing, setEditing] = useState<Partial<TenantEmitter> | null>(null);
  const [credsFor, setCredsFor] = useState<TenantEmitter | null>(null);
  const makeDefault = useMakeDefaultEmitter();
  const del = useDeleteEmitter();

  if (!isAdmin) {
    return (
      <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
        Apenas administradores podem gerenciar emitentes fiscais.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Emitentes Fiscais</h2>
          <p className="text-sm text-muted-foreground">
            Cadastre cada CNPJ próprio que emite documentos fiscais. Cada emitente tem sua própria conta no Hub Fiscal.
          </p>
        </div>
        <Button onClick={() => setEditing({})}><Plus className="mr-2 h-4 w-4" />Novo emitente</Button>
      </div>

      {isLoading ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Carregando...</CardContent></Card>
      ) : emitters.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center py-12">
          <Building2 className="h-12 w-12 text-muted-foreground mb-3" />
          <p className="font-medium">Nenhum emitente cadastrado</p>
          <p className="text-sm text-muted-foreground mt-1">Cadastre o CNPJ da sua empresa para começar a emitir documentos fiscais.</p>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {emitters.map(e => (
            <Card key={e.id} className={e.is_default ? 'border-primary/40' : ''}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      {e.razao_social}
                      {e.is_default && <Badge className="bg-primary text-primary-foreground"><Star className="h-3 w-3 mr-1" />Padrão</Badge>}
                      {!e.active && <Badge variant="secondary">Inativo</Badge>}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      CNPJ {formatCnpj(e.cnpj)} · Filial {e.branch_code}{e.ie ? ` · IE ${e.ie}` : ''}
                    </CardDescription>
                  </div>
                  <div className="flex gap-1">
                    {!e.is_default && (
                      <Button size="sm" variant="ghost" onClick={() => makeDefault.mutate(e.id)} disabled={!e.active || makeDefault.isPending}>
                        <Star className="h-3 w-3" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setCredsFor(e)}>
                      <Key className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost"
                      onClick={async () => { if (await confirmAction('Remover este emitente?', { title: 'Remover emitente', confirmLabel: 'Remover' })) del.mutate(e.id); }}
                      disabled={e.is_default}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <EmitterFormDialog
          initial={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {credsFor && (
        <CredentialsDialog emitter={credsFor} onClose={() => setCredsFor(null)} />
      )}
    </div>
  );
}

function formatCnpj(cnpj: string) {
  const d = (cnpj || '').replace(/\D/g, '').padStart(14, '0');
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12,14)}`;
}

type EmitterForm = {
  branch_code: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  ie: string;
  im: string;
  regime_tributario: string;
  city_code: string;
  logo_url: string;
  active: boolean;
  is_default: boolean;
  endereco: TenantEmitter['endereco'];
};

function EmitterFormDialog({ initial, onClose }: { initial: Partial<TenantEmitter>; onClose: () => void }) {
  const save = useSaveEmitter();
  const saveToken = useSaveHubCredentialToken();
  const saveMeta = useSaveHubCredential();
  const { data: existingCreds = [] } = useHubCredentials(initial.id);
  const [f, setF] = useState<EmitterForm>({
    branch_code: initial.branch_code || 'MATRIZ',
    cnpj: initial.cnpj || '',
    razao_social: initial.razao_social || '',
    nome_fantasia: initial.nome_fantasia || '',
    ie: initial.ie || '',
    im: initial.im || '',
    regime_tributario: initial.regime_tributario || '',
    city_code: initial.city_code || '',
    logo_url: initial.logo_url || '',
    active: initial.active ?? true,
    is_default: initial.is_default ?? false,
    endereco: initial.endereco || {},
  });
  const [cred, setCred] = useState({
    mode: 'token' as 'token' | 'secret_name',
    doc_scope: 'all' as HubFiscalCredential['doc_scope'],
    environment: 'production' as HubFiscalCredential['environment'],
    token: '',
    secret_name: '',
  });
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | undefined>(initial.id);
  const editing = !!savedId;
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; source?: string; scope?: string | null; message?: string }>(null);
  const set = <K extends Exclude<keyof EmitterForm, 'endereco'>>(key: K, value: EmitterForm[K]) =>
    setF((current) => ({ ...current, [key]: value }));
  const setEnd = <K extends keyof TenantEmitter['endereco']>(key: K, value: TenantEmitter['endereco'][K]) =>
    setF((current) => ({ ...current, endereco: { ...current.endereco, [key]: value } }));

  const handleSave = async () => {
    if (!f.cnpj || String(f.cnpj).replace(/\D/g, '').length !== 14) { toast.error('CNPJ inválido'); return; }
    if (!f.razao_social) { toast.error('Razão social é obrigatória'); return; }
    setSaving(true);
    try {
      const payload = { ...f, id: savedId };
      const saved = await save.mutateAsync(payload);
      setSavedId(saved.id);
      if (cred.mode === 'token' && cred.token.trim().length >= 8) {
        await saveToken.mutateAsync({
          emitter_id: saved.id,
          doc_scope: cred.doc_scope,
          environment: cred.environment,
          token: cred.token,
          enabled: true,
        });
      } else if (cred.mode === 'secret_name' && cred.secret_name.trim()) {
        await saveMeta.mutateAsync({
          emitter_id: saved.id,
          doc_scope: cred.doc_scope,
          environment: cred.environment,
          secret_name: cred.secret_name.trim(),
          enabled: true,
        });
      }
      onClose();
    } catch {
      // mutation hooks already show toast; keep dialog open on emitter error
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!savedId) { toast.info('Salve o emitente antes de testar a credencial.'); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await hubFiscal.ping(savedId, cred.doc_scope);
      if (res?.success) {
        setTestResult({
          ok: true,
          source: res.source,
          scope: res.scope_matched,
          message: res.source === 'default'
            ? 'Nenhuma credencial específica encontrada — o proxy usaria o token padrão do Hub Fiscal.'
            : `Credencial ${res.source === 'ciphertext' ? 'criptografada' : 'de segredo'} localizada (escopo: ${res.scope_matched || 'all'}).`,
        });
      } else {
        setTestResult({ ok: false, message: res?.error?.message || 'Falha ao resolver credencial.' });
      }
    } catch (error: unknown) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : 'Erro ao chamar o proxy.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? 'Editar emitente' : 'Novo emitente'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-6 gap-3">
          <div className="col-span-3"><Label>Razão social *</Label><Input value={f.razao_social} onChange={e => set('razao_social', e.target.value)} /></div>
          <div className="col-span-3"><Label>Nome fantasia</Label><Input value={f.nome_fantasia} onChange={e => set('nome_fantasia', e.target.value)} /></div>
          <div className="col-span-2"><Label>CNPJ *</Label><Input value={f.cnpj} onChange={e => set('cnpj', e.target.value)} /></div>
          <div className="col-span-2"><Label>Filial (código)</Label><Input value={f.branch_code} onChange={e => set('branch_code', e.target.value)} /></div>
          <div className="col-span-2">
            <Label>Regime tributário</Label>
            <Select value={f.regime_tributario || ''} onValueChange={v => set('regime_tributario', v)}>
              <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="simples">Simples Nacional</SelectItem>
                <SelectItem value="presumido">Lucro Presumido</SelectItem>
                <SelectItem value="real">Lucro Real</SelectItem>
                <SelectItem value="mei">MEI</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2"><Label>IE</Label><Input value={f.ie} onChange={e => set('ie', e.target.value)} /></div>
          <div className="col-span-2"><Label>IM (Inscrição Municipal)</Label><Input value={f.im} onChange={e => set('im', e.target.value)} /></div>
          <div className="col-span-2"><Label>Código IBGE do município</Label><Input value={f.city_code} onChange={e => set('city_code', e.target.value)} /></div>
          <div className="col-span-6"><Label>Logo (URL)</Label><Input value={f.logo_url} onChange={e => set('logo_url', e.target.value)} placeholder="https://..." /></div>

          <div className="col-span-6 pt-2 border-t">
            <h4 className="text-sm font-semibold mb-2">Endereço fiscal</h4>
          </div>
          <div className="col-span-4"><Label>Logradouro</Label><Input value={f.endereco?.logradouro || ''} onChange={e => setEnd('logradouro', e.target.value)} /></div>
          <div className="col-span-1"><Label>Número</Label><Input value={f.endereco?.numero || ''} onChange={e => setEnd('numero', e.target.value)} /></div>
          <div className="col-span-1"><Label>Complemento</Label><Input value={f.endereco?.complemento || ''} onChange={e => setEnd('complemento', e.target.value)} /></div>
          <div className="col-span-2"><Label>Bairro</Label><Input value={f.endereco?.bairro || ''} onChange={e => setEnd('bairro', e.target.value)} /></div>
          <div className="col-span-2"><Label>Município</Label><Input value={f.endereco?.municipio || ''} onChange={e => setEnd('municipio', e.target.value)} /></div>
          <div className="col-span-1"><Label>UF</Label><Input value={f.endereco?.uf || ''} onChange={e => setEnd('uf', e.target.value)} /></div>
          <div className="col-span-1"><Label>CEP</Label><Input value={f.endereco?.cep || ''} onChange={e => setEnd('cep', e.target.value)} /></div>
          <div className="col-span-2"><Label>Telefone</Label><Input value={f.endereco?.telefone || ''} onChange={e => setEnd('telefone', e.target.value)} /></div>
          <div className="col-span-2"><Label>E-mail</Label><Input value={f.endereco?.email || ''} onChange={e => setEnd('email', e.target.value)} /></div>

          <div className="col-span-6 pt-4 border-t">
            <h4 className="text-sm font-semibold mb-1">Credenciais do Hub Fiscal (opcional)</h4>
            <p className="text-xs text-muted-foreground mb-3">
              Cada emitente pode usar uma conta própria no Hub Fiscal. Se não preencher, o sistema usará o token padrão <code>HUB_FISCAL_API_KEY</code>.
            </p>
          </div>

          {editing && existingCreds.length > 0 && (
            <div className="col-span-6">
              <h5 className="text-xs font-semibold mb-2">Credenciais já salvas</h5>
              <div className="space-y-2">
                {existingCreds.map(c => (
                  <div key={c.id} className="flex items-center justify-between rounded-md border p-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{c.doc_scope}</Badge>
                      <span className="text-muted-foreground">{c.environment}</span>
                    </div>
                    <div className="font-mono">
                      {c.has_ciphertext
                        ? <span>Token salvo <span className="text-muted-foreground">({c.secret_hint || '••••'})</span></span>
                        : c.secret_name
                          ? <span>env: {c.secret_name}</span>
                          : <span className="text-muted-foreground">—</span>}
                    </div>
                    <Badge className={c.enabled ? 'bg-success text-success-foreground' : ''} variant={c.enabled ? 'default' : 'secondary'}>{c.enabled ? 'Ativa' : 'Inativa'}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="col-span-2">
            <Label>Escopo</Label>
            <Select value={cred.doc_scope} onValueChange={v => setCred(s => ({ ...s, doc_scope: v as typeof s.doc_scope }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="nfse">NFS-e</SelectItem>
                <SelectItem value="cte">CT-e</SelectItem>
                <SelectItem value="nfe">NF-e</SelectItem>
                <SelectItem value="nfce">NFC-e</SelectItem>
                <SelectItem value="mdfe">MDF-e</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Ambiente</Label>
            <Select value={cred.environment} onValueChange={v => setCred(s => ({ ...s, environment: v as typeof s.environment }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="production">Produção</SelectItem>
                <SelectItem value="sandbox">Homologação</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Modo</Label>
            <Select value={cred.mode} onValueChange={v => setCred(s => ({ ...s, mode: v as typeof s.mode }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="token">Colar token</SelectItem>
                <SelectItem value="secret_name">Nome de segredo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {cred.mode === 'token' ? (
            <div className="col-span-4">
              <Label>Token do Hub Fiscal</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={cred.token}
                onChange={e => setCred(s => ({ ...s, token: e.target.value }))}
                placeholder="Cole o token deste CNPJ"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Criptografado com AES-GCM no backend e nunca devolvido para a tela.
              </p>
            </div>
          ) : (
            <div className="col-span-4">
              <Label>Nome do segredo</Label>
              <Input
                value={cred.secret_name}
                onChange={e => setCred(s => ({ ...s, secret_name: e.target.value }))}
                placeholder="HUB_FISCAL_KEY_..."
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                O token deve estar configurado como variável de ambiente com esse nome.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <div className="flex-1 text-left text-xs">
            {testResult && (
              <span className={testResult.ok ? 'text-success' : 'text-destructive'}>
                {testResult.ok ? '✔ ' : '✖ '}{testResult.message}
              </span>
            )}
          </div>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="secondary" onClick={handleTest} disabled={testing || !savedId} title={savedId ? 'Testar credencial do Hub Fiscal para este emitente' : 'Salve o emitente para habilitar o teste'}>
            {testing ? 'Testando…' : 'Testar credencial'}
          </Button>
          <Button onClick={handleSave} disabled={saving}>{editing ? 'Salvar' : 'Cadastrar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CredentialsDialog({ emitter, onClose }: { emitter: TenantEmitter; onClose: () => void }) {
  const { data: creds = [] } = useHubCredentials(emitter.id);
  const saveToken = useSaveHubCredentialToken();
  const saveMeta = useSaveHubCredential();
  const del = useDeleteHubCredential();
  const [form, setForm] = useState<{
    doc_scope: HubFiscalCredential['doc_scope'];
    environment: HubFiscalCredential['environment'];
    mode: 'token' | 'secret_name';
    token: string;
    secret_name: string;
    enabled: boolean;
  }>({
    doc_scope: 'all',
    environment: 'production',
    mode: 'token',
    token: '',
    secret_name: '',
    enabled: true,
  });

  const handleAdd = async () => {
    if (form.mode === 'token') {
      if (!form.token || form.token.trim().length < 8) return;
      await saveToken.mutateAsync({
        emitter_id: emitter.id,
        doc_scope: form.doc_scope,
        environment: form.environment,
        enabled: form.enabled,
        token: form.token,
      });
    } else {
      if (!form.secret_name.trim()) return;
      await saveMeta.mutateAsync({
        emitter_id: emitter.id,
        doc_scope: form.doc_scope,
        environment: form.environment,
        enabled: form.enabled,
        secret_name: form.secret_name.trim(),
      });
    }
    setForm(s => ({ ...s, token: '', secret_name: '' }));
  };

  const saving = saveToken.isPending || saveMeta.isPending;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Credenciais Hub Fiscal — {emitter.razao_social}</DialogTitle>
        </DialogHeader>

        <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1">
          <p><strong>Como funciona:</strong> cada emitente pode ter uma conta própria no Hub Fiscal.</p>
          <p>Cole o token do Hub Fiscal aqui — ele é criptografado no backend com AES-GCM (chave <code>AGVLOG_ENCRYPTION_KEY</code>) antes de ir para o banco e nunca é devolvido para a tela.</p>
          <p>Alternativa avançada: se você preferir guardar o token como variável de ambiente, use o modo <em>“Nome de segredo”</em> e informe apenas o nome (ex.: <code>HUB_FISCAL_KEY_FILIAL2</code>).</p>
          <p>Sem credencial cadastrada, o sistema usa o token padrão <code>HUB_FISCAL_API_KEY</code>.</p>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Escopo</TableHead>
              <TableHead>Ambiente</TableHead>
              <TableHead>Fonte do token</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {creds.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-4">
                Nenhuma credencial. Usará o token padrão do sistema.
              </TableCell></TableRow>
            )}
            {creds.map(c => (
              <TableRow key={c.id}>
                <TableCell><Badge variant="outline">{c.doc_scope}</Badge></TableCell>
                <TableCell>{c.environment}</TableCell>
                <TableCell className="font-mono text-xs">
                  {c.has_ciphertext
                    ? <span>token salvo <span className="text-muted-foreground">({c.secret_hint || '••••'})</span></span>
                    : c.secret_name
                      ? <>env: {c.secret_name}</>
                      : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>{c.enabled ? <Badge className="bg-success text-success-foreground">Ativa</Badge> : <Badge variant="secondary">Inativa</Badge>}</TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={() => del.mutate({ id: c.id, emitter_id: emitter.id })}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="border-t pt-3 space-y-3">
          <h4 className="text-sm font-semibold">Adicionar credencial</h4>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label>Escopo</Label>
              <Select value={form.doc_scope} onValueChange={v => setForm(s => ({ ...s, doc_scope: v as typeof s.doc_scope }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="nfse">NFS-e</SelectItem>
                  <SelectItem value="cte">CT-e</SelectItem>
                  <SelectItem value="nfe">NF-e</SelectItem>
                  <SelectItem value="nfce">NFC-e</SelectItem>
                  <SelectItem value="mdfe">MDF-e</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Ambiente</Label>
              <Select value={form.environment} onValueChange={v => setForm(s => ({ ...s, environment: v as typeof s.environment }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">Produção</SelectItem>
                  <SelectItem value="sandbox">Homologação</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Modo</Label>
              <Select value={form.mode} onValueChange={v => setForm(s => ({ ...s, mode: v as typeof s.mode }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="token">Colar token (criptografado no banco)</SelectItem>
                  <SelectItem value="secret_name">Usar nome de segredo (variável de ambiente)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.mode === 'token' ? (
              <div className="col-span-4">
                <Label>Token do Hub Fiscal</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={form.token}
                  onChange={e => setForm(s => ({ ...s, token: e.target.value }))}
                  placeholder="Cole aqui o token deste CNPJ"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Enviado por HTTPS ao backend, criptografado com AES-GCM e armazenado. Nunca é devolvido para a tela.
                </p>
              </div>
            ) : (
              <div className="col-span-4">
                <Label>Nome do segredo</Label>
                <Input
                  value={form.secret_name}
                  onChange={e => setForm(s => ({ ...s, secret_name: e.target.value }))}
                  placeholder="HUB_FISCAL_KEY_..."
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  O valor do segredo precisa existir como variável de ambiente do backend com esse nome.
                </p>
              </div>
            )}
          </div>
          <Button
            size="sm"
            disabled={saving || (form.mode === 'token' ? form.token.trim().length < 8 : !form.secret_name.trim())}
            onClick={handleAdd}
          >
            <Plus className="h-3 w-3 mr-1" />Adicionar
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
