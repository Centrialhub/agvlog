import type { Json } from '@/integrations/supabase/types';

type JsonObject = { [key: string]: Json | undefined };

function asObject(value: Json | null | undefined): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

function asText(value: Json | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export interface CtePayloadRecipient {
  name: string | null;
  city: string | null;
  state: string | null;
}

export interface AuthorizedCteHubDetails {
  accessKey: string | null;
  remitter: {
    stateRegistration: string | null;
    street: string | null;
    number: string | null;
    neighborhood: string | null;
    city: string | null;
    cityIbge: string | null;
    state: string | null;
    zip: string | null;
  };
}

export function readCtePayloadRecipient(value: Json | null | undefined): CtePayloadRecipient {
  const root = asObject(value);
  const payload = asObject(root?.payload);
  const recipient = asObject(payload?.destinatario);
  const destination = asObject(payload?.fim);
  const address = asObject(recipient?.endereco);

  return {
    name: asText(recipient?.nome),
    city: asText(destination?.municipio) ?? asText(address?.municipio),
    state: asText(destination?.uf) ?? asText(address?.uf),
  };
}

export function readAuthorizedCteHubDetails(value: Json | null | undefined): AuthorizedCteHubDetails {
  const root = asObject(value);
  const document = asObject(root?.document);
  const payload = asObject(root?.payload) ?? asObject(document?.payload);
  const remitter = asObject(payload?.remetente) ?? asObject(payload?.rem);
  const address = asObject(remitter?.endereco);

  return {
    accessKey: asText(document?.access_key) ?? asText(document?.accessKey),
    remitter: {
      stateRegistration: asText(remitter?.ie),
      street: asText(address?.logradouro),
      number: asText(address?.numero),
      neighborhood: asText(address?.bairro),
      city: asText(address?.municipio),
      cityIbge: asText(address?.cMun) ?? asText(address?.codigoMunicipio),
      state: asText(address?.uf),
      zip: asText(address?.cep) ?? asText(address?.CEP),
    },
  };
}
