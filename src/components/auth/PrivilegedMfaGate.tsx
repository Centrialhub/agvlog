import { useLayoutEffect, useState, type PropsWithChildren } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { usePrivilegedMfa } from "@/hooks/usePrivilegedMfa";
import {resetNotificationScope} from '@/lib/notificationScope';
import { MEMBERSHIP_QUERY } from "@/components/auth/TenantDataBoundary";

type Flow = ReturnType<typeof usePrivilegedMfa>;

export function PrivilegedMfaGate({ children }: PropsWithChildren) {
  const { currentRole, currentTenant } = useTenant();
  const { user, session, loading, signOut } = useAuth();
  if (loading || !user || !currentTenant || !currentRole) return <p role="status">Confirmando contexto de acesso…</p>;
  if (currentRole !== "owner" && currentRole !== "admin") return <>{children}</>;
  return <MfaSession key={[user.id, currentTenant.id, currentRole].join(':')} actor={user.id}
    token={session?.access_token ?? ''} expiresAt={session?.expires_at} email={user.email} signOut={signOut}>{children}</MfaSession>;
}

function MfaSession({ children, actor, token, expiresAt, email, signOut }: PropsWithChildren<{
  actor: string; token: string; expiresAt?: number; email?: string; signOut: () => Promise<void>;
}>) {
  const flow = usePrivilegedMfa(actor, token, expiresAt);
  const client = useQueryClient();
  useLayoutEffect(() => {
    if (!flow.allowed) {
      client.removeQueries({ predicate: query => query.queryKey[0] !== MEMBERSHIP_QUERY });
      client.getMutationCache().clear();
      resetNotificationScope();
    }
  }, [client, flow.allowed, token]);
  if (flow.allowed) return <>{children}</>;
  return <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
    <Card className="w-full max-w-md">
      <CardHeader>
        <ShieldCheck className="mb-2 h-8 w-8 text-primary" />
        <CardTitle>Verificação em duas etapas</CardTitle>
        <CardDescription>Contas owner e admin precisam confirmar um segundo fator antes de acessar dados do tenant.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {flow.phase === 'loading' && <p role="status">Verificando sua sessão…</p>}
        {flow.phase === 'setup' && <>
          <p>Configure um aplicativo autenticador para proteger esta conta. Nenhuma mensagem SMS será enviada.</p>
          <Button type="button" className="w-full" disabled={flow.busy} onClick={() => { void flow.enroll(); }}>Configurar autenticador</Button>
        </>}
        {(flow.phase === 'challenge' || flow.phase === 'enroll') && <>
          {flow.factors.length > 1 && <div className="space-y-1.5">
            <Label htmlFor="mfa-factor">Autenticador</Label>
            <select id="mfa-factor" className="w-full rounded border bg-background p-2" value={flow.factorId} disabled={flow.busy} onChange={event => flow.selectFactor(event.target.value)}>
              {flow.factors.map(factor => <option key={factor.id} value={factor.id}>{factor.friendly_name ?? 'Autenticador'} ({factor.status === 'verified' ? 'verificado' : 'configuração incompleta'})</option>)}
            </select>
          </div>}
          {flow.enrollment ? <EnrollmentSecret key={'secret:'+flow.enrollment.id} enrollment={flow.enrollment} /> : <p className="text-sm">Abra seu aplicativo autenticador e informe o código atual. Uma configuração incompleta só pode ser concluída se você já salvou sua chave.</p>}
          <CodeForm key={'code:'+flow.factorId} busy={flow.busy} verify={flow.verify} />
          {flow.canDiscard && <DiscardSetup key={'discard:'+flow.factorId} busy={flow.busy} discard={flow.discard} />}
          {flow.canEnroll && <Button type="button" variant="outline" disabled={flow.busy} onClick={() => { void flow.enroll(); }}>Configurar autenticador AGVLog</Button>}
        </>}
        {flow.error && <Alert variant="destructive"><AlertTitle>Não foi possível validar o MFA</AlertTitle><AlertDescription>{flow.error}</AlertDescription></Alert>}
        {flow.phase === 'error' && <Button type="button" variant="outline" className="w-full" disabled={flow.busy} onClick={() => { void flow.refresh(); }}>Tentar novamente</Button>}
        <Button type="button" variant="ghost" className="w-full" onClick={() => { void signOut(); }}><LogOut className="mr-2 h-4 w-4" />Sair de {email ?? 'esta conta'}</Button>
      </CardContent>
    </Card>
  </main>;
}

function CodeForm({ busy, verify }: { busy: boolean; verify: (code: string) => Promise<void> }) {
  const [code, setCode] = useState('');
  return <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (!busy) { void verify(code); setCode(''); } }}>
    <div className="space-y-1.5"><Label htmlFor="mfa-code">Código de 6 dígitos</Label>
      <Input id="mfa-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric" autoComplete="one-time-code" maxLength={6} disabled={busy} autoFocus />
    </div>
    <Button type="submit" className="w-full" disabled={busy || !/^\d{6}$/.test(code)}><KeyRound className="mr-2 h-4 w-4" />{busy ? 'Verificando…' : 'Confirmar código'}</Button>
  </form>;
}

function EnrollmentSecret({ enrollment }: { enrollment: NonNullable<Flow['enrollment']> }) {
  const [show, setShow] = useState(false);
  return <div className="space-y-3">
    <p>Escaneie o QR code no seu aplicativo autenticador. A chave é exibida somente nesta configuração.</p>
    <img src={enrollment.qrCode} alt="QR code para configurar o autenticador" className="mx-auto h-52 w-52 rounded bg-white p-2" />
    <Label htmlFor="mfa-secret">Chave manual do autenticador</Label>
    <Input id="mfa-secret" type={show ? 'text' : 'password'} value={enrollment.secret} readOnly autoComplete="off" />
    <Button type="button" variant="outline" onClick={() => setShow(value => !value)}>{show ? 'Ocultar chave manual' : 'Mostrar chave manual'}</Button>
  </div>;
}

function DiscardSetup({ busy, discard }: { busy: boolean; discard: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) return <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(true)}>Descartar configuração incompleta</Button>;
  return <div className="space-y-2 rounded border p-3">
    <p>Descartar somente esta configuração AGVLog ainda não verificada? A chave deixará de funcionar e uma nova configuração será necessária.</p>
    <Button type="button" variant="destructive" disabled={busy} onClick={() => { setConfirming(false); void discard(); }}>Confirmar descarte da configuração</Button>
    <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>Manter configuração</Button>
  </div>;
}
