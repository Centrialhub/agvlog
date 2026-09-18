// @vitest-environment node
import { FunctionsHttpError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { edgeFunctionErrorMessage } from '@/lib/supabase/edgeFunctionError';

const fallback = 'Erro ao criar conta';

describe('team Edge Function errors', () => {
  it('reveals the server error without consuming the original response', async () => {
    const response = Response.json({ error: 'Error sending invite email' }, { status: 400 });
    expect(await edgeFunctionErrorMessage(new FunctionsHttpError(response), fallback))
      .toBe('Error sending invite email');
    expect(await response.json()).toEqual({ error: 'Error sending invite email' });
  });

  it('reads gateway message payloads', async () => {
    const response = Response.json({ message: 'Function unavailable' }, { status: 503 });
    expect(await edgeFunctionErrorMessage(new FunctionsHttpError(response), fallback))
      .toBe('Function unavailable');
  });

  it.each([
    [401, 'Não foi possível validar sua sessão'],
    [403, 'Seu usuário não tem permissão'],
    [429, 'Limite de solicitações atingido'],
  ])('explains HTTP %s without a JSON body', async (status, message) => {
    const error = new FunctionsHttpError(new Response('', { status }));
    expect(await edgeFunctionErrorMessage(error, fallback)).toContain(message);
  });

  it('explains that an existing account should be linked', async () => {
    const error = new FunctionsHttpError(Response.json(
      { error: 'A user with this email address has already been registered' }, { status: 400 },
    ));
    expect(await edgeFunctionErrorMessage(error, fallback)).toContain('Vincule o usuário existente');
  });

  it('explains the invalid email reported by the invitation service', async () => {
    const error = new FunctionsHttpError(Response.json(
      { error: 'Email address "user@invalid.example" is invalid' }, { status: 400 },
    ));
    expect(await edgeFunctionErrorMessage(error, fallback)).toContain('Confira a grafia e o domínio');
  });

  it.each(['<html>Bad Gateway</html>', '', 'null', '{"error":{}}'])('handles unexpected response: %s', async body => {
    const error = new FunctionsHttpError(new Response(body, { status: 502 }));
    expect(await edgeFunctionErrorMessage(error, fallback)).toBe('Erro ao criar conta (HTTP 502).');
  });

  it('preserves ordinary errors and handles missing error data', async () => {
    expect(await edgeFunctionErrorMessage(new Error('Network unavailable'), fallback)).toBe('Network unavailable');
    expect(await edgeFunctionErrorMessage(null, fallback)).toBe(fallback);
  });
});
