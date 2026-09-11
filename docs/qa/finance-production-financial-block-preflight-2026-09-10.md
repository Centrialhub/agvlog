# Preflight do primeiro bloco financeiro após fundação staged — 2026-09-10

Revisão local somente leitura do SQL; nenhuma consulta ou aplicação remota por este agente. Estado informado pelo coordenador: foundation staged, 30062933 e 30072744 aplicados. O manifesto429 e seu texto sobre rejeição anterior estão desatualizados quanto a esses avanços; não usar remote:null como autorização para reaplicar. 20260909212104 está incorporada no staged e deve ser excluída da execução.

## Primeiro bloco coeso de instalação (ainda sem ativação)

Ordem dos arquivos de20260909: 212514 finance_delivery_unloading; 213020 finance_movement_queries; 213959 finance_expense_batches; 215046 finance_delivery_supplier_guard; 220020 finance_expense_workspace_queries; 220941 finance_receipt_evidence; 221405 finance_expense_history_queries; 222851 finance_statement_intake; 223737 finance_statement_source_verification; 230507 finance_statement_queries; 231643 finance_statement_identity_review; 233625 finance_audit_queries.

Esse bloco fornece descarga, custo/alocação/complemento, evidência, extrato não conciliado e auditoria. Não fornece ainda o estado final do produto, projeção completa de pagamentos, conciliação final, fechamento ou proteções finais de invalidação. Instalar com can_access=false preservado. Os cinco testes expenseStatementJourney passaram com cadeia FINAL mais longa, não provam que apenas esse bloco já é operacional.

Pré-requisitos: objetos originais de ledger do staged (3tabelas, schema/helpers/wrapper), receivables/payables e seus writers/triggers efetivos, dispatch_stops/documents/trips, fiscal_documents/clients/drivers/cost_centers, Storage buckets/objects e auth. O plano operacional30080608→30192908 permanece necessário para a cadeia completa de recebimento; não remover guards/hash por causa de divergência. delivery_context referencia delivery_attempts e sua ancestralidade; ausência de cadeia preservada não pode ser mascarada por novas identidades de descarga.

## Efeitos imediatos, mesmo com gate false

215046 instala BEFORE locks financeiros bloqueantes em dispatch_stop_documents e atualização supplier_id/tenant_id de fiscal_documents, além constraint triggers diferidos que recusam fornecedor misto/escopo inválido. Isso afeta novas alterações operacionais sobre entregas existentes. Não reescreve legados mistos; checar sua quantidade e plano de correção. Locks row-first podem disputar escritores finance-first: não alegar ausência de deadlock só porque DDL passou; corpos posteriores/testes finais continuam relevantes.

220941 instala políticas restritivas no namespace receipts/{tenant}/finance-batches e retenção UPDATE/DELETE de arquivos referenciados; executa também para service writes via trigger. 222851 insere ou altera bucket finance-statements para privado/10MiB, nega mutação direta do navegador e retém originais. Conferir objeto preexistente e uploads em curso. Não há backfill de valores financeiros nesse bloco; bucket é alteração de configuração existente se já houver.

Busca em todas migrations locais encontrou somente a criação original de finance_private.can_access em212104, nenhuma redefinição posterior. Os patches184213/205941 adicionam chamadas de reautorização em writers, não alteram o gate. Assim stagedfalse permanece nesse inventário; confirmar corpo/ACL efetivos a cada bloco porque arquivo local não prova catálogo remoto.

12756 posterior agenda cron finance-fiscal-projection-every-minute automaticamente se cron.schedule existir. run_fiscal_queue exige auth.uid NULL e não consulta can_access: stagedfalse NÃO desativa projeção automática. Parar antes desse arquivo até coordenador garantir instalação do bloco fiscal e controle transacional do agendamento; nunca deixar janela entre commit do scheduler e desativação posterior. Também observar os triggers fiscais de04550 que enfileiram novos fatos antes do worker. Não remover silenciosamente o scheduler do original.

## SELECTs concretos antes/depois (coordenador executa)

Salvar resultados de catálogo, não dados comerciais. Nomes esperados antes do bloco devem resolver; objetos novos inesperadamente existentes exigem comparação, não DROP nem reaplicação cega.

```sql
select x, to_regclass(x) as relation from unnest(array[
 'public.finance_movements','public.finance_commands','public.finance_events',
 'public.receivables','public.payables','public.dispatch_stop_documents',
 'public.delivery_attempts','public.clients','public.cost_centers',
 'storage.objects','storage.buckets']) x;
select p.oid::regprocedure, p.prosecdef,p.proconfig,p.proacl,
 md5(pg_get_functiondef(p.oid)) as body_hash,pg_get_functiondef(p.oid) as definition
from pg_proc p where p.oid=to_regprocedure('finance_private.can_access(uuid)');
select finance_private.can_access(null::uuid) as gate_null;
-- false isoladamente não prova desativação: comparar o corpo literal staged salvo.
select id,public,file_size_limit from storage.buckets where id in ('receipts','finance-statements');
select count(*) as mixed_delivery_count from (
 select d.tenant_id,d.dispatch_stop_id from public.dispatch_stop_documents d
 join public.fiscal_documents f on f.tenant_id=d.tenant_id and f.id=d.fiscal_document_id
 group by d.tenant_id,d.dispatch_stop_id having count(distinct f.supplier_id)>1
) s;
select count(*) as invalid_scope_count from public.dispatch_stop_documents d
left join public.fiscal_documents f on f.tenant_id=d.tenant_id and f.id=d.fiscal_document_id
left join public.dispatch_stops s on s.tenant_id=d.tenant_id and s.id=d.dispatch_stop_id
where f.id is null or s.id is null;
```

Após bloco, catálogo mínimo de implantação/ACL/triggers (não substitui comparação de corpos com release):

```sql
select n.nspname,c.relname,c.relrowsecurity,c.relacl
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
 ('finance_unloading_charges','finance_expense_batches','finance_expense_items',
 'finance_expense_allocations','finance_statement_imports','finance_statement_rows',
 'finance_statement_verifications','finance_statement_identity_reviews','finance_statement_review_reversals');
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where policyname like 'finance%' order by schemaname,tablename,policyname;
select t.tgrelid::regclass,t.tgname,t.tgenabled,t.tgtype,t.tgdeferrable,t.tginitdeferred,
 t.tgfoid::regprocedure,pg_get_triggerdef(t.oid) as definition
from pg_trigger t where not t.tgisinternal and
(t.tgname like '%finance%' or t.tgfoid in
(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='finance_private'))
order by t.tgrelid::regclass::text,t.tgname;
select p.oid::regprocedure,p.prosecdef,p.proconfig,p.proacl,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='finance_private' or (n.nspname='public' and p.proname like '%finance%');
select to_regclass('cron.job'),to_regprocedure('cron.schedule(text,text,text)');
-- Executar somente se cron.job existir:
select jobname,active,command from cron.job where jobname like 'finance%';
```

Esperado: RLS nas tabelas novas, sem DML público direto; wrappers invoker e helpers definer com search_path vazio e concessões específicas. Não exigir que TODO helper financeiro seja privado semgrant: helpers autenticados intermediários são parte explícita do desenho. Verificação de extrato registra somente por service_role e valida ator/contexto; usuário não deve poder fabricar relatório verificado.

## Runtime e critério de ativação final

Deploy de SQL não publica Edge Functions. secure-upload precisa versão atual com namespaces financeiros, caminhos imutáveis, contexto de tenant ativo e sem upsert; finance-statement-verify precisa getUser, header tenant, download pelo caller, parsing real OFX/workbook e gravação autorizada service-role. Segredos SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY apenas no runtime, nunca no frontend. Conferir deployment e teste de upload/download/verificação real após liberação; a fixture local adaptou Auth/Storage e não prova rede/Edge hospedada.

Somente restaurar a política can_access original/revisada após cadeia final, guards/ACL/RLS/workers e UI compatíveis. Preparar ativação separada explícita e teste de owner/admin/operator permitido, driver inclusive misto e tenant alheio negados. Uma função existente/get_finance_accessfalse não constitui módulo disponível. Não usar reexecução212104 para ativar. Até lá leitores devem mostrar indisponibilidade legível.
