import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-sm font-mono whitespace-pre-wrap max-w-4xl mx-auto leading-relaxed text-gray-800">
      <h1 className="font-bold text-lg mb-4">Lovable — Interação 1: contenção P0 e fechamento de segurança do AGVLog</h1>
      <p>Você está trabalhando no repositório AGVLog/Logistics Navigator. Esta interação é exclusivamente de contenção P0, segurança multi-tenant e proteção de dados/fiscal.</p>
      <p className="mt-2 text-red-600 font-semibold">Não tente nesta interação reescrever filtros, aplicativo do motorista, portal do cliente, builders completos de CT-e/NFS-e/MDF-e ou identidade visual. Esses módulos serão corrigidos depois que os riscos de dados e segurança forem fechados.</p>
      
      <h2 className="font-bold mt-4 border-b pb-1">Objetivo desta interação</h2>
      <p>Entregar uma base segura para as próximas correções, resolvendo:</p>
      <ul className="list-disc pl-5">
        <li>diagnóstico auditável da migration que arquivou documentos sem filtro de tenant;</li>
        <li>tenant explícito e RBAC no hub-fiscal-proxy;</li>
        <li>webhook fiscal aderente ao contrato HMAC do Hub Fiscal;</li>
        <li>inbox idempotente e reconciliação de callbacks não associados;</li>
        <li>bloqueio de RPCs SECURITY DEFINER sem escopo/autorização;</li>
        <li>testes automatizados que comprovem ausência de acesso cross-tenant.</li>
      </ul>

      <h2 className="font-bold mt-4 border-b pb-1 text-red-700">Restrições absolutas</h2>
      <ul className="list-disc pl-5">
        <li>Não edite migrations históricas já aplicadas.</li>
        <li>Não faça UPDATE fiscal_documents SET deleted_at = NULL em massa.</li>
        <li>Não coloque UUID de produção em nova migration.</li>
        <li>Não faça alteração destrutiva sem dry-run e trilha de auditoria.</li>
        <li>Não exponha API key, service role, segredo HMAC ou payload sensível em browser/log/resposta.</li>
        <li>Não escolha tenant com .limit(1) sobre memberships.</li>
        <li>Não use service role antes de validar usuário, tenant, capability e ownership.</li>
        <li>Não retorne sucesso se a persistência local falhar.</li>
        <li>Não descarte callback desconhecido com 200.</li>
        <li>Não declare a tarefa concluída sem build/typecheck/testes e relatório real.</li>
      </ul>

      <h2 className="font-bold mt-4">1. Diagnóstico da migration destrutiva</h2>
      <p>A migration abaixo é crítica: supabase/migrations/20260815070209_da1a17dc-d2ad-48c1-a18c-798a87c6feba.sql</p>
      <p>Ela executa UPDATE public.fiscal_documents SET deleted_at = NOW() para documentos inbound sem filtro de tenant_id e com UUID específico.</p>
      
      <h3 className="font-semibold mt-2">Implementar</h3>
      <p>Crie uma migration forward-only que adicione infraestrutura de recuperação auditável, sem restaurar automaticamente nenhum documento:</p>
      <ul className="list-disc pl-5">
        <li>tabela data_recovery_batches: id, tenant_id, recovery_type, status; created_by, approved_by, reason; dry_run_summary, timestamps; status controlado: draft, reviewed, approved, executing, completed, failed, cancelled.</li>
        <li>tabela data_recovery_items: lote, tenant e entidade; entity_type, entity_id; snapshot atual e snapshot anterior/evidência quando disponível; ação proposta; evidence_source, evidence_details; resultado, erro e timestamps; unique por lote/entidade.</li>
        <li>RPC administrativa build_fiscal_documents_deleted_recovery_dry_run(...): acessível somente a superadmin/service role explicitamente autorizada; recebe intervalo de tempo e, opcionalmente, tenant; apenas lista candidatos, agrupando por tenant, deleted_at, origem/importação e vínculos; não altera dados.</li>
        <li>RPC/worker de execução separado: exige lote approved; processa somente IDs presentes no lote; valida novamente tenant e estado atual; é idempotente; registra before/after e audit log; executa em transação por lote ou chunk seguro; nunca usa uma condição ampla para restaurar tudo.</li>
        <li>consulta/relatório de consistência pós-recuperação: documentos sem load_items; links órfãos; divergências de tenant; contagem antes/depois por tenant.</li>
      </ul>
      <p className="mt-2 italic">Documente que a aprovação depende de comparação com backup/PITR ou evidência de auditoria. Não invente snapshot anterior quando ele não estiver disponível.</p>

      <h2 className="font-bold mt-4">2. Tornar o tenant explícito no proxy fiscal</h2>
      <p>No supabase/functions/hub-fiscal-proxy/index.ts:</p>
      <ul className="list-disc pl-5">
        <li>adicione tenantId obrigatório ao contrato da requisição;</li>
        <li>autentique o JWT;</li>
        <li>valide membership ativa exatamente em tenantId;</li>
        <li>valide capability por ação: leitura: fiscal.read; emissão/importação: fiscal.emit; cancelamento/CC-e/eventos: fiscal.cancel ou capability específica; administração/reconciliação: fiscal.admin;</li>
        <li>negue ações fiscais para perfis motorista e portal-cliente, mesmo que tenham membership indireta;</li>
        <li>valide ownership no mesmo tenant para: emissionId; fiscalDocumentId; cteDocumentId; nfseDocumentId; emitterId; credencial do Hub;</li>
        <li>remova qualquer resolução por “primeira membership”;</li>
        <li>em todas as consultas por ID, inclua tenant;</li>
        <li>se o usuário informar ID pertencente a outro tenant, responda 404/forbidden sem vazar existência;</li>
        <li>mantenha API key apenas no servidor;</li>
        <li>adicione correlationId por requisição e logs estruturados sem segredos.</li>
      </ul>
      <p className="mt-2">Crie helpers reutilizáveis, por exemplo: requireAuthenticatedUser; requireTenantMembership; requireCapability; assertEntityTenant; resolveEmitterCredentialForTenant.</p>

      <h2 className="font-bold mt-4">3. Webhook HMAC e inbox idempotente</h2>
      <p>Use o contrato do arquivo hub-fiscal-api-v1-2026-08-20.csv.</p>
      <p>No hub-fiscal-webhook-in:</p>
      <ul className="list-disc pl-5">
        <li>leia rawBody com await req.text() antes de parsear;</li>
        <li>exija: x-hubfiscal-event; x-hubfiscal-delivery; x-hubfiscal-timestamp; x-hubfiscal-signature no formato sha256=&lt;hex&gt;;</li>
        <li>calcule HMAC-SHA256 sobre timestamp + '.' + rawBody;</li>
        <li>use comparação timing-safe;</li>
        <li>rejeite timestamp com diferença superior a 5 minutos;</li>
        <li>se o segredo não estiver configurado, falhe fechado com erro de configuração — nunca aceite qualquer callback;</li>
        <li>não aceite o segredo estático legado como substituto silencioso para HMAC;</li>
        <li>não grave corpo bruto completo em logs.</li>
      </ul>
      
      <h3 className="font-semibold mt-2">Criar fiscal_webhook_inbox</h3>
      <ul className="list-disc pl-5">
        <li>Campos mínimos: id; delivery_id unique; event_type; event_timestamp; payload_hash e payload JSON/raw seguro conforme política; signature_valid; identificadores do Hub: hub_document_id, plugnotas_id, id_integracao; tenant_id e emission_id quando resolvidos; status: received, processing, processed, unmatched, failed, discarded; attempt_count, last_error, next_retry_at; timestamps.</li>
      </ul>

      <h3 className="font-semibold mt-2">Processamento</h3>
      <ul className="list-disc pl-5">
        <li>Faça insert/upsert da inbox primeiro usando delivery_id.</li>
        <li>Delivery já processado deve retornar sucesso sem repetir efeitos.</li>
        <li>Resolva emissão com chave suficientemente escopada: tenant/api client, tipo, ambiente e identificador único.</li>
        <li>Se a emissão ainda não existir, marque unmatched; não descarte o evento.</li>
        <li>Crie worker/RPC service-role para reconciliar unmatched e failed.</li>
        <li>Atualize emissão e projeções numa transação lógica; se qualquer parte obrigatória falhar, marque failed e responda 5xx para permitir retry.</li>
      </ul>
      <p className="mt-2">Status canônicos aceitos: draft, processing, authorized, rejected, denied, cancel_processing, cancelled, cancel_rejected, inutilized, interrupted, error.</p>

      <h2 className="font-bold mt-4">4. Persistência segura da emissão</h2>
      <p>No ramo emit do proxy:</p>
      <ul className="list-disc pl-5">
        <li>torne externalId/idIntegracao obrigatório antes da chamada ao Hub;</li>
        <li>valide formato e estabilidade;</li>
        <li>persista uma tentativa local antes da chamada externa;</li>
        <li>adicione/garanta unique (tenant_id, document_type, environment, external_id);</li>
        <li>retry da mesma operação deve recuperar a tentativa existente;</li>
        <li>se insert/update local falhar, interrompa e retorne erro;</li>
        <li>use status HTTP correto e corpo estruturado;</li>
        <li>202 permanece processing.</li>
      </ul>

      <h2 className="font-bold mt-4">5. RPCs SECURITY DEFINER</h2>
      <p>Audite todas as funções novas e as diretamente relacionadas ao fiscal. Corrija imediatamente: monitor_simples_nacional_icms_violations()</p>
      <ul className="list-disc pl-5">
        <li>Recrie com: _tenant_id obrigatório; membership e capability fiscal/read; filtro de tenant em todas as tabelas; deleted_at IS NULL; casts JSON seguros; grant mínimo necessário.</li>
      </ul>

      <h2 className="font-bold mt-4">6. Testes obrigatórios</h2>
      <p>Crie testes automatizados para: Tenant/RBAC (acesso cross-tenant bloqueado), Webhook (assinatura HMAC válida, idempotência), Emissão (idempotência, persistência pré-hub), Recovery (segurança de execução).</p>
      
      <div className="mt-8 border-t pt-4 text-xs text-gray-400">
        Este documento contém as instruções verbatim solicitadas para exibição.
      </div>
    </div>
  );
};

export default Index;
