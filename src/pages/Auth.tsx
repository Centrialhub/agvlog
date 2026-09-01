import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { IntegraLabsCredit } from '@/components/branding/IntegraLabsCredit';

export default function Auth() {
  const [loading, setLoading] = useState(false);
  const { backendUnavailable } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center">
            <img src="/icons/agvlog-192.png" alt="AGVLog" className="h-14 w-14 rounded-xl object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">AGVLog</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Inteligência logística para sua frota
          </p>
        </div>

        {backendUnavailable && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Serviço temporariamente indisponível</p>
              <p className="text-xs opacity-90">
                Não foi possível conectar ao backend. Tente novamente em instantes.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-2 text-xs font-medium underline"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        )}

        <Card>
          <CardHeader className="pb-4">
            <CardTitle>Entrar</CardTitle>
            <CardDescription>
              O acesso é criado por convite do administrador da sua empresa.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm loading={loading} setLoading={setLoading} />
          </CardContent>
        </Card>
        <IntegraLabsCredit className="mt-6 opacity-70" />
      </div>
    </div>
  );
}

function LoginForm({ loading, setLoading }: { loading: boolean; setLoading: (v: boolean) => void }) {
  const toast = useSonnerToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) toast.error(error.message);
    setLoading(false);
  };

  return (
    <form onSubmit={handleLogin} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="login-email">Email</Label>
        <Input id="login-email" name="email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-password">Senha</Label>
        <Input id="login-password" name="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Entrando...' : 'Entrar'}
      </Button>
    </form>
  );
}
