import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import { readOperatorReferenceCatalog } from '@/lib/operator/operatorReferencePagination';
import { acknowledgeDurableOperatorCommand, isDefinitiveOperatorCommandRejection, prepareDurableOperatorCommand } from '@/lib/operator/durableOperatorCommand';
import { z } from 'zod';
import { normalizeCity } from '@/lib/utils/normalizeCity';

export type RouteDestination = string | {
  name: string;
  periodicity?: 'daily' | 'weekly' | 'biweekly' | 'monthly' | null;
  weekdays?: number[] | null;
  [key: string]: unknown;
};
export type OperationalRoute = Omit<Tables<'operational_routes'>, 'destinations'> & {
  destinations: RouteDestination[];
};
export type RecoverableOperationalRoute = OperationalRoute & { validationIssue: string };
export type OperationalRouteCatalog = OperationalRoute[] & {
  invalidCount: number;
  invalidRoutes: RecoverableOperationalRoute[];
};

export function cloneRouteDestinations(destinations: readonly RouteDestination[]): RouteDestination[] {
  return destinations.map(destination => (
    typeof destination === 'string'
      ? { name: destination }
      : { ...destination, weekdays: destination.weekdays ? [...destination.weekdays] : destination.weekdays }
  ));
}

export function hasDuplicateRouteDestinations(destinations: readonly RouteDestination[]): boolean {
  const seen = new Set<string>();
  for (const destination of destinations) {
    const key = normalizeCity(typeof destination === 'string' ? destination : destination.name);
    if (key && seen.has(key)) return true;
    if (key) seen.add(key);
  }
  return false;
}

const routeDestinationSchema = z.union([
  z.string().trim().min(1),
  z.object({
    name: z.string().trim().min(1),
    periodicity: z.enum(['daily', 'weekly', 'biweekly', 'monthly']).nullable().optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  }).passthrough(),
]);
const operationalRouteSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  created_at: z.string().datetime({ offset: true }),
  name: z.string().trim().min(1),
  destinations: z.array(routeDestinationSchema),
  active: z.boolean().nullable().optional(),
  classification: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  region_name: z.string().nullable().optional(),
}).passthrough();

const recoverableRouteIdentitySchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
}).passthrough();

function recoverRouteDestinations(value: unknown): RouteDestination[] {
  const candidates = Array.isArray(value) ? value : value == null ? [] : [value];
  return candidates.flatMap(candidate => {
    const parsed = routeDestinationSchema.safeParse(candidate);
    return parsed.success ? [parsed.data as RouteDestination] : [];
  });
}

function recoverInvalidRoute(row: unknown, tenantId: string): RecoverableOperationalRoute | null {
  const identity = recoverableRouteIdentitySchema.safeParse(row);
  if (!identity.success || identity.data.tenant_id !== tenantId) return null;
  const source = identity.data as Record<string, unknown>;
  const fallbackName = `Rota incompatível ${identity.data.id.slice(0, 8)}`;
  return {
    id: identity.data.id,
    tenant_id: tenantId,
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : fallbackName,
    description: typeof source.description === 'string' ? source.description : null,
    classification: typeof source.classification === 'string' ? source.classification : 'general',
    region_name: typeof source.region_name === 'string' ? source.region_name : null,
    periodicity_default: typeof source.periodicity_default === 'string' ? source.periodicity_default : null,
    active: source.active === true,
    destinations: recoverRouteDestinations(source.destinations),
    created_at: typeof source.created_at === 'string' ? source.created_at : '',
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : '',
    created_by: typeof source.created_by === 'string' ? source.created_by : null,
    updated_by: typeof source.updated_by === 'string' ? source.updated_by : null,
    validationIssue: 'Os destinos ou metadados armazenados não seguem o formato atual.',
  };
}

export function parseOperationalRouteCatalog(rows: unknown[], tenantId: string): OperationalRouteCatalog {
  const routes: OperationalRoute[] = [];
  const invalidRoutes: RecoverableOperationalRoute[] = [];
  let invalidCount = 0;
  for (const row of rows) {
    const parsed = operationalRouteSchema.safeParse(row);
    if (!parsed.success || parsed.data.tenant_id !== tenantId) {
      invalidCount += 1;
      const recoverable = recoverInvalidRoute(row, tenantId);
      if (recoverable) invalidRoutes.push(recoverable);
      continue;
    }
    routes.push(parsed.data as unknown as OperationalRoute);
  }
  routes.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR') || left.id.localeCompare(right.id));
  invalidRoutes.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR') || left.id.localeCompare(right.id));
  return Object.assign(routes, { invalidCount, invalidRoutes });
}

export function useOperationalRoutes(options: { includeInactive?: boolean } = {}) {
  const { includeInactive = false } = options;
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['operational_routes', currentTenant?.id, includeInactive, user?.id],
    queryFn: async () => {
      if (!currentTenant || !user) return Object.assign([] as OperationalRoute[], { invalidCount: 0, invalidRoutes: [] as RecoverableOperationalRoute[] });
      const rows = await readOperatorReferenceCatalog({
        tenantId: currentTenant.id,
        actorId: user.id,
        resource: 'operational_routes',
        includeInactive,
      });
      return parseOperationalRouteCatalog(rows, currentTenant.id);
    },
    enabled: !!currentTenant && !!user,
    retry: false,
  });
}

export function useCreateOperationalRoute() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<OperationalRoute> & Pick<OperationalRoute, 'name'>) => {
      const name = values.name.trim();
      if (!name) throw new Error('Nome da rota é obrigatório.');
      if (values.active !== false && (!Array.isArray(values.destinations) || values.destinations.length === 0)) throw new Error('Uma rota ativa precisa de ao menos um destino.');
      if (values.destinations && hasDuplicateRouteDestinations(values.destinations)) throw new Error('A mesma cidade não pode aparecer mais de uma vez na rota.');
      const { destinations, ...routeValues } = values;
      const payload: TablesInsert<'operational_routes'> = {
        ...routeValues,
        ...(destinations ? { destinations: destinations as unknown as Json } : {}),
        name,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      };
      const { data, error } = await supabase.from('operational_routes').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operational_routes'] }),
  });
}

export function useUpdateOperationalRoute() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, expectedUpdatedAt, ...values }: Partial<OperationalRoute> & { id: string; expectedUpdatedAt: string }) => {
      if (!currentTenant) throw new Error('Selecione uma empresa antes de atualizar a rota.');
      if (!expectedUpdatedAt) throw new Error('Não foi possível identificar a revisão da rota. Atualize a lista e tente novamente.');
      if (typeof values.name === 'string') values.name = values.name.trim();
      if (values.active === true && Array.isArray(values.destinations) && values.destinations.length === 0) throw new Error('Uma rota ativa precisa de ao menos um destino.');
      if (values.destinations && hasDuplicateRouteDestinations(values.destinations)) throw new Error('A mesma cidade não pode aparecer mais de uma vez na rota.');
      const { destinations, ...routeValues } = values;
      const payload: TablesUpdate<'operational_routes'> = {
        ...routeValues,
        ...(destinations ? { destinations: destinations as unknown as Json } : {}),
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from('operational_routes')
        .update(payload)
        .eq('tenant_id', currentTenant.id)
        .eq('id', id)
        .eq('updated_at', expectedUpdatedAt)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Esta rota foi alterada por outra pessoa. Atualize a lista antes de salvar novamente.');
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operational_routes'] }),
  });
}

export function useDeleteOperationalRoute() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, expectedUpdatedAt }: { id: string; expectedUpdatedAt: string }) => {
      if (!currentTenant) throw new Error('Selecione uma empresa antes de excluir a rota.');
      if (!user) throw new Error('Entre novamente antes de excluir a rota.');
      if (!expectedUpdatedAt) throw new Error('Não foi possível identificar a revisão da rota. Atualize a lista e tente novamente.');
      const command = await prepareDurableOperatorCommand({
        tenantId: currentTenant.id,
        actorId: user.id,
        action: 'delete_operational_route',
        entityId: id,
        payload: { expectedUpdatedAt },
      });
      try {
        const { data, error } = await supabase.rpc('delete_operational_route_v1' as never, {
          _tenant_id: currentTenant.id,
          _route_id: id,
          _expected_updated_at: expectedUpdatedAt,
          _request_id: command.requestId,
        } as never);
        if (error) {
          if (error.code === '40001' || error.message.includes('operational_route_changed')) {
            acknowledgeDurableOperatorCommand(command);
            throw new Error('Esta rota foi alterada por outra pessoa. Atualize a lista antes de excluir.');
          }
          throw error;
        }
        acknowledgeDurableOperatorCommand(command);
        return data;
      } catch (error) {
        if (isDefinitiveOperatorCommandRejection(error)) acknowledgeDurableOperatorCommand(command);
        throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operational_routes'] }),
  });
}
