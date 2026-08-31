import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, KeyRound, Truck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

function isStrongPassword(value: string): boolean {
  return value.length >= 12 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
}

export default function SetPassword() {
  const toast = useSonnerToast();
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);

  const valid = isStrongPassword(password) && password === confirmation;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success('Senha definida com sucesso.');
    navigate('/', { replace: true });
  };

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Validando convite...</div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Truck className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-bold">AGVLog</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />Definir senha</CardTitle>
            <CardDescription>Conclua seu convite escolhendo uma senha pessoal.</CardDescription>
          </CardHeader>
          <CardContent>
            {!user ? (
              <div className="space-y-4">
                <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  O convite é inválido ou expirou. Solicite um novo convite ao administrador.
                </div>
                <Button className="w-full" onClick={() => navigate('/auth', { replace: true })}>Voltar ao login</Button>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="new-password">Nova senha</Label>
                  <Input id="new-password" name="new-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
                  <p className="text-xs text-muted-foreground">Use 12 ou mais caracteres, com maiúscula, minúscula e número.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirmar senha</Label>
                  <Input id="confirm-password" name="confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
                </div>
                {confirmation && password !== confirmation && <p className="text-sm text-destructive">As senhas não coincidem.</p>}
                <Button type="submit" className="w-full" disabled={!valid || saving}>{saving ? 'Salvando...' : 'Definir senha e continuar'}</Button>
                <Button type="button" variant="ghost" className="w-full" onClick={signOut}>Cancelar e sair</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
