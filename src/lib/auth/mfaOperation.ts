export class SupersededMfaOperation extends Error {}
export class MfaFlowError extends Error {}

// Aborting stops follow-up work and UI commits, not an Auth request already sent.
export async function boundedMfaOperation<T>(signal: AbortSignal, current: () => boolean, work: (check: () => void) => Promise<T>): Promise<T> {
  let active = true, timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  const check = () => { if (!active || signal.aborted || !current()) throw new SupersededMfaOperation(); };
  try {
    check();
    return await Promise.race([
      Promise.resolve().then(() => work(check)),
      new Promise<never>((_, reject) => {
        abort = () => reject(new SupersededMfaOperation());
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => reject(new MfaFlowError('A verificação demorou além do limite. Confira o estado atual antes de tentar novamente.')), 8000);
      }),
    ]);
  } finally { active = false; clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

export function mfaErrorMessage(error: unknown): string {
  if (error instanceof MfaFlowError) return error.message;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'mfa_verification_failed') return 'Código inválido. Confira o código atual no autenticador.';
  if (code === 'mfa_challenge_expired') return 'O desafio expirou. Informe um novo código.';
  if (code === 'mfa_factor_name_conflict') return 'Já existe uma configuração AGVLog. Atualize a verificação para recuperá-la.';
  if (code === 'mfa_factor_not_found') return 'Este fator não está mais disponível. Atualize a verificação.';
  return 'Não foi possível confirmar o MFA. Atualize a verificação e tente novamente.';
}
