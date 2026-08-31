import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { boundedMfaOperation, MfaFlowError, mfaErrorMessage, SupersededMfaOperation } from '@/lib/auth/mfaOperation';
import { hasSharedAuthLock } from '@/lib/auth/authSessionCoordination';

export interface TotpFactor { id: string; status: 'verified' | 'unverified'; friendly_name?: string }
interface Enrollment { id: string; qrCode: string; secret: string }
type Phase = 'loading' | 'setup' | 'challenge' | 'enroll' | 'ready' | 'error';
interface Assessment { token: string; phase: Phase; error?: string }
const isAppFactor = (factor: TotpFactor) => factor.friendly_name === 'AGVLog' || factor.friendly_name?.startsWith('AGVLog ');

export function usePrivilegedMfa(actor: string, token: string, expiresAt?: number) {
  const [state, setState] = useState<Assessment>({ token, phase: 'loading' });
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [factorId, setFactorId] = useState('');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = useRef(''), knownEnrollment = useRef<Enrollment | null>(null);
  const active = useRef(true), latestToken = useRef(token), actionLock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useLayoutEffect(() => { latestToken.current = token; }, [token]);
  const live = Number.isFinite(expiresAt) && (expiresAt ?? 0) * 1000 > Date.now();
  const phase = state.token === token ? state.phase : 'loading';
  const allowed = live && phase === 'ready';

  const run = useCallback(async (work: (check: () => void) => Promise<void>, isAction = false) => {
    if (!active.current || (isAction && actionLock.current)) return;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const current = () => active.current && latestToken.current === token && controller.current === request;
    if (isAction) { actionLock.current = true; setBusy(true); }
    try {
      const checkLifetime = () => {
        if (!Number.isFinite(expiresAt) || (expiresAt ?? 0) * 1000 <= Date.now()) throw new MfaFlowError('Sua sessão expirou. Entre novamente para confirmar o MFA.');
      };
      checkLifetime();
      // Background tabs can defer timers. Check expiry at every async boundary,
      // not only when starting a flow or when the expiry timer finally runs.
      await boundedMfaOperation(request.signal, current, check => work(() => { check(); checkLifetime(); }));
    } catch (error) {
      if (!(error instanceof SupersededMfaOperation) && current()) setState({ token, phase: 'error', error: mfaErrorMessage(error) });
    } finally {
      if (current()) { actionLock.current = false; setBusy(false); }
    }
  }, [token, expiresAt]);

  const readFactors = useCallback(async (check: () => void) => {
    check();
    const result = await supabase.auth.getUser(token);
    check();
    if (result.error) throw result.error;
    if (result.data.user?.id !== actor) throw new MfaFlowError('A resposta não corresponde à conta atual. Entre novamente.');
    return (result.data.user.factors ?? []).filter(f => f.factor_type === 'totp' && (f.status === 'verified' || f.status === 'unverified')) as TotpFactor[];
  }, [actor, token]);

  const assertSession = useCallback(async (check: () => void) => {
    check();
    const result = await supabase.auth.getSession();
    check();
    if (result.error) throw result.error;
    if (result.data.session?.user.id !== actor || result.data.session.access_token !== token) throw new MfaFlowError('A sessão mudou. Atualize a verificação antes de continuar.');
  }, [actor, token]);

  const inspect = useCallback(async (check: () => void) => {
    check();
    // Explicit JWT: the installed SDK validates this user against Auth, rather
    // than merely interpreting a cached session's local claims.
    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel(token);
    check();
    if (assurance.error) throw assurance.error;
    const list = await readFactors(check);
    check();
    if (assurance.data.currentLevel === 'aal2') {
      setState({ token, phase: 'ready' }); setFactors([]); setFactorId('');
      knownEnrollment.current = null; setEnrollment(null); return;
    }
    if (assurance.data.currentLevel !== 'aal1') throw new MfaFlowError('Não há uma sessão autenticada válida. Entre novamente.');
    if (!hasSharedAuthLock()) throw new MfaFlowError('Este navegador não permite coordenar a autenticação entre abas. Use uma versão atualizada em conexão segura para confirmar o MFA.');
    setFactors(list);
    const available = list.filter(f => f.status === 'verified');
    const options = available.length ? available : list;
    const choice = options.find(f => f.id === selected.current) ?? options[0];
    selected.current = choice?.id ?? ''; setFactorId(selected.current);
    const memory = knownEnrollment.current;
    const reusable = memory && choice?.id === memory.id && choice.status === 'unverified';
    if (!list.some(f => f.id === memory?.id)) { knownEnrollment.current = null; setEnrollment(null); }
    setState({ token, phase: choice ? reusable ? 'enroll' : 'challenge' : 'setup' });
  }, [token, readFactors]);

  const refresh = useCallback(async () => {
    setState({ token, phase: 'loading' });
    await run(inspect);
  }, [inspect, run, token]);
  useEffect(() => {
    active.current = true; actionLock.current = false; setBusy(false);
    void refresh();
    const timer = setTimeout(() => {
      controller.current?.abort(); actionLock.current = false; setBusy(false);
      setState({ token, phase: 'error', error: 'Sua sessão expirou. Entre novamente para confirmar o MFA.' });
    }, Math.min(2147483647, Math.max(0, (expiresAt ?? 0) * 1000 - Date.now())));
    return () => { active.current = false; controller.current?.abort(); clearTimeout(timer); };
  }, [expiresAt, refresh, token]);

  const selectFactor = (id: string) => {
    if (busy || !factors.some(f => f.id === id && (!factors.some(option => option.status === 'verified') || f.status === 'verified'))) return;
    selected.current = id; setFactorId(id);
    setState({ token, phase: knownEnrollment.current?.id === id ? 'enroll' : 'challenge' });
  };

  const enroll = () => run(async check => {
    await assertSession(check);
    const existing = await readFactors(check);
    if (existing.some(f => f.status === 'verified' || isAppFactor(f))) { await inspect(check); return; }
    await assertSession(check);
    check();
    // A stable per-user friendly name is rejected by Auth if an earlier attempt
    // already created it. Never generate a new name after an uncertain response.
    const result = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'AGVLog' });
    check();
    if (result.error) throw result.error;
    if (result.data.type !== 'totp' || !result.data.id || !result.data.totp.secret || !result.data.totp.qr_code.startsWith('data:image/svg+xml;')) throw new MfaFlowError('A configuração não foi confirmada. Atualize a verificação antes de tentar novamente.');
    const memory = { id: result.data.id, qrCode: result.data.totp.qr_code, secret: result.data.totp.secret };
    knownEnrollment.current = memory; setEnrollment(memory);
    selected.current = memory.id; setFactorId(memory.id);
    setFactors([...existing, { id: memory.id, status: 'unverified', friendly_name: 'AGVLog' }]);
    setState({ token, phase: 'enroll' });
  }, true);

  const verify = (code: string) => {
    if (!/^\d{6}$/.test(code) || !factorId) return Promise.resolve();
    return run(async check => {
      await assertSession(check);
      const list = await readFactors(check);
      if (!list.some(f => f.id === factorId)) throw new MfaFlowError('Este fator não está mais disponível. Atualize a verificação.');
      await assertSession(check);
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      check(); if (challenge.error) throw challenge.error;
      if (!challenge.data.id || challenge.data.type !== 'totp') throw new MfaFlowError('Não foi possível confirmar o desafio TOTP.');
      await assertSession(check);
      const result = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
      check(); if (result.error) throw result.error;
      if (result.data.user?.id !== actor) throw new MfaFlowError('A confirmação não corresponde à conta atual.');
      // verify emits MFA_CHALLENGE_VERIFIED and updates AuthProvider. Only a
      // successful inspection of that current session can unlock the screen.
      await inspect(check);
    }, true);
  };

  const discard = () => run(async check => {
    await assertSession(check);
    const list = await readFactors(check), target = list.find(f => f.id === factorId);
    if (!target || target.status !== 'unverified' || !isAppFactor(target)) throw new MfaFlowError('Somente uma configuração AGVLog ainda não verificada pode ser descartada aqui.');
    await assertSession(check);
    const result = await supabase.auth.mfa.unenroll({ factorId });
    check(); if (result.error) throw result.error;
    knownEnrollment.current = null; setEnrollment(null); selected.current = ''; setFactorId('');
    await inspect(check);
  }, true);

  const chosen = factors.find(f => f.id === factorId);
  const options = factors.some(f => f.status === 'verified') ? factors.filter(f => f.status === 'verified') : factors;
  return { phase, allowed, busy, factors: options, factorId, enrollment: phase === 'enroll' ? enrollment : null,
    error: state.token === token ? state.error : undefined, canDiscard: chosen?.status === 'unverified' && isAppFactor(chosen),
    canEnroll: !factors.some(f => f.status === 'verified' || isAppFactor(f)),
    refresh, selectFactor, enroll, verify, discard };
}
