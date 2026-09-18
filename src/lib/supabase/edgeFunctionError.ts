/** Read the response body that FunctionsHttpError hides behind “non-2xx”. */
export async function edgeFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const candidate = error && typeof error === 'object'
    ? error as { message?: unknown; context?: unknown }
    : {};
  const response = candidate.context instanceof Response ? candidate.context : undefined;
  let message = '';
  if (response) {
    try {
      const payload: unknown = await response.clone().json();
      if (payload && typeof payload === 'object') {
        const body = payload as { error?: unknown; message?: unknown };
        message = typeof body.error === 'string' ? body.error
          : typeof body.message === 'string' ? body.message : '';
      }
    } catch {
      // Gateways may return empty or non-JSON bodies; preserve the HTTP status.
    }
  }

  if (response?.status === 401) return 'Não foi possível validar sua sessão. Entre novamente e tente outra vez.';
  if (response?.status === 403) return 'Seu usuário não tem permissão para esta ação nesta empresa.';
  if (response?.status === 429) return 'Limite de solicitações atingido. Aguarde alguns minutos e tente novamente.';
  if (/already (?:been )?registered|already exists/i.test(message)) {
    return 'Este e-mail já possui uma conta. Vincule o usuário existente à empresa.';
  }
  if (/email address .* is invalid|invalid email/i.test(message)) {
    return 'O serviço de e-mail recusou este endereço. Confira a grafia e o domínio do e-mail.';
  }
  if (message) return message;
  if (typeof candidate.message === 'string' && candidate.message && !/non-2xx/i.test(candidate.message)) {
    return candidate.message;
  }
  return response ? `${fallback} (HTTP ${response.status}).` : fallback;
}
