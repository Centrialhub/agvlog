import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Building2, Upload, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useIsAdmin } from '@/hooks/useTenant';
import { useCompanyProfile, useUpdateCompanyProfile, type CompanyProfile } from '@/hooks/useCompanyProfile';

const EMPTY: CompanyProfile = {};

/** Redimensiona um arquivo de imagem para no máximo maxDim px e devolve data URL JPG/PNG. */
async function fileToDataUrl(file: File, maxDim = 512): Promise<string> {
  const buf = await file.arrayBuffer();
  const blob = new Blob([buf], { type: file.type || 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível');
  ctx.drawImage(bitmap, 0, 0, w, h);
  const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return canvas.toDataURL(mime, 0.9);
}

export function CompanySettings() {
  const isAdmin = useIsAdmin();
  const { data: profile, isLoading } = useCompanyProfile();
  const updateMut = useUpdateCompanyProfile();
  const [form, setForm] = useState<CompanyProfile>(EMPTY);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setForm(profile || EMPTY); }, [profile]);

  const set = (k: keyof CompanyProfile) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleLogo = async (file: File) => {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      toast.error('Logo deve ter no máximo 3 MB');
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file, 512);
      setForm((p) => ({ ...p, logo_data_url: dataUrl }));
      toast.success('Logo carregado. Salve para aplicar.');
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao processar imagem');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    try {
      await updateMut.mutateAsync(form);
      toast.success('Dados da empresa salvos');
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao salvar');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4" /> Dados da empresa
        </CardTitle>
        <CardDescription>
          Informações usadas em relatórios, PDFs (protocolo de paletes, canhotos, romaneios) e no portal do cliente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-[160px_1fr] items-start">
              <div className="space-y-2">
                <Label className="text-xs">Logo</Label>
                <div className="h-32 w-32 rounded-md border border-border bg-muted/40 flex items-center justify-center overflow-hidden">
                  {form.logo_data_url ? (
                    <img src={form.logo_data_url} alt="Logo da empresa" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-[10px] text-muted-foreground text-center px-2">Sem logo</span>
                  )}
                </div>
                {isAdmin && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
                      <Upload className="h-3.5 w-3.5 mr-1" /> {uploading ? '...' : 'Enviar'}
                    </Button>
                    {form.logo_data_url && (
                      <Button size="sm" variant="ghost" onClick={() => setForm((p) => ({ ...p, logo_data_url: '' }))}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogo(f); e.target.value = ''; }}
                    />
                  </div>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div><Label>Razão social</Label><Input value={form.legal_name || ''} onChange={set('legal_name')} disabled={!isAdmin} placeholder="Ex.: AGV Distribuição e Logística Ltda" /></div>
                <div><Label>Nome fantasia</Label><Input value={form.trade_name || ''} onChange={set('trade_name')} disabled={!isAdmin} placeholder="Ex.: AGVLog" /></div>
                <div><Label>CNPJ</Label><Input value={form.tax_id || ''} onChange={set('tax_id')} disabled={!isAdmin} placeholder="00.000.000/0000-00" /></div>
                <div><Label>Inscrição Estadual</Label><Input value={form.state_registration || ''} onChange={set('state_registration')} disabled={!isAdmin} /></div>
                <div className="md:col-span-2"><Label>Endereço</Label><Input value={form.address || ''} onChange={set('address')} disabled={!isAdmin} placeholder="Rua, número, bairro" /></div>
                <div><Label>Cidade</Label><Input value={form.city || ''} onChange={set('city')} disabled={!isAdmin} /></div>
                <div><Label>UF</Label><Input value={form.state || ''} onChange={set('state')} disabled={!isAdmin} maxLength={2} /></div>
                <div><Label>CEP</Label><Input value={form.zip || ''} onChange={set('zip')} disabled={!isAdmin} /></div>
                <div><Label>Telefone</Label><Input value={form.phone || ''} onChange={set('phone')} disabled={!isAdmin} /></div>
                <div><Label>E-mail</Label><Input value={form.email || ''} onChange={set('email')} disabled={!isAdmin} /></div>
                <div><Label>Site</Label><Input value={form.website || ''} onChange={set('website')} disabled={!isAdmin} /></div>
              </div>
            </div>

            {isAdmin ? (
              <div className="flex justify-end">
                <Button onClick={save} disabled={updateMut.isPending}>
                  {updateMut.isPending ? 'Salvando…' : 'Salvar alterações'}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Apenas administradores ou proprietários podem editar estes dados.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}