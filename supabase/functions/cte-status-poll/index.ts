import { fiscalHubBaseUrl, inspectFiscalTransport, lookupFiscalOperation } from '../_shared/fiscal-transport.ts';
import { withFiscalCors } from '../_shared/fiscal-cors.ts';
// Consulta periódica de status dos CT-e que ficaram "processando" no provedor.
// Invocada pelo pg_cron (a cada 1 min) e também sob demanda pela UI.
// Para cada CT-e pendente: consulta o Hub Fiscal (GET /hub_documents_get),
// grava a resposta completa (para conferência posterior) e atualiza o status
// local quando o provedor sai de "processando".

import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from '@supabase/supabase-js';
import { requireIntegrationCapability } from '../_shared/capabilities.ts';
import { isCronRequest } from '../_shared/cron-auth.ts';
import {
  classifyFiscalProviderStatus,
  getHubFiscalDocument,
  resolveHubFiscalToken,
  safeProviderSnapshot,
  shouldDeadLetter,
  terminalizeFiscalPoll,
} from '../_shared/fiscal-poll.ts';

const HUB_BASE = fiscalHubBaseUrl(Deno.env.get('HUB_FISCAL_BASE_URL'));
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ENC_KEY = Deno.env.get('AGVLOG_ENCRYPTION_KEY') || '';

// Somente estados realmente transitórios entram no polling automático.
// Estados autorizados, rejeitados ou com erro exigem ação explícita e não
// devem consumir chamadas ao provedor a cada minuto indefinidamente.
const PENDING = ['processing', 'queued', 'submitted', 'pending', 'transmitting'];
const MAX_DOCS = 50;

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(withFiscalCors(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { success: false, error: { code: 'METHOD_NOT_ALLOWED' } });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({})) as { document_id?: string; tenant_id?: string; action?: string };

  try {
    const isCron = await isCronRequest(req, SUPABASE_URL, SERVICE_KEY);
    let callerId: string | null = null;

    if (!isCron) {
      const authHeader = req.headers.get('Authorization') || '';
      if (!authHeader.startsWith('Bearer ')) return json(401, { success: false, error: { code: 'UNAUTHENTICATED' } });
      const authClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await authClient.auth.getUser();
      if (userError || !userData?.user) return json(401, { success: false, error: { code: 'UNAUTHENTICATED' } });
      callerId = userData.user.id;
    }

    let effectiveTenantId = body.tenant_id || null;
    if (body.document_id) {
      const { data: target } = await admin.from('fiscal_documents')
        .select('tenant_id').eq('id', body.document_id).maybeSingle();
      if (!target) return json(404, { success: false, error: { code: 'NOT_FOUND', message: 'CT-e não encontrado' } });
      if (effectiveTenantId && effectiveTenantId !== target.tenant_id) {
        return json(400, { success: false, error: { code: 'TENANT_MISMATCH', message: 'CT-e não pertence ao tenant informado' } });
      }
      effectiveTenantId = target.tenant_id;
    }

    if (!isCron) {
      if (!effectiveTenantId) {
        return json(400, { success: false, error: { code: 'TENANT_REQUIRED', message: 'tenant_id ou document_id é obrigatório' } });
      }
      const { data: membership } = await admin.from('tenant_memberships')
        .select('role').eq('tenant_id', effectiveTenantId).eq('user_id', callerId!)
        .eq('active', true).maybeSingle();
      if (!membership || !['owner', 'admin', 'operator'].includes(String(membership.role))) {
        return json(403, { success: false, error: { code: 'FORBIDDEN' } });
      }

      const capabilityResponse = await requireIntegrationCapability(admin, effectiveTenantId, 'fiscal');
      if (capabilityResponse) return capabilityResponse;
    }

    // Read-only maintenance diagnostic under the SAME authenticated user/cron checks.
    // diagnose performs no provider request; lookup performs GET only. Neither writes or retries.
    if (body.action === 'diagnose' || body.action === 'lookup') {
      if (!body.document_id || !effectiveTenantId) return json(400, { success: false, error: { code: 'DOCUMENT_REQUIRED' } });
      if (isCron) {
        const blocked = await requireIntegrationCapability(admin, effectiveTenantId, 'fiscal');
        if (blocked) return blocked;
      }
      const { data: emission, error: lookupError } = await admin.from('hub_fiscal_emissions')
        .select('id,emitter_id,environment,dispatch_state,hub_document_id,id_integracao')
        .eq('fiscal_document_id', body.document_id).eq('tenant_id', effectiveTenantId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (lookupError) throw lookupError;
      if (!emission) return json(404, { success: false, error: { code: 'EMISSION_NOT_FOUND' } });
      const token = await resolveHubFiscalToken(admin, { tenantId: effectiveTenantId, emitterId: emission.emitter_id,
        environment: emission.environment, scope: 'cte', encryptionKey: ENC_KEY, getSecret: name => Deno.env.get(name) });
      const lookup = body.action === 'lookup'
        ? await lookupFiscalOperation(HUB_BASE, token, emission.id_integracao, emission.environment) : undefined;
      return json(200, { success: true, lookup, emissionId: emission.id, environment: emission.environment,
        dispatchState: emission.dispatch_state, hasProviderReference: !!emission.hub_document_id,
        transport: inspectFiscalTransport(HUB_BASE, token) });
    }
    if (body.action) return json(400, { success: false, error: { code: 'UNKNOWN_ACTION' } });

    let q = admin.from('fiscal_documents')
      .select('id, tenant_id, emitter_id, status, invoice_number, status_check_attempts, created_at')
      .in('status', PENDING)
      .order('last_status_check_at', { ascending: true, nullsFirst: true })
      .limit(MAX_DOCS);
    if (body.document_id) q = admin.from('fiscal_documents')
      .select('id, tenant_id, emitter_id, status, invoice_number, status_check_attempts, created_at')
      .eq('id', body.document_id);
    else if (effectiveTenantId) q = q.eq('tenant_id', effectiveTenantId);

    const { data: docs, error } = await q;
    if (error) return json(400, { success: false, error: { code: 'QUERY_FAILED', message: error.message } });

    const results: Array<Record<string, unknown>> = [];
    let stoppedReason: 'rate_limited' | 'provider_unavailable' | null = null;

    for (const doc of (docs || [])) {
      if (isCron) {
        const capabilityResponse = await requireIntegrationCapability(admin, doc.tenant_id, 'fiscal');
        if (capabilityResponse) {
          results.push({ id: doc.id, outcome: 'disabled' });
          continue;
        }
      }

      const { data: emission } = await admin.from('hub_fiscal_emissions')
        .select('id, hub_document_id, environment, emitter_id, dispatch_key')
        .eq('fiscal_document_id', doc.id)
        .eq('tenant_id', doc.tenant_id)
        .order('created_at', { ascending: false })
        .limit(1).maybeSingle();

      if (!emission?.hub_document_id) {
        const snapshot = safeProviderSnapshot(424, {
          error: { code: 'MISSING_PROVIDER_REFERENCE', message: 'Emissão sem identificador no provedor' },
        });
        const terminal = shouldDeadLetter(doc, false);
        const attemptCount = (doc.status_check_attempts || 0) + 1;
        if (terminal) {
          await terminalizeFiscalPoll(admin, {
            tenantId: doc.tenant_id,
            documentKind: 'cte',
            documentId: doc.id,
            documentNumber: doc.invoice_number,
            reasonCode: 'missing_provider_reference',
            attemptCount,
            firstSeenAt: doc.created_at,
            context: snapshot,
          });
        } else {
          await admin.from('fiscal_documents').update({
            last_status_check_at: new Date().toISOString(),
            status_check_attempts: attemptCount,
            last_status_response: snapshot,
          }).eq('id', doc.id);
        }
        results.push({ id: doc.id, outcome: terminal ? 'dead_letter' : 'no_hub_document' });
        continue;
      }

      const token = await resolveHubFiscalToken(admin, {
        tenantId: doc.tenant_id,
        emitterId: emission.emitter_id || doc.emitter_id || null,
        environment: emission.environment,
        scope: 'cte',
        encryptionKey: ENC_KEY,
        getSecret: name => Deno.env.get(name),
      });
      const { status, data } = await getHubFiscalDocument({
        baseUrl: HUB_BASE,
        hubDocumentId: emission.hub_document_id,
        token,
      });
      const safeSnapshot = safeProviderSnapshot(status, data);
      // deno-lint-ignore no-explicit-any
      const d = ((data as any)?.document || {}) as Record<string, any>;
      const rawStatus = String(d.status || d.plugnotasStatus || '');
      const outcome = status < 400 ? classifyFiscalProviderStatus(rawStatus) : null;
      const safeMessage = typeof safeSnapshot.message === 'string' ? safeSnapshot.message : null;

      if (status === 429 || status >= 500) {
        stoppedReason = status === 429 ? 'rate_limited' : 'provider_unavailable';
        const terminal = shouldDeadLetter(doc, true);
        const attemptCount = (doc.status_check_attempts || 0) + 1;
        if (terminal) {
          await terminalizeFiscalPoll(admin, {
            tenantId: doc.tenant_id,
            documentKind: 'cte',
            documentId: doc.id,
            documentNumber: doc.invoice_number,
            reasonCode: status === 429 ? 'provider_rate_limited' : 'provider_unavailable',
            attemptCount,
            firstSeenAt: doc.created_at,
            context: safeSnapshot,
          });
        } else {
          await admin.from('fiscal_documents').update({
            last_status_check_at: new Date().toISOString(),
            status_check_attempts: attemptCount,
            last_status_response: safeSnapshot,
          }).eq('id', doc.id);
        }
        results.push({ id: doc.id, outcome: stoppedReason, message: safeMessage });
        break;
      }

      if(emission.dispatch_key) {
        const confirmation=await admin.rpc('complete_hub_fiscal_emission',{
          _tenant:doc.tenant_id,_emission:emission.id,_response:{...(data as Record<string,unknown>),document:{...d,id:d.id||emission.hub_document_id}},_http_status:status,
        });
        if(confirmation.error||confirmation.data?.confirmed!==true){results.push({id:doc.id,outcome:'reconciliation_required'});continue;}
        const committedOutcome=classifyFiscalProviderStatus(confirmation.data.status);
        const checked=await admin.from('fiscal_documents').update({last_status_check_at:new Date().toISOString(),status_check_attempts:(doc.status_check_attempts||0)+1,last_status_response:safeSnapshot}).eq('id',doc.id).eq('tenant_id',doc.tenant_id);
        if(checked.error)throw checked.error;
        if(!committedOutcome && shouldDeadLetter(doc,true))await terminalizeFiscalPoll(admin,{tenantId:doc.tenant_id,documentKind:'cte',documentId:doc.id,documentNumber:doc.invoice_number,reasonCode:'status_timeout',attemptCount:(doc.status_check_attempts||0)+1,firstSeenAt:doc.created_at,context:safeSnapshot});
        results.push({id:doc.id,outcome:committedOutcome||'pending'});continue;
      }

      // Histórico: guarda a resposta bruta para conferência posterior.
      await admin.from('hub_fiscal_emissions').update({
        status: rawStatus || undefined,
        plugnotas_status: d.plugnotasStatus || undefined,
        access_key: d.accessKey || undefined,
        authorization_protocol: d.authorizationProtocol || d.plugnotasProtocol || undefined,
        number: d.number || undefined,
        series: d.series || undefined,
        c_stat: d.cStat ?? undefined,
        message: safeMessage || undefined,
        last_response: safeSnapshot,
        last_synced_at: new Date().toISOString(),
      }).eq('id', emission.id);

      const patch: Record<string, unknown> = {
        last_status_check_at: new Date().toISOString(),
        status_check_attempts: (doc.status_check_attempts || 0) + 1,
        last_status_response: safeSnapshot,
      };
      if (outcome === 'issued') {
        patch.status = 'authorized';
        patch.sefaz_status = 'authorized';
        patch.access_key = d.accessKey || null;
        patch.sefaz_protocol = d.authorizationProtocol || d.plugnotasProtocol || null;
        patch.sefaz_message = safeMessage;
      } else if (outcome === 'rejected') {
        patch.status = 'rejected';
        patch.sefaz_status = 'rejected';
        patch.sefaz_message = safeMessage || rawStatus || 'Rejeitada pelo provedor';
        // Rejeição não gera documento fiscal válido: devolve imediatamente as
        // NFs vinculadas ao pool do CT-e Hub para permitir uma nova emissão.
        await admin
          .from('fiscal_documents')
          .update({ cte_emitted_at: null, cte_emitted_outbound_id: null })
          .eq('cte_emitted_outbound_id', doc.id);
      } else if (outcome === 'cancelled') {
        patch.status = 'cancelled';
        patch.sefaz_status = 'cancelled';
        patch.sefaz_message = safeMessage;
        // Libera as NFs vinculadas — voltam a aparecer para novo faturamento
        await admin
          .from('fiscal_documents')
          .update({ cte_emitted_at: null, cte_emitted_outbound_id: null })
          .eq('cte_emitted_outbound_id', doc.id);
      } else if (shouldDeadLetter(doc, true)) {
        await terminalizeFiscalPoll(admin, {
          tenantId: doc.tenant_id,
          documentKind: 'cte',
          documentId: doc.id,
          documentNumber: doc.invoice_number,
          reasonCode: 'status_timeout',
          attemptCount: (doc.status_check_attempts || 0) + 1,
          firstSeenAt: doc.created_at,
          context: safeSnapshot,
        });
        results.push({ id: doc.id, rps: doc.invoice_number, hub_status: rawStatus, outcome: 'dead_letter' });
        continue;
      }

      await admin.from('fiscal_documents').update(patch).eq('id', doc.id);

      if (outcome) {
        await admin.from('vehicle_events').insert({
          tenant_id: doc.tenant_id,
          document_id: doc.id,
          event_type: outcome === 'issued' ? 'authorized' : outcome,
          message: outcome === 'issued'
            ? `Autorizada na consulta automática — nº ${d.number || '(sem número)'}`
            : `Consulta automática: ${rawStatus || outcome}${safeMessage ? ` — ${safeMessage}` : ''}`,
          payload: { source: 'cte-status-poll', provider: safeSnapshot },
        });
      }

      results.push({ id: doc.id, rps: doc.invoice_number, hub_status: rawStatus, outcome: outcome || 'pending' });
    }

    return json(200, {
      success: true,
      checked: results.length,
      partial: stoppedReason !== null,
      stopped_reason: stoppedReason,
      results,
    });
  } catch (e) {
    console.error('[cte-status-poll] error', e);
    return json(500, { success: false, error: { code: 'POLL_FAILED', message: (e as Error).message } });
  }
}));
