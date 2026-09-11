# Mapa readonly de upgrade remoto/local — 2026-09-10

Projeto: qcvnsdrbcchaxvawcngk. Fontes: list_migrations e SELECTs de catálogo/histórico pelo conector Supabase. Sem alterações, dados de negócio, credenciais, corpos SQL remotos ou dados pessoais. Nenhum servidor PG local foi iniciado nesta tarefa.

## Resultado

- Histórico remoto: **406** versões. Arquivos locais capturados: **261**, dos quais 260 posteriores à baseline. Dois arquivos foram acrescentados por outras frentes após o preflight anterior de 259; o mapa é fotografia, não lista permanentemente congelada.
- **70** versões em comum. A baseline local 20260824224152 tem nome remoto harden_tenant_scoped_security_definer_rpcs; não representa aplicação remota do arquivo baseline consolidado.
- **191** versões locais pósbaseline ausentes do histórico remoto. Não são automaticamente 191 migrations a aplicar: **33** têm o mesmo nome sob outra versão remota.
- **80** arquivos locais com prefixo finance_ não possuem sua versão no histórico. Classificação ampliada por nome financeiro/folha/cobrança acrescenta sete dependências anteriores, totalizando **87**. Há **104** outros arquivos sem sua versão; a classificação é lexical, não grafo exaustivo de dependências.
- SHA256 local comparado com UTF8 do único statement armazenado remotamente: **1** mesma versão/bytes idênticos, **69** mesma versão/bytes diferentes. Diferença pode ser comentários, espaços, finais de linha ou SQL alterado; não prova divergência semântica. Nenhum corpo remoto foi exportado.
- Única igualdade exata de versão e bytes: 20260831124505_fiscal_emission_readiness.sql. Há uma igualdade de bytes sob versão diferente: local 20260831215026_protect_fiscal_certificate_secrets.sql versus remoto 20260831215043. Mesmo bytes idênticos não provam catálogo atual, pois migrations posteriores podem substituir objetos.

## Dependências concretas que impedem aplicar apenas os arquivos finance_

Catálogo remoto confirmou **ausentes** delivery_attempts, closing_report_charge_claims, closing_report_action_requests e receivable_financial_commands. Funções da allowlist encontradas foram somente _build_driver_settlement(uuid,uuid), approve_payroll_period(uuid) e generate_payroll_period(uuid,date,date,text,boolean,boolean). Não foram encontradas novas RPCs de movimento/lote/resumos fiscais/custos/carteira/previsão, nem comandos de recebível e fechamento consultados.

As definições existentes de driver_settlements, payroll_entry_items, client_invoice_charges, hub_fiscal_emissions e fiscal_source_reservations estão presentes; sua simples presença não certifica colunas, constraints, triggers ou contratos atuais.

Dependências locais anteriores identificadas por leitura dos SQLs e fixtures:

- 20260830102652 resultados operacionais → 20260830124944 correções → 20260830135338 tentativas → 20260830142048 reentrega. A previsão 153731 consulta tentativas; custos/acertos e cobranças precisam da identificação correta da entrega.
- 20260830161722 fechamento por tentativa → 20260830165149 criação atômica → 20260830174819 lifecycle/claims → 20260830183929 pagamentos/reversões de recebível → 20260830192908 lifecycle de fatura. Bases necessárias às projeções fiscais/recebimentos recentes.
- 20260830233637 ajustes auditados de acerto e 20260831144530 gate de fatura fiscal também não constam por versão no histórico remoto.
- Fundação e contexto multiempresa, RLS ativo, Storage, cadastro compartilhado e jornadas físicas de outras frentes entram intercalados no período financeiro. Não pressupor que possam ser ignorados ou aplicados sem revisar o efeito sobre can_access/tenant e gatilhos financeiros.

Este é um mapa para planejar o upgrade, não um ordenamento topológico completo nem prova de que todo objeto requerido foi consultado. relation_references no JSON é extração lexical de identificadores SQL, não resolução de pg_depend.

## Procedimento antes do deploy

1. Congelar manifesto de arquivos e reconciliar cada versão ausente com aliases de nome/hash e definições efetivas do catálogo. Não usar latest remoto 20260909221751 como corte: há lacunas mais antigas e timestamp renumerado.
2. Revisar as 69 diferenças de bytes das versões em comum por comparação controlada, sem exportar segredos embutidos em SQL histórico. Não reparar histórico ou reaplicar cegamente.
3. Construir upgrade forward específico a partir do estado remoto verificado, mantendo baseline consolidada apenas para instalação fresca. Ensaiar numa plataforma Supabase descartável com dependências reais; o preflight local anterior não passou por ausência de runtime.
4. Conferir gatilhos/ACL/claims/FKs finais e executar smoke de operações reais no schema integral antes de qualquer implantação. Esta tarefa não aplica migrations nem marca versões reparadas.

## Artefatos

- finance-upgrade-map-2026-09-10.json: todos os 261 arquivos com hashes, versão/nome remoto, aliases por nome e igualdade de bytes; inclui versões exclusivamente remotas.
- finance-upgrade-remote-migrations-2026-09-10.json: 406 versões e nomes completos.
- finance-upgrade-remote-sql-hashes-2026-09-10.json: 108 registros de hash/quantidade do histórico a partir da baseline, sem SQL.
- finance-upgrade-remote-statement-fingerprints-2026-09-10.json: fingerprint da representação array, para rastrear a coleta; não é hash do arquivo local.
- finance-upgrade-catalog-probe-2026-09-10.json e finance-upgrade-rpc-probe-2026-09-10.json: sondagens de metadados com escopo explícito.

## Versões financeiras sem registro remoto da mesma versão

- 20260830161722_make_closing_reports_attempt_aware.sql
- 20260830165149_make_closing_drafts_atomic.sql
- 20260830174819_audit_closing_lifecycle_and_charge_claims.sql
- 20260830183929_audit_receivable_payments_and_reversals.sql
- 20260830192908_audit_client_invoice_lifecycle.sql
- 20260830233637_audit_driver_settlement_adjustments.sql
- 20260831144530_attach_fiscal_invoice_gate.sql
- 20260909212104_finance_ledger_foundation.sql
- 20260909212514_finance_delivery_unloading.sql
- 20260909213020_finance_movement_queries.sql
- 20260909213959_finance_expense_batches.sql
- 20260909215046_finance_delivery_supplier_guard.sql
- 20260909220020_finance_expense_workspace_queries.sql
- 20260909220941_finance_receipt_evidence.sql
- 20260909221405_finance_expense_history_queries.sql
- 20260909222851_finance_statement_intake.sql
- 20260909223737_finance_statement_source_verification.sql
- 20260909230507_finance_statement_queries.sql
- 20260909231643_finance_statement_identity_review.sql
- 20260909233625_finance_audit_queries.sql
- 20260909234654_finance_legacy_driver_boundary.sql
- 20260909235237_finance_legacy_rpc_boundary.sql
- 20260909235705_finance_legacy_receipt_boundary.sql
- 20260910000731_finance_payroll_payment_projection.sql
- 20260910002244_finance_payable_movement_links.sql
- 20260910003529_finance_payable_link_reversal.sql
- 20260910004550_finance_fiscal_observation_queue.sql
- 20260910005509_finance_fiscal_receivable_basis.sql
- 20260910010034_finance_fiscal_receivable_projection.sql
- 20260910011121_finance_fiscal_cancellation_credits.sql
- 20260910012152_finance_receivable_fiscal_context.sql
- 20260910012756_finance_fiscal_queue_worker.sql
- 20260910013543_finance_bank_reconciliation_groups.sql
- 20260910014238_finance_reconciliation_workspace.sql
- 20260910015331_finance_reconciliation_history.sql
- 20260910020543_finance_ofx_statement_intake.sql
- 20260910021404_finance_native_statement_account.sql
- 20260910022059_finance_automatic_reference_reconciliation.sql
- 20260910023208_finance_automatic_reconciliation_status.sql
- 20260910023911_finance_account_period_review.sql
- 20260910024438_finance_receivable_movement_projection.sql
- 20260910025658_finance_receipt_allocation_corrections.sql
- 20260910030634_finance_explicit_receipt_refunds.sql
- 20260910032730_finance_movement_receipt_trace.sql
- 20260910033918_finance_internal_transfer_pairs.sql
- 20260910034731_finance_transfers_in_transit.sql
- 20260910035550_finance_transfer_period_position.sql
- 20260910120756_finance_manual_expense_recording.sql
- 20260910121937_finance_retire_legacy_payable_writers.sql
- 20260910122628_finance_bank_transaction_browser_boundary.sql
- 20260910123613_finance_retire_legacy_statement_import.sql
- 20260910124258_finance_retire_legacy_reconciliation.sql
- 20260910124716_finance_expense_cost_center_totals.sql
- 20260910125034_finance_manual_expense_cost_center.sql
- 20260910125357_finance_recorded_costs.sql
- 20260910130032_finance_payroll_recorded_costs.sql
- 20260910130540_finance_settlement_movement_links.sql
- 20260910130921_finance_settlement_movement_options.sql
- 20260910130956_finance_statement_period_evidence.sql
- 20260910131149_finance_settlement_link_audit.sql
- 20260910132406_finance_payroll_reimbursement_source_dedup.sql
- 20260910132411_finance_settlement_link_reversals.sql
- 20260910133352_finance_payroll_lifecycle_serialization.sql
- 20260910133355_finance_new_settlement_payment_candidates.sql
- 20260910133421_finance_settlement_payment_recording.sql
- 20260910133700_finance_retire_legacy_settlement_payment_writers.sql
- 20260910134943_finance_settlement_expense_context.sql
- 20260910134948_finance_canonical_trip_cost_settlement.sql
- 20260910135125_finance_retire_bulk_obligation_projection.sql
- 20260910140010_finance_account_opening_balances.sql
- 20260910141240_finance_cash_opening_counts.sql
- 20260910142143_finance_statement_coverage_approvals.sql
- 20260910142740_finance_legacy_adoption_inventory.sql
- 20260910142923_finance_statement_verification_reauthorization.sql
- 20260910143833_finance_legacy_payable_associations.sql
- 20260910143920_finance_legacy_payable_association_options.sql
- 20260910145616_finance_legacy_receipt_associations.sql
- 20260910145659_finance_legacy_receivable_association_options.sql
- 20260910150338_finance_legacy_receipt_movement_trace.sql
- 20260910151011_finance_legacy_integrity_inventory.sql
- 20260910151617_finance_receivable_portfolio_summary.sql
- 20260910152557_finance_recorded_cost_summary.sql
- 20260910152711_finance_fiscal_dashboard_summary.sql
- 20260910153731_finance_unbilled_freight_summary.sql
- 20260910154046_finance_receivables_paged_list.sql
- 20260910155442_finance_legacy_expense_cost_associations.sql
- 20260910155523_finance_legacy_cost_readers.sql

## Mesmo nome remoto sob timestamp diferente — não presumir pendência

| Arquivo local | Versão remota pelo nome | Bytes idênticos |
|---|---|---|
| 20260826002800_revoke_unsafe_legacy_rpc_signatures.sql | 20260826002301 | não |
| 20260826002900_restore_rls_helper_execute.sql | 20260826002408 | não |
| 20260826143000_fiscal_poll_dead_letters.sql | 20260826142151 | não |
| 20260826153408_restrict_integration_metadata_to_operational_roles.sql | 20260826213612 | não |
| 20260826160000_canonical_load_mutations.sql | 20260826213623 | não |
| 20260826161000_storage_upload_limits.sql | 20260826213631 | não |
| 20260826162000_fiscal_dead_letter_terminalize.sql | 20260826213640 | não |
| 20260826163000_fiscal_webhook_inbox_claims.sql | 20260826213649 | não |
| 20260826164000_harden_future_default_privileges.sql | 20260826213657 | não |
| 20260826165000_require_privileged_mfa.sql | 20260826214104 | não |
| 20260826170000_harden_portal_rpc_execution.sql | 20260826213733 | não |
| 20260826171000_remove_permissive_policy_overlaps.sql | 20260826215934 | não |
| 20260828160000_remove_privileged_mfa.sql | 20260828172412 | não |
| 20260828181017_set_default_emitter_atomic.sql | 20260828181403 | não |
| 20260828185133_enforce_invite_only_auth_users.sql | 20260828185518 | não |
| 20260828185757_harden_auth_invite_authorizations.sql | 20260828185827 | não |
| 20260829093000_complete_hub_fiscal_environment_contract.sql | 20260829133957 | não |
| 20260829161715_grant_portal_fiscal_scope_helper.sql | 20260829161509 | não |
| 20260831213305_add_official_tax_registry.sql | 20260831214749 | não |
| 20260831215026_protect_fiscal_certificate_secrets.sql | 20260831215043 | sim |
| 20260901190100_add_cursor_operator_event_reader.sql | 20260902015925 | não |
| 20260901201500_make_load_aggregate_commands_atomic.sql | 20260902020725 | não |
| 20260901210627_protect_linked_storage_evidence.sql | 20260901213736 | não |
| 20260901211644_add_operator_cursor_readers.sql | 20260902015933 | não |
| 20260901212053_revoke_replaced_dispatch_planner_acl.sql | 20260901213635 | não |
| 20260902004250_add_driver_fiscal_file_reader.sql | 20260902020825 | não |
| 20260902010528_add_driver_load_history_cursor.sql | 20260902015940 | não |
| 20260902010806_retire_legacy_driver_delivery_browser_acl.sql | 20260902015801 | não |
| 20260902011603_add_driver_event_history_cursor.sql | 20260902015947 | não |
| 20260902013811_enforce_atomic_load_number_allocation.sql | 20260902020756 | não |
| 20260902022000_reconcile_disabled_ssx_cron.sql | 20260902021534 | não |
| 20260902022100_index_atomic_load_foreign_keys.sql | 20260902021653 | não |
| 20260908195720_prepare_durable_nfse_issue_batches.sql | 20260909221751 | não |
