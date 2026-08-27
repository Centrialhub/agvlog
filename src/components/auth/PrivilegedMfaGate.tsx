import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, ShieldCheck } from 'lucide-react';

type GateState = 'loading' | 'enroll' | 'challenge' | 'verified' | 'error';

interface EnrollData {
  factorId: string;
  qrCode: string;
  secret: string;
}

export default function PrivilegedMfaGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [enrollData, setEnrollData] = useState<EnrollData | null>(null);
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const startEnrollment = useCallback(async () => {
    // Limpa fatores TOTP não verificados para evitar acúmulo
    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    const unverified = (factors?.all ?? []).filter(
      (f) => f.factor_type === 'totp' && f.status !== 'verified',
    );
    for (const f of unverified) {
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: f.id });
      if (unenrollError) throw unenrollError;
    }

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'AGVLog',
    });
    if (enrollError || !data) {
      setError(enrollError?.message ?? 'Não foi possível iniciar o cadastro do autenticador.');
      setState('error');
      return;
    }
    setEnrollData({
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
    setState('enroll');
  }, []);

  const evaluate = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const { data: aal, error: aalError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) throw aalError;
      if (aal?.currentLevel === 'aal2') {
        setState('verified');
        return;
      }

      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (factorsError) throw factorsError;
      const verified = (factors?.totp ?? []).find((f) => f.status === 'verified');
      if (verified) {
        setVerifiedFactorId(verified.id);
        setCode('');
        setState('challenge');
        return;
      }

      await startEnrollment();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao verificar a autenticação em dois fatores.');
      setState('error');
    }
  }, [startEnrollment]);

  useEffect(() => {
    void evaluate();
  }, [evaluate]);

  const submitCode = async (factorId: string) => {
    if (!/^\d{6}$/.test(code)) {
      setError('Informe o código numérico de 6 dígitos.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code,
      });
      if (verifyError) throw verifyError;

      const { data: aal, error: aalError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) throw aalError;
      if (aal?.currentLevel === 'aal2') {
        setState('verified');
      } else {
        setError('A verificação não elevou o nível de segurança. Tente novamente.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Código inválido ou expirado.');
    } finally {
      setSubmitting(false);
      setCode('');
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  if (state === 'verified') return <>{children}</>;

  if (state === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Verificando autenticação...
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Verificação em dois fatores
          </CardTitle>
          <CardDescription>
            {state === 'enroll'
              ? 'Cadastre um aplicativo autenticador para acessar funções privilegiadas.'
              : state === 'challenge'
                ? 'Digite o código do seu aplicativo autenticador.'
                : 'Não foi possível concluir a verificação.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {state === 'enroll' && enrollData && (
            <div className="space-y-4">
              <div className="flex justify-center rounded-md border bg-card p-3">
                <img src={enrollData.qrCode} alt="QR Code do autenticador" className="h-44 w-44" />
              </div>
              <div className="space-y-1">
                <Label>Chave manual</Label>
                <code className="block break-all rounded bg-muted p-2 text-xs">
                  {enrollData.secret}
                </code>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mfa-enroll-code">Código de 6 dígitos</Label>
                <Input
                  id="mfa-enroll-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                />
              </div>
              <Button
                className="w-full"
                disabled={submitting || code.length !== 6}
                onClick={() => submitCode(enrollData.factorId)}
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Ativar autenticador
              </Button>
            </div>
          )}

          {state === 'challenge' && verifiedFactorId && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="mfa-code">Código de 6 dígitos</Label>
                <Input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                />
              </div>
              <Button
                className="w-full"
                disabled={submitting || code.length !== 6}
                onClick={() => submitCode(verifiedFactorId)}
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verificar
              </Button>
            </div>
          )}

          {state === 'error' && (
            <Button className="w-full" variant="secondary" onClick={() => void evaluate()}>
              Tentar novamente
            </Button>
          )}

          <Button variant="ghost" className="w-full" onClick={() => void signOut()}>
            Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
