import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { KeyRound, LogOut, RefreshCw, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";

type GatePhase = "loading" | "enroll" | "challenge" | "ready" | "error";

export function PrivilegedMfaGate({ children }: PropsWithChildren) {
  const { currentRole, currentTenant } = useTenant();
  const { user, signOut } = useAuth();
  const [phase, setPhase] = useState<GatePhase>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const initializedFor = useRef<string | null>(null);
  const privileged = currentRole === "owner" || currentRole === "admin";

  const initialize = useCallback(async () => {
    if (!privileged) {
      setPhase("ready");
      return;
    }

    setError(null);
    setPhase("loading");
    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error) throw assurance.error;
    if (assurance.data.currentLevel === "aal2") {
      setPhase("ready");
      return;
    }

    const factors = await supabase.auth.mfa.listFactors();
    if (factors.error) throw factors.error;
    const verifiedFactor = factors.data.totp.find((factor) => factor.status === "verified");
    if (verifiedFactor) {
      setFactorId(verifiedFactor.id);
      setPhase("challenge");
      return;
    }

    const enrollment = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `AGVLog ${new Date().toISOString()}`,
    });
    if (enrollment.error) throw enrollment.error;
    setFactorId(enrollment.data.id);
    setQrCode(enrollment.data.totp.qr_code);
    setSecret(enrollment.data.totp.secret);
    setPhase("enroll");
  }, [privileged]);

  useEffect(() => {
    const contextKey = `${currentTenant?.id ?? "none"}:${currentRole ?? "none"}`;
    if (initializedFor.current === contextKey) return;
    initializedFor.current = contextKey;
    initialize().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Não foi possível iniciar o MFA.");
      setPhase("error");
    });
  }, [currentRole, currentTenant?.id, initialize]);

  const verify = async () => {
    if (!factorId || code.trim().length < 6) return;
    setSubmitting(true);
    setError(null);
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error) throw challenge.error;
      const verification = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code: code.trim(),
      });
      if (verification.error) throw verification.error;
      setCode("");
      setPhase("ready");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Código inválido ou expirado.");
    } finally {
      setSubmitting(false);
    }
  };

  const retryInitialization = () => {
    void initialize().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Não foi possível iniciar o MFA.");
      setPhase("error");
    });
  };

  if (!privileged || phase === "ready") return <>{children}</>;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <CardTitle>Verificação em duas etapas</CardTitle>
          <CardDescription>
            Contas owner e admin precisam confirmar um segundo fator antes de acessar dados do tenant.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {phase === "loading" ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" /> Verificando sua sessão…
            </div>
          ) : null}

          {phase === "enroll" ? (
            <div className="space-y-3">
              <p className="text-sm">Escaneie o QR code no seu aplicativo autenticador e informe o código gerado.</p>
              {qrCode ? <img src={qrCode} alt="QR code para configurar o autenticador" className="mx-auto h-52 w-52 rounded bg-white p-2" /> : null}
              {secret ? (
                <p className="break-all rounded bg-muted p-2 font-mono text-xs">
                  Chave manual: {secret}
                </p>
              ) : null}
            </div>
          ) : null}

          {phase === "challenge" ? (
            <p className="text-sm text-muted-foreground">
              Abra seu aplicativo autenticador e informe o código atual.
            </p>
          ) : null}

          {(phase === "enroll" || phase === "challenge") ? (
            <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void verify(); }}>
              <div className="space-y-1.5">
                <Label htmlFor="mfa-code">Código de 6 dígitos</Label>
                <Input
                  id="mfa-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting || code.length < 6}>
                <KeyRound className="mr-2 h-4 w-4" />
                {submitting ? "Verificando…" : "Confirmar código"}
              </Button>
            </form>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Não foi possível validar o MFA</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {phase === "error" ? (
            <Button type="button" variant="outline" className="w-full" onClick={retryInitialization}>
              Tentar novamente
            </Button>
          ) : null}

          <Button type="button" variant="ghost" className="w-full" onClick={() => { void signOut(); }}>
            <LogOut className="mr-2 h-4 w-4" /> Sair de {user?.email ?? "esta conta"}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
