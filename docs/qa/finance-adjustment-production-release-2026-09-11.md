# Verificação da implantação de descontos e perdas

Consulta somente leitura no projeto qcvnsdrbcchaxvawcngk em 11/09/2026, às 12:31 UTC (09:31 São Paulo). Nenhum dado de teste, emissão fiscal, escrita remota ou commit realizado nesta verificação.

## Resultado

As 23 funções do catálogo local finance-receivable-balance-adjustment-core-catalog-2026-09-11.json coincidem integralmente com produção: MD5 do prosrc normalizado CRLF→LF, SECURITY DEFINER/INVOKER, volatilidade, proconfig e ACL textual. Todas mantêm search_path vazio. Nenhuma função ausente ou divergência encontrada.

| Candidata local | Versão registrada em produção | Nome |
|---|---|---|
| 20260911115046 | 20260911122943 | finance_receivable_balance_adjustments |
| 20260911115916 | 20260911122959 | finance_cash_forecast_balance_adjustments |
| 20260911121356 | 20260911123017 | finance_receivable_adjustment_public_catalog |

Contagens às 12:31:22.68413 UTC: finance_private.receivable_balance_adjustment_events = **0**; public.receivables = **0**. As contagens confirmam ausência atual de registros; não constituem prova funcional com dados de cliente. As provas funcionais estão nos testes locais documentados no QA do core e do revisor.

## Catálogo conferido

| Assinatura | MD5 normalizado | Resultado |
|---|---|---|
| `finance_private.assert_receivable_adjustment_period(_tenant uuid, _receivable uuid, _effective_on date)` | `e047568a2e1aaa5a58547e047df4a76c` | MD5/ACL/config/flags iguais |
| `finance_private.audit_events(_tenant uuid, _filters jsonb)` | `50e5a5482c93a083adf0e78c64718243` | MD5/ACL/config/flags iguais |
| `finance_private.customer_credit_application_context(_tenant uuid, _credit uuid, _receivable uuid, _amount text, _application uuid)` | `f241d56af6f5c090316e40440b374dc7` | MD5/ACL/config/flags iguais |
| `finance_private.guard_receivable_balance_adjustment()` | `4296e366efa4441a8254af420f676eff` | MD5/ACL/config/flags iguais |
| `finance_private.lock_receivable_adjustment_date_source(_tenant uuid, _receivable uuid)` | `45950be8518a7bbc6542357a0bee81cd` | MD5/ACL/config/flags iguais |
| `finance_private.receivable_adjustment_binding(_tenant uuid, _receivable uuid)` | `dde949943fa172ff9d3dba05e276c1c7` | MD5/ACL/config/flags iguais |
| `finance_private.receivable_adjustment_composition(_snapshot jsonb)` | `c68f3512f047c0259dc3844c59754a8c` | MD5/ACL/config/flags iguais |
| `finance_private.receivable_adjustment_date_source(_tenant uuid, _receivable uuid)` | `83b399d94de1a386e2bd6eb0bca99882` | MD5/ACL/config/flags iguais |
| `finance_private.receivable_adjustment_evidence(_tenant uuid, _receivable uuid)` | `4eafcf6d0a88a1c343115df0bf086f8c` | MD5/ACL/config/flags iguais |
| `finance_private.receivable_balance_adjustment_context(_tenant uuid, _receivable uuid, _kind text, _amount text, _effective_on date, _adjustment uuid)` | `18d45e4335cb08f605154c7fbd5ca399` | MD5/ACL/config/flags iguais |
| `finance_private.receivable_balance_adjustment_history(_tenant uuid, _receivable uuid, _query jsonb)` | `f78c06d47b1dad1e9f9aff23a6e3d892` | MD5/ACL/config/flags iguais |
| `finance_private.receivable_credit_list_fields(_tenant uuid, _id uuid)` | `9593eacddd8b1b40e7bbf40fc8f7a979` | MD5/ACL/config/flags iguais |
| `finance_private.receivable_ledger_before_adjustments(_tenant uuid, _id uuid)` | `51dc0bea52d353a7b6407fb6faa50cf0` | MD5/ACL/config/flags iguais |
| `finance_private.receivable_portfolio_summary(_tenant uuid, _from date, _to date, _client uuid)` | `a085958eddf2dd0ede52ab5ac5a32dea` | MD5/ACL/config/flags iguais |
| `finance_private.record_receivable_balance_adjustment(_payload jsonb)` | `87df7da5ac1773b707caa932c7d85774` | MD5/ACL/config/flags iguais |
| `finance_private.release_receivable_customer_credits(_tenant uuid, _receivable uuid, _reason text, _observation uuid)` | `666967707f32bdebfa0470a7c8c5891e` | MD5/ACL/config/flags iguais |
| `finance_private.reverse_receivable_balance_adjustments(_tenant uuid, _receivable uuid, _reason text, _observation uuid)` | `2800048907fd95eb8c195418f40de463` | MD5/ACL/config/flags iguais |
| `finance_private.verify_receivable_balance_adjustment()` | `eef39da3e7be2ca9d6650d5e9ea11b1d` | MD5/ACL/config/flags iguais |
| `public._guard_receivable_ledger()` | `53c2b64bb32ed0b64a0046ea3489bdef` | MD5/ACL/config/flags iguais |
| `public._invoice_lifecycle_snapshot(_tenant uuid, _id uuid)` | `2de9bcba3ca0f9e059709ddef04db229` | MD5/ACL/config/flags iguais |
| `public._receivable_financial_snapshot(_tenant uuid, _id uuid)` | `904d7c409cb01ce8b720f257baea21af` | MD5/ACL/config/flags iguais |
| `public._receivable_ledger_evidence(_tenant uuid, _id uuid)` | `13a2dd644cfcc39fa528e07b6fa29bbf` | MD5/ACL/config/flags iguais |
| `public.get_closing_report_action_context(_tenant_id uuid, _report_id uuid)` | `a86ff529603b68ad69ab9bd6f2e2da31` | MD5/ACL/config/flags iguais |

Escopo: catálogo do core e presença das três versões no histórico. Não foram invocados writers nem executados testes funcionais em produção. A publicação do frontend é responsabilidade da tarefa raiz.
