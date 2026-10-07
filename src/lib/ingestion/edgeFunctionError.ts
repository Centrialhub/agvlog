interface EdgeFunctionErrorLike {
  message?: unknown;
  context?: {
    clone?: () => { json: () => Promise<unknown> };
    json?: () => Promise<unknown>;
  };
}

function getResponseMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const candidate = body as { error?: unknown; message?: unknown };
  if (typeof candidate.error === 'string' && candidate.error.trim()) return candidate.error;
  if (typeof candidate.message === 'string' && candidate.message.trim()) return candidate.message;
  return null;
}

export async function getEdgeFunctionErrorMessage(error: unknown): Promise<string> {
  const candidate = error && typeof error === 'object' ? error as EdgeFunctionErrorLike : {};
  const fallback = typeof candidate.message === 'string' && candidate.message
    ? candidate.message
    : 'Erro ao chamar a função de extração da ORT.';
  const context = candidate.context;

  try {
    if (context && typeof context.clone === 'function') {
      const cloned = context.clone();
      const body = await cloned.json().catch((): null => null);
      const message = getResponseMessage(body);
      if (message) return message;
    }
    if (context && typeof context.json === 'function') {
      const body = await context.json().catch((): null => null);
      const message = getResponseMessage(body);
      if (message) return message;
    }
  } catch {
    // Keep the original Supabase message when the response body is unavailable.
  }

  if (/non-2xx/i.test(fallback)) {
    return 'A extração da ORT retornou erro no servidor, mas sem detalhe legível. Tente novamente e, se persistir, verifique os créditos/limites da IA do workspace.';
  }

  return fallback;
}
