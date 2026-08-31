import { withFiscalCors } from '../_shared/fiscal-cors.ts';
// Consulta periódica de status das NFS-e que ficaram "processando" no provedor.
// Invocada pelo pg_cron (a cada 5 min) e também sob demanda pela UI.
// Para cada NFS-e pendente: consulta o Hub Fiscal (GET /hub_documents_get),
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

const HUB_BASE = (Deno.env.get('HUB_FISCAL_BASE_URL') || '').trim().replace(/\/$/, '');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ENC_KEY = Deno.env.get('AGVLOG_ENCRYPTION_KEY') || '';

// Somente estados realmente transitórios entram no polling automático.
// `issued`, `cancelled`, `error` e `rejected` são terminais até que o usuário
// solicite uma nova tentativa; repeti-los aqui sobrecarregava o provedor.
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
  const body = await req.json().catch(() => ({})) as { nfse_id?: string; tenant_id?: string };

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
    if (body.nfse_id) {
      const { data: target } = await admin.from('nfse_documents')
        .select('tenant_id').eq('id', body.nfse_id).maybeSingle();
      if (!target) return json(404, { success: false, error: { code: 'NOT_FOUND', message: 'NFS-e não encontrada' } });
      if (effectiveTenantId && effectiveTenantId !== target.tenant_id) {
        return json(400, { success: false, error: { code: 'TENANT_MISMATCH', message: 'NFS-e não pertence ao tenant informado' } });
      }
      effectiveTenantId = target.tenant_id;
    }

    if (!isCron) {
      if (!effectiveTenantId) {
        return json(400, { success: false, error: { code: 'TENANT_REQUIRED', message: 'tenant_id ou nfse_id é obrigatório' } });
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

    let q = admin.from('nfse_documents')
      .select('id, tenant_id, emitter_id, status, rps_number, status_check_attempts, created_at')
      .in('status', PENDING)
      .order('last_status_check_at', { ascending: true, nullsFirst: true })
      .limit(MAX_DOCS);
    if (body.nfse_id) q = admin.from('nfse_documents')
      .select('id, tenant_id, emitter_id, status, rps_number, status_check_attempts, created_at')
      .eq('id', body.nfse_id);
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
        .eq('nfse_document_id', doc.id)
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
            documentKind: 'nfse',
            documentId: doc.id,
            documentNumber: doc.rps_number,
            reasonCode: 'missing_provider_reference',
            attemptCount,
            firstSeenAt: doc.created_at,
            context: snapshot,
          });
        } else {
          await admin.from('nfse_documents').update({
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
        scope: 'nfse',
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
            documentKind: 'nfse',
            documentId: doc.id,
            documentNumber: doc.rps_number,
            reasonCode: status === 429 ? 'provider_rate_limited' : 'provider_unavailable',
            attemptCount,
            firstSeenAt: doc.created_at,
            context: safeSnapshot,
          });
        } else {
          await admin.from('nfse_documents').update({
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
          _tenant:doc.tenant_id,_emission:emission.id,_response:{document:{...d,id:d.id||emission.hub_document_id}},_http_status:status,
        });
        if(confirmation.error||confirmation.data?.confirmed!==true){results.push({id:doc.id,outcome:'reconciliation_required'});continue;}
        const checked=await admin.from('nfse_documents').update({last_status_check_at:new Date().toISOString(),status_check_attempts:(doc.status_check_attempts||0)+1,last_status_response:safeSnapshot}).eq('id',doc.id).eq('tenant_id',doc.tenant_id);
        if(checked.error)throw checked.error;
        if(!outcome && shouldDeadLetter(doc,true))await terminalizeFiscalPoll(admin,{tenantId:doc.tenant_id,documentKind:'nfse',documentId:doc.id,documentNumber:doc.rps_number,reasonCode:'status_timeout',attemptCount:(doc.status_check_attempts||0)+1,firstSeenAt:doc.created_at,context:safeSnapshot});
        results.push({id:doc.id,outcome:outcome||'pending'});continue;
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
        patch.status = 'issued';
        patch.nfse_number = d.number || null;
        patch.protocol_number = d.authorizationProtocol || d.plugnotasProtocol || null;
        patch.verification_code = d.accessKey || null;
        patch.pdf_url = d.pdfUrl || null;
        patch.xml_url = d.xmlUrl || null;
        patch.authorization_date = new Date().toISOString();
        patch.rejection_messages = null;
      } else if (outcome === 'rejected') {
        patch.status = 'rejected';
        patch.rejection_messages = { message: safeMessage || rawStatus || 'Rejeitada pelo provedor' };
      } else if (outcome === 'cancelled') {
        patch.status = 'cancelled';
        patch.cancelled = true;
        patch.cancellation_date = new Date().toISOString();
        // Libera as NFs vinculadas — voltam a aparecer para novo faturamento
        await admin
          .from('fiscal_documents')
          .update({ nfse_emitted_at: null, nfse_emitted_document_id: null })
          .eq('nfse_emitted_document_id', doc.id);
      } else if (shouldDeadLetter(doc, true)) {
        await terminalizeFiscalPoll(admin, {
          tenantId: doc.tenant_id,
          documentKind: 'nfse',
          documentId: doc.id,
          documentNumber: doc.rps_number,
          reasonCode: 'status_timeout',
          attemptCount: (doc.status_check_attempts || 0) + 1,
          firstSeenAt: doc.created_at,
          context: safeSnapshot,
        });
        results.push({ id: doc.id, rps: doc.rps_number, hub_status: rawStatus, outcome: 'dead_letter' });
        continue;
      }

      await admin.from('nfse_documents').update(patch).eq('id', doc.id);

      if (outcome) {
        await admin.from('nfse_events').insert({
          tenant_id: doc.tenant_id,
          nfse_id: doc.id,
          event_type: outcome === 'issued' ? 'issued' : outcome,
          message: outcome === 'issued'
            ? `Autorizada na consulta automática — nº ${d.number || '(sem número)'}`
            : `Consulta automática: ${rawStatus || outcome}${safeMessage ? ` — ${safeMessage}` : ''}`,
          payload: { source: 'nfse-status-poll', provider: safeSnapshot },
        });
      }

      results.push({ id: doc.id, rps: doc.rps_number, hub_status: rawStatus, outcome: outcome || 'pending' });
    }

    return json(200, {
      success: true,
      checked: results.length,
      partial: stoppedReason !== null,
      stopped_reason: stoppedReason,
      results,
    });
  } catch (e) {
    console.error('[nfse-status-poll] error', e);
    return json(500, { success: false, error: { code: 'POLL_FAILED', message: (e as Error).message } });
  }
}));
