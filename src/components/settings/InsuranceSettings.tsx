import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ShieldCheck, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { useIsAdmin } from '@/hooks/useTenant';
import {
  useInsuranceProfile,
  useUpdateInsuranceProfile,
  type InsuranceProfile,
} from '@/hooks/useInsuranceProfile';
import { formatCnpj, onlyDigits, isValidCnpj } from '@/lib/fiscal/insuranceValidation';

const EMPTY: InsuranceProfile = {};

/**
 * Seguradora padrão da transportadora (nome, CNPJ e apólice).
 * Fica salva no tenant e é pré-preenchida em toda emissão de CT-e / NFS-e.
 * O nº da averbação (CGC) NÃO fica aqui — muda a cada documento.
 */
export function InsuranceSettings() {
  const isAdmin = useIsAdmin();
  const { data: profile, isLoading } = useInsuranceProfile();
  const updateMut = useUpdateInsuranceProfile();
  const [form, setForm] = useState<InsuranceProfile>(EMPTY);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setForm(profile || EMPTY);
  }, [profile]);

  const hasSaved = !!(profile?.name || profile?.cnpj || profile?.policy);
  const readOnly = !isAdmin || (hasSaved && !editing);

  const save = async () => {
    if (!form.name || form.name.trim().length < 3) {
      toast.error('Informe a razão social da seguradora (mín. 3 caracteres)');
      return;
    }
    if (form.cnpj && !isValidCnpj(form.cnpj)) {
      toast.error('CNPJ da seguradora inválido');
      return;
    }
    try {
      await updateMut.mutateAsync({
        name: form.name.trim(),
        cnpj: onlyDigits(form.cnpj),
        policy: (form.policy || '').trim(),
      });
      setEditing(false);
      toast.success('Seguradora padrão salva');
    } catch (e: any) {
      toast.error('Falha ao salvar seguradora', { description: e?.message });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Seguradora padrão
        </CardTitle>
        <CardDescription>
          Usada automaticamente em CT-e e NFS-e. O nº da averbação (CGC) é informado por documento.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1">
                <Label>Seguradora (razão social)</Label>
                <Input
                  value={form.name || ''}
                  disabled={readOnly}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>CNPJ da seguradora</Label>
                <Input
                  value={formatCnpj(form.cnpj)}
                  inputMode="numeric"
                  placeholder="00.000.000/0000-00"
                  disabled={readOnly}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, cnpj: onlyDigits(e.target.value).slice(0, 14) }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Nº da apólice</Label>
                <Input
                  value={form.policy || ''}
                  disabled={readOnly}
                  onChange={(e) => setForm((p) => ({ ...p, policy: e.target.value }))}
                />
              </div>
            </div>

            {!isAdmin ? (
              <p className="text-xs text-muted-foreground">
                Somente administradores podem alterar a seguradora padrão.
              </p>
            ) : readOnly ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="mr-2 h-4 w-4" /> Editar seguradora
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={save} disabled={updateMut.isPending}>
                  {updateMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar seguradora
                </Button>
                {hasSaved && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setForm(profile || EMPTY);
                      setEditing(false);
                    }}
                  >
                    Cancelar
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}