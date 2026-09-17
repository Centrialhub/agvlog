# Auditoria final de acesso financeiro —11/09/2026

Consultas somente SELECT em MAINDB qcvnsdrbcchaxvawcngk,03:49–03:57UTC. Nenhuma ativação/sentinel/DDL remoto por este agente. O catálogo continua mudando durante o rollout coordenado; repetir o checkpoint após a última aplicação.

## Bloqueios comprovados e correções locais

1. `register_employee_advance(uuid,uuid,numeric,date,text,text,text,boolean,boolean)`: SECURITY DEFINER, EXECUTE authenticated/service, sem anon; verificava apenas membership ativa/papel por is_tenant_operator_or_admin. Esse helper não verifica empresa ativa nem motorista misto. O writer escreve employee_advances e opcionalmente payables. Os triggers remotos dessas tabelas verificam cancelamento/fechamento/prova monetária, mas no caminho de período aberto não substituem autorização. Portanto RLS restrictive30716 não resolve esse definer. A opção mark_paid apenas gravava status/paid_at sem pagamento/movimento canônico.

Patch local CLI35125: MD5 exato da definição49e5731a3bce8b1b44c6e59dd494c629 e ACL/config observados; require_access antes de trabalho, bloqueio explícito mark_paid55000, trava finance, nova require_access, membership compartilhadaNOWAIT para preservar autorização durante escrita e require_access antes retorno. Não há replay nesse writer legado e ele continua não idempotente. Não foi inventado replay. Pending/approved e título aberto são preservados; pagamento deve seguir a operação canônica do título. A prova desta rodada confirma o título pendente e saldo zero pago; não testa seu pagamento posterior.

2. `get_delivery_receipt_operations_v1(uuid)`: definer público auth, só membership/papel; retornava templates/emails/batches e contagens driver_expenses de empresa vinculada diferente da ativa. Patch local CLI35306 guarda definiçãoMD583b35198187c1282483614806ab2ffd7/ACL, exige request_tenant_id+membership e conserva rolecheck. Operação não depende do gate financeiro; somente expenses torna-se null quando can_accessfalse. Restante do DTO inalterado. Agente UI recebeu contrato nullable para adaptar schema/renderização.

Hashes SHA256:35125 `ede46058efcb4a817f0c014033e218a9df593142ddce1dce1c3856db2227be7b`;35306 `4e6f8dcdef1c3400c4b2a1ae8ef03aac70b19c637b0851f201389cf3eefaa4a1`.

## Exclusões e delegação revisadas

- No catálogo observado, nenhuma view pública financeira (por nome e referências a finance_movements/payables/receivables/driver_expenses) e nenhuma tabela do escopo financeiro30716 sem tenant_id. Não houve exclusão concreta adicional para corrigir nesse conjunto; isso não é inventário de todas as relações do SSX.
- `list_statements` e `statement_lines` delegam aos originais, que exigem can_access antes das queries. `statement_coverage_review`→snapshot→statement_period_evidence, este exige can_access na entrada. `record_settlement_payment`→gatecustody→writer_without_cargo_gate, este exige can_access e não concede EXECUTEauthenticated diretamente. `review_finance_legacy_cut`→can_review_legacy_cut inclui can_access e papelowner/admin. Não são falhas por ausência da substring no wrapper.
- Helpers com anonEXECUTE `financial_receipt_path` e `not_driver` não retornam registros financeiros: primeiro classifica prefixo de texto; segundo retorna false sem authuid. A presença desse grant não foi confundida com um leitor sem escopo.
- `apply_load_aggregate_command` é definer operacional e só membership/papel, sem empresa ativa antes do replay. Ele apareceu por referenciar vínculos financeiros no bloqueio de exclusão. Não foi modificado nesta rodada; registrar revisão operacional separada de empresa ativa. Não é autorização para expandir a mudança do writer financeiro.

## Anexos

Os quatro buckets observados (receipts, finance-statements, occurrence-return-proofs, pallet-return-proofs) são privados. storage.objects possui restrictive empresa ativa e deny anon. Prefixos financeiros finance-batches,expense-receipts,payable-payments,receivable-payments,payables têm restrictivefinancial_receipt_path→can_read_receipt→can_access; finance-statements também. Expense-receipts usa adicionalmente session_allowed atual, que exige can_access+not_driver+membership interna. Escritas navegador nesses prefixes estão bloqueadas. Não foi identificado bypass de leitura financeira nesses prefixos.

Essa avaliação é de RLS/ACL e corpos de funções; não homologa o serviço externo de assinatura/download, scanners ou revogação de URLs já emitidas. Upload/scanner ainda bloqueado conforme coordenação, sem autorização para contornar essa indisponibilidade.

## Evidência e limites

`employeeAdvanceCompanyBoundary.test.ts`:3PGlite aprovados00:56:21local, lint0. Writer baseline real, helpers de empresa/financeiros reais, defaults extraídos por SELECT de pg_attrdef em MAINDB; confirma falha cross-company anterior, negação após patch, misto, mark_paid, títulos abertos e reader financefalse sem zerar informação oculta. Fixture relacional reduzida, sem simular escritor de sucesso. Teste não instala toda a cadeia de triggers financeiros, não prova browser/JWT criptográfico ou interleaving nativo. Nenhum PG nativo/TSC executado.
