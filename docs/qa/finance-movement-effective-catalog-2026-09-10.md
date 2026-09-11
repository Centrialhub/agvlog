# Catálogo efetivo de consumidores de movimentos — 10/09/2026

Consulta executada em PGlite por `financeMovementEffectiveCatalog.test.ts`, com `collectEffectiveMovementCatalog`. Não é busca de migrations nem catálogo remoto. O JSON contém as definições retornadas por `pg_get_functiondef`, hashes SHA256, identidades, classificação explícita, dependências `pg_depend`, `pg_get_triggerdef`, estado dos triggers e views com suas dependências.

Foram instaladas, em cada domínio, as foundations reais 20260910182541_finance_movement_correction_foundation.sql (`1085d55520ecf05a34ca2c5a64e22e2830b64cdb906b2ef5aa37a07d8d09d74a`) e 20260910182830_finance_movement_correction_history.sql (`7885c5accd363b5b60828dbe785030c95eef3212f5de47f4912a3a324e2cc485`). Nenhum consumidor foi reescrito pelo inventário.

| Instalação | Funções totais | Referências diretas efetivas | Candidatos indiretos | Triggers instalados |
|---|---:|---:|---:|---:|
| cash_period_close | 124 | 23 | 30 | 73 |
| cost_inventory_cancellation | 101 | 5 | 10 | 69 |
| receivable_fiscal_projection | 211 | 7 | 5 | 73 |

A instalação principal é cash_period_close (banco, abertura, corte legado, fechamento, composição tardia e cadeias pagas). A segunda cobre custos/estoque/cancelamentos. A terceira cobre recebíveis/fiscal/refunds e associação legada. São três instalações independentes, não um schema único artificialmente consolidado. Cada diferença de definição permanece explícita.

## Classificação direta

| Função | Classificação | Instalações |
|---|---|---|
| account_opening | operational_reader | cash_period_close |
| account_period_close_snapshot | operational_reader | cash_period_close |
| account_period_guards_ready | guard | cash_period_close |
| account_period_review | operational_reader | cash_period_close |
| apply_payable_movement | writer | cash_period_close |
| assert_closed_source_mutable | guard | cash_period_close, cost_inventory_cancellation |
| cash_period_close_snapshot | operational_reader | cash_period_close |
| check_receipt_movement_capacity | guard | receivable_fiscal_projection |
| frozen_movement | guard | cash_period_close |
| late_payment_composition_proved | guard | cash_period_close |
| legacy_cut_manifest | operational_reader | cash_period_close |
| legacy_cut_settlement_evidence | operational_reader | cash_period_close |
| legacy_integrity_rows | operational_reader | cash_period_close |
| list_movements | historical_reader | cash_period_close, cost_inventory_cancellation, receivable_fiscal_projection |
| manage_legacy_receivable_association | writer | receivable_fiscal_projection |
| manual_expense_movements | operational_reader | cost_inventory_cancellation |
| movement_receipt_trace | historical_reader | receivable_fiscal_projection |
| paid_projection_chain | operational_reader | cash_period_close |
| pending_transfers | operational_reader | cash_period_close |
| preserve_receipt_object | guard | cash_period_close |
| process_automatic_reconciliation | writer | cash_period_close |
| project_receivable_command | writer | receivable_fiscal_projection |
| receipt_movement_options | operational_reader | receivable_fiscal_projection |
| reconciliation_context | operational_reader | cash_period_close |
| reconciliation_evidence_issue | guard | cash_period_close |
| reconciliation_snapshot_internal | operational_reader | cash_period_close |
| record_expense_batch | writer | cost_inventory_cancellation |
| record_internal_transfer | writer | cash_period_close |
| record_movement | writer | cash_period_close, cost_inventory_cancellation, receivable_fiscal_projection |
| record_transfer_stage | writer | cash_period_close |

`list_movements` é explicitamente misto: mantém linhas raw históricas e calcula totais operacionais apenas ativos na versão 182830. Não deve ser substituído integralmente por active_movements. `project_receivable_command` é writer disparado por trigger. Os helpers de prova/fechamento estão classificados como guard; preservadores de comprovantes também. Candidatos indiretos são mantidos como needs_review: relação textual com uma função instalada não prova que todas as execuções percorrem a chamada.

## Divergências e lacunas concretas

- `finance_private.assert_closed_source_mutable(_tenant uuid, _table text, _row jsonb, _depth integer)`: 2 definições efetivas diferentes.
- `finance_private.record_movement(_payload jsonb)`: 2 definições efetivas diferentes.

A factory de fechamento instala apply_payable_movement da migration 002244; isso não representa automaticamente a versão final com reversões/cutoff/adoção. A factory de custos referencia apply_payable_movement e movement_used_cents sem instalá-los: registra corretamente custos sem alocação, mas não prova o fluxo opcional de pagamento. A factory de recebíveis cobre o escritor real de projeção/refund/correção e fiscal, porém não possui todos os escritores de saída. A diferença de record_movement decorre de patches presentes no domínio de fechamento; a diferença do resolvedor de fonte fechada confirma que a factory de custos não equivale à cadeia completa de guards.

Também não se deve confundir tabelas presentes com guards completos: algumas factories usam DDL de vínculos com FKs externas omitidas e funções de fonte operacional limitadas ao cenário. Há funções reais instaladas com dependências ausentes ou caminhos nunca executados por esses testes. Os respectivos helpers continuam a autoridade sobre esses limites. O inventário documenta isso; não marca readiness de invalidação.

pg_depend não registra de forma completa dependências em corpos PL/pgSQL, SQL com corpo em string ou SQL dinâmico. A ausência de uma aresta não autoriza remover referência. O JSON distingue dependências catalogadas de textual_calls e unresolved_private_calls. Triggers sobre as tabelas relevantes são exportados mesmo quando sua função não contém o nome finance_movements diretamente.

## Próxima integração segura

1. Escolher uma cadeia final integrada para cada writer e instalar suas migrations posteriores, preservando diferenças observadas antes de uniformizar.
2. Migrar candidatos e provas operacionais para ativos, mas conservar raw nas trilhas e snapshots imutáveis; revisar funções mistas explicitamente.
3. Validar guard em INSERT/UPDATE residual e concorrência com invalidação, inclusive escritores legados que adquirem row lock antes do advisory.
4. Reexecutar este catálogo após cada grupo. Comparar hashes e triggers, e só então habilitar comando público de invalidação.

Teste de catálogo passou com as três instalações encerradas; nenhum PostgreSQL nativo foi iniciado. ESLint dos dois arquivos passou. Artefato reproduzível: `npx vitest run src/test/financeMovementEffectiveCatalog.test.ts`.

## Readiness ainda ausente na foundation 182541

A FK original_request_id não prova que o comando é record_movement nem que seu result aponta para o movimento. Referências duplicate/replacement ainda precisam provar alvo ativo e ausência de ciclo. INSERT de void ainda exige guarda de período e grafo completo de dependências. Esses controles serão responsabilidade da integração seguinte; a foundation está deliberadamente sem grant de escrita ou comando público. O catálogo não declara a invalidação pronta.
