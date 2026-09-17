# Bloco financeiro152711–170539 — ensaio de integração

23 arquivos completos, sem pular DO/guards, instalados sobre a cadeia fresh atual. Lista individual e hashes: finance-forward-fourth-block-reviewed-2026-09-11.json; manifesto de toda a cadeia: finance-forward-fourth-block-manifest-2026-09-11.json.

- 20260910152711_finance_fiscal_dashboard_summary.sql: Leitura de bases fiscais incorporadas; depende snapshots fiscais existentes; não emite documentos.
- 20260910153731_finance_unbilled_freight_summary.sql: Leitura de expectativa; exige tabela fiscal_source_reservations de31124505 e claims comerciais; não cria recebível.
- 20260910154046_finance_receivables_paged_list.sql: Paginação de recebíveis atuais por filtros; leitura integral server-side.
- 20260910155442_finance_legacy_expense_cost_associations.sql: Cria vínculos/reversões de custo legado; patch de dedup/folha e guard de driver_expenses. Operações posteriores preservam dinheiro e marcam acerto editável para recálculo.
- 20260910155523_finance_legacy_cost_readers.sql: Leitores de custo legado e contexto; depende155442 e audit.
- 20260910160441_finance_maintenance_cost_context.sql: Contexto de manutenção e helper monetário exato; depende tabelas manutenção/estoque baseline.
- 20260910160822_finance_legacy_cost_manual_audit.sql: Patch exato de classificação manual na auditoria.
- 20260910160950_finance_maintenance_labor_cost_associations.sql: Vínculo/reversão mão de obra; guards de origem manutenção. Nenhum backfill monetário.
- 20260910161129_finance_maintenance_labor_context.sql: Contexto de mão de obra; leitura baseada em160950.
- 20260910161702_finance_maintenance_direct_part_associations.sql: Peças diretas e claims compartilhados; backfill apenas labor ativo para tabela nova, duplicidade aborta. Guards em peças/OS/estoque e patches de mão de obra.
- 20260910161828_finance_maintenance_direct_part_context.sql: Contexto peça direta; depende161702/160441/auditoria.
- 20260910162807_finance_account_period_closure_foundation.sql: Tabelas imutáveis de fechamento, reabertura e dependências; comandos de capacidade admin/owner.
- 20260910162958_finance_account_period_close_snapshot.sql: Produtor snapshot de fechamento por conta/período, exige evidência/cobertura/revisão e guards.
- 20260910163109_finance_account_period_closed_source_guards.sql: Guards BEFORE em27 tabelas monetárias/fontes, finance advisory trylock mesmo sem fechamento; preservação de originais. Proteção conta de caixa recebe ajuste posterior175310 antes ativação plena.
- 20260910163116_finance_legacy_cut_reviews.sql: Classificação/revisão durável de corte; trigger adicional protegendo revisão usada por fechamento.
- 20260910164256_finance_account_period_history.sql: Histórico de fechamento/reabertura por conta, somente leitura.
- 20260910164711_reassert_finance_relation_rls_and_grants.sql: Reafirma RLS e revoga writes diretos authenticated/anon/service_role em23 tabelas; apenasSELECT permanece auth/service.
- 20260910164923_finance_account_period_closure_evidence.sql: Evidência congelada com conferência de hash e conjunto relacional de dependências.
- 20260910164942_finance_closed_period_late_payment_composition.sql: Constraints diferidas de composição tardia para pagamentos já comprovados em movimentos congelados; patch guard imediato, nenhum novo dinheiro permitido.
- 20260910165830_finance_period_manual_audit.sql: Patch auditoria manual de revisão/fechamento/reabertura.
- 20260910170213_finance_legacy_cut_settlement_mapping.sql: Resolve vínculos de acerto por IDs no corte legado e capacidade; não duplica pagamentos.
- 20260910170454_finance_stock_acquisition_associations.sql: Aquisição estoque: vínculos, reversões, dependências e expansão claims; guards de estoque/catálogo/peça.
- 20260910170539_finance_stock_acquisition_readers.sql: Leitores aquisição/estoque e auditoria manual; depende170454/160441.

## Resultado

financeForwardFourthBlockIntegration.test.ts: 1 PASS, 3,57s. Seis leitores públicos executados com perfil interno; os mesmos negados com gate false e motorista ativo de identidade mista. Preview de fechamento sem evidência é inelegível, blockers presentes; readiness dos guards instalado é true. Todas tabelas públicas finance_* têm RLS. Constraints flush realizado. Não houve alteração nos23 SQL de produto.

## Dependências e limites

Fixture precisou da declaração REAL de fiscal_source_reservations de31124505 (incluindo FKs/checks), sem instalar ou invocar seus writers fiscais. maintenance_orders/parts/stock_movements/items vêm do baseline real. A dependência operacional141149 permanece instalada na preparação anterior. Não é reset integral Supabase; Auth/storage são fixtures e cron ausente usa branch real sem agendamento. Nenhum documento fiscal emitido, nenhum PG nativo, TSC ou alteração remota.

Este ensaio prova instalação e leituras/negações representativas, não repete os cenários de concorrência e fechamento positivo/estoque já existentes em suítes próprias. Nenhuma leitura foi convertida em autorização de fechamento. Os guards e revogações listados acima têm efeitos antes de ativar APIs. Em especial: escritores legados concorrentes podem receber40001 devido ao lock de163109; service_role perde writes diretos em164711, portanto jobs devem usar comandos autorizados. Não ativar o módulo no meio desta cadeia: há correções posteriores já conhecidas (identidade cash175310, projeções pagas172624 e demais consumidores finais).
