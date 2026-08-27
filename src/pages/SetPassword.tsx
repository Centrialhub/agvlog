import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';
import { Truck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

const RULES = [
  { test: (v: string) => v.length >= 12, label: 'Pelo menos 12 caracteres' },
  { test: (v: string) => /[A-Z]/.test(v), label: 'Uma letra maiúscula' },
  { test: (v: string) => /[a-z]/.test(v), label: 'Uma letra minúscula' },
  { test: (v: string) => /[0-9]/.test(v), label: 'Um número' },
];

export default function SetPassword() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session) {
        setHasSession(true);
        setChecking(false);
      }
    });

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!mounted) return;
        setHasSession(!!session);
        setChecking(false);
      })
      .catch(() => {
        if (!mounted) return;
        setHasSession(false);
        setChecking(false);
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const allRulesOk = RULES.every(r => r.test(password));
  const matches = password.length > 0 && password === confirm;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allRulesOk) {
      toast.error('A senha não atende aos requisitos mínimos.');
      return;
    }
    if (!matches) {
      toast.error('As senhas não coincidem.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast.error(error.message || 'Não foi possível definir a senha.');
      setSaving(false);
      return;
    }
    setDone(true);
    setSaving(false);
    toast.success('Senha definida com sucesso.');
    setTimeout(() => navigate('/', { replace: true }), 1200);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary">
            <Truck className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">AGVLog</h1>
          <p className="mt-1 text-sm text-muted-foreground">Definir senha de acesso</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Criar sua senha</CardTitle>
            <CardDescription>
              Defina uma senha pessoal para concluir a ativação do seu acesso.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {checking ? (
              <p className="text-sm text-muted-foreground">Validando convite...</p>
            ) : done ? (
              <div className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p>Senha definida. Redirecionando para o sistema...</p>
              </div>
            ) : !hasSession ? (
              <div className="space-y-4">
                <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">Convite inválido ou expirado</p>
                    <p className="text-xs opacity-90">
                      O link de convite não é mais válido. Solicite ao administrador da sua empresa
                      o envio de um novo convite.
                    </p>
                  </div>
                </div>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/auth">Voltar para o login</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">Nova senha</Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={12}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirmar senha</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                    minLength={12}
                  />
                  {confirm.length > 0 && !matches && (
                    <p className="text-xs text-destructive">As senhas não coincidem.</p>
                  )}
                </div>

                <ul className="space-y-1 rounded-md bg-muted/50 p-3">
                  {RULES.map(rule => {
                    const ok = rule.test(password);
                    return (
                      <li
                        key={rule.label}
                        className={`text-xs ${ok ? 'text-primary' : 'text-muted-foreground'}`}
                      >
                        {ok ? '✓' : '•'} {rule.label}
                      </li>
                    );
                  })}
                </ul>

                <Button type="submit" className="w-full" disabled={saving || !allRulesOk || !matches}>
                  {saving ? 'Salvando...' : 'Definir senha'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
