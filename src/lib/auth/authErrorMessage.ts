const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email ou senha inválidos.',
  email_not_confirmed: 'Confirme seu email antes de entrar.',
  user_banned: 'Este acesso está bloqueado. Procure o administrador.',
  over_request_rate_limit: 'Muitas tentativas. Aguarde um momento e tente novamente.',
  over_email_send_rate_limit: 'Muitas solicitações de email. Aguarde um momento e tente novamente.',
  weak_password: 'A senha não atende aos requisitos de segurança ou consta em bases de credenciais vazadas.',
  validation_failed: 'Os dados informados não atendem aos requisitos de segurança.',
};

export function authErrorMessage(error: unknown, fallback = 'Não foi possível concluir a autenticação.'): string {
  const failure = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : null;
  const code = typeof failure?.code === 'string' ? failure.code.toLowerCase() : undefined;
  if (code && MESSAGES[code]) return MESSAGES[code];
  const message = typeof failure?.message === 'string' ? failure.message.trim().toLowerCase() : '';
  if (message.includes('invalid login credentials')) return MESSAGES.invalid_credentials;
  if (message.includes('email not confirmed')) return MESSAGES.email_not_confirmed;
  if (message.includes('password') && (message.includes('weak') || message.includes('pwned') || message.includes('known'))) {
    return MESSAGES.weak_password;
  }
  return fallback;
}
