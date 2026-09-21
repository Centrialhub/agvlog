export function getErrorMessage(error: unknown, fallback = 'Ocorreu um erro inesperado.'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

export function isExpiredSessionError(error: unknown): boolean {
  return /invalid refresh token|session expired|refresh_token_not_found|sessão expirou/i.test(getErrorMessage(error, ''));
}
