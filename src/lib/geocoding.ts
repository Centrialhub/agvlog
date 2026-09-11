import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

const candidateSchema = z.object({
  label: z.string().min(1).max(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  confidence: z.number().min(0).max(1),
  accuracy_m: z.number().min(0).max(100000),
  bounds: z.array(z.number()).length(4).nullable(),
  provider: z.string().min(1).max(100),
  provider_type: z.string().max(100).nullable(),
});

const responseSchema = z.object({
  query: z.string(),
  provider: z.string(),
  candidates: z.array(candidateSchema).max(5),
});

export type GeocodingCandidate = z.infer<typeof candidateSchema>;

export interface ResolvedLocation {
  latitude: number;
  longitude: number;
  source: 'address_geocoded' | 'map_selected';
  address: string | null;
  provider: string | null;
  accuracy_m: number | null;
  confidence: number | null;
  audit: Json;
}

export const normalizeAddress = (value: string) => value.trim().replace(/\s+/g, ' ');

export const buildDeliveryAddress = (parts: Array<string | null | undefined>) =>
  normalizeAddress(parts.filter((part): part is string => Boolean(part?.trim())).join(', '));

export async function geocodeAddress(
  tenantId: string,
  address: string,
  entity?: { type: 'client' | 'dispatch_stop'; id: string },
): Promise<GeocodingCandidate[]> {
  const normalized = normalizeAddress(address);
  if (normalized.length < 8) throw new Error('Informe um endereço mais completo para pesquisar.');
  const body: Record<string, unknown> = { tenant_id: tenantId, address: normalized, limit: 5 };
  if (entity) {
    body.entity_type = entity.type;
    body.entity_id = entity.id;
  }
  const { data, error } = await supabase.functions.invoke('geocode-address', {
    body,
  });
  if (error) throw error;
  const parsed = responseSchema.safeParse(data);
  if (!parsed.success) throw new Error('O serviço de endereço retornou uma resposta inválida.');
  return parsed.data.candidates;
}

export const locationFromCandidate = (candidate: GeocodingCandidate, address: string): ResolvedLocation => ({
  latitude: candidate.latitude,
  longitude: candidate.longitude,
  source: 'address_geocoded',
  address: normalizeAddress(address),
  provider: candidate.provider,
  accuracy_m: candidate.accuracy_m,
  confidence: candidate.confidence,
  audit: { selected_label: candidate.label, provider_type: candidate.provider_type, bounds: candidate.bounds },
});

export const locationFromMap = (latitude: number, longitude: number, address?: string): ResolvedLocation => ({
  latitude,
  longitude,
  source: 'map_selected',
  address: address ? normalizeAddress(address) : null,
  provider: 'leaflet_map',
  accuracy_m: null,
  confidence: 1,
  audit: { selected_interactively: true },
});
