import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { AlertTriangle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { IntegraLabsCredit } from '@/components/branding/IntegraLabsCredit';
import { authErrorMessage } from '@/lib/auth/authErrorMessage';
import { driverLoginEmail, driverUsernameFromEmail } from '@/lib/auth/driverCredentials';

export default function Auth() {
  const [loading, setLoading] = useState(false);
  const { backendUnavailable } = useAuth();
  const [params, setParams] = useSearchParams();
  const driverAccess = params.get('access') === 'driver';

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center">
            <img src="/icons/agvlog-192.png" alt="AGV Logística" width={64} height={64} className="h-16 w-16 rounded-xl object-contain" />
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
                Não foi possível conectar ao serviço. Tente novamente em instantes.
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
              {driverAccess ? 'Use o usuário e a senha informados pela sua empresa.' : 'O acesso é criado por convite do administrador da sua empresa.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex gap-2">
              <Button type="button" variant={driverAccess ? 'default' : 'outline'} disabled={loading} aria-pressed={driverAccess} onClick={() => setParams({ access: 'driver' }, { replace: true })}>Motorista</Button>
              <Button type="button" variant={driverAccess ? 'outline' : 'default'} disabled={loading} aria-pressed={!driverAccess} onClick={() => setParams({}, { replace: true })}>Painel e clientes</Button>
            </div>
            <LoginForm key={driverAccess ? 'driver' : 'email'} driverAccess={driverAccess} loading={loading} setLoading={setLoading} />
          </CardContent>
        </Card>
        <IntegraLabsCredit className="mt-6" />
      </div>
    </div>
  );
}

function LoginForm({ driverAccess, loading, setLoading }: { driverAccess: boolean; loading: boolean; setLoading: (v: boolean) => void }) {
  const toast = useSonnerToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const loginEmail = driverAccess ? driverLoginEmail(email) : email.trim().toLowerCase();
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      if (error) toast.error(driverAccess && error.code === 'invalid_credentials' ? 'Usuário ou senha inválidos.' : authErrorMessage(error));
    } catch (error) {
      toast.error(error instanceof Error && error.message.startsWith('Use um usuário') ? error.message : authErrorMessage(error, 'Não foi possível conectar ao serviço de autenticação.'));
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (driverAccess || driverUsernameFromEmail(normalizedEmail)) {
      toast.info('Solicite a troca de senha ao painel operacional da sua empresa.');
      return;
    }
    if (!normalizedEmail) {
      toast.error('Informe seu e-mail para receber o link de redefinição.');
      return;
    }
    setResetting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: new URL('/set-password', window.location.origin).toString(),
      });
      if (error) throw error;
      toast.success('Se a conta existir, enviaremos um link de redefinição para esse e-mail.');
    } catch (error) {
      toast.error(authErrorMessage(error, 'Não foi possível solicitar a redefinição de senha.'));
    } finally {
      setResetting(false);
    }
  };

  return (
    <form onSubmit={handleLogin} className="space-y-4" aria-busy={loading}>
      <div className="space-y-2">
        <Label htmlFor="login-email">{driverAccess ? 'Usuário' : 'Email'}</Label>
        <Input id="login-email" name={driverAccess ? 'username' : 'email'} type={driverAccess ? 'text' : 'email'} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder={driverAccess ? 'seu.usuario' : 'seu.email@empresa.com.br'} className="h-11 text-base md:text-sm" value={email} onChange={e => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-password">Senha</Label>
        <div className="relative">
          <Input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" className="h-11 pr-12 text-base md:text-sm" value={password} onChange={e => setPassword(e.target.value)} required />
          <button type="button" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} aria-controls="login-password" aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)} className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {showPassword ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <Button type="submit" className="h-11 w-full" disabled={loading}>
        {loading && <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}
        {loading ? 'Entrando...' : 'Entrar'}
      </Button>
      {driverAccess ? <p className="text-center text-sm text-muted-foreground">Esqueceu sua senha? Solicite a troca ao painel operacional da sua empresa.</p> : <Button type="button" variant="link" className="w-full" disabled={loading || resetting} onClick={handlePasswordReset}>
        {resetting ? 'Enviando link...' : 'Esqueci minha senha'}
      </Button>}
    </form>
  );
}
