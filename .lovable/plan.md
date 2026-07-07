# Conciliação Bancária — Plano de entrega faseado

O escopo é grande (7+ tabelas novas, ~10 RPCs, importador de extrato, tela de conciliação, refactor de despesas do motorista, contas a pagar, relatórios). Para preservar o AGVLog em produção, proponho entregar em **6 PRs incrementais**, cada um com migration própria, sem tocar migrations antigas e sem alterar RPCs/tabelas atuais além do estritamente necessário.

Antes de começar, preciso confirmar o escopo desta primeira rodada — o pedido inteiro num único turno vira um patch gigante e frágil.

## Fases propostas

### PR 1 — Fundação de dados (backend puro, sem UI)
Migration única criando as tabelas com RLS + GRANTs + índices:
- `bank_accounts`
- `bank_statement_imports` (uniq `tenant_id + bank_account_id + file_hash`)
- `bank_transactions` (índices em tenant/conta/data/valor/status/normalized_key)
- `financial_obligations` (uniq lógica `source_table + source_id + obligation_type`)
- `payables`
- `financial_matches`
- `bank_reconciliation_sessions`
- `bank_reconciliation_audit`

RLS reaproveita `is_tenant_member`, `is_tenant_operator_or_admin`, `is_tenant_admin`. Nada em `driver_*`, `receivables`, `loads` etc. é alterado ainda.

### PR 2 — RPCs de geração de obrigações + import
- `sync_financial_obligations(_tenant_id, _date_from, _date_to)` — projeta `receivables`, `driver_settlements` aprovadas, `driver_settlement_payments`, `driver_expenses` (pagas pela empresa) e `payables` em `financial_obligations`, idempotente pela chave lógica.
- `import_bank_statement(...)` — insere `bank_statement_imports` + `bank_transactions` com dedupe por `file_hash` e `normalized_key`.
- Trigger opcional em `driver_settlements`/`receivables`/`payables` chamando `sync_financial_obligations` de forma pontual (linha a linha, escopo restrito) para manter o livro vivo. **Sem alterar RPCs financeiras existentes**; apenas trigger AFTER.

### PR 3 — Motor de matching + sessões
- `run_bank_reconciliation(...)` com scoring (valor exato, data ±3d, contraparte, documento, direction). ≥90 + sem ambiguidade = auto-match; 70–89 = sugestão; <70 = unmatched. Múltiplos candidatos parecidos nunca auto-aceitam.
- `accept_financial_match`, `reject_financial_match`, `create_manual_financial_match` (1:1, 1:N, N:1, parcial), `reverse_financial_match`.
- `close_reconciliation_session` / `reopen_reconciliation_session` (admin/owner + motivo).
- Toda RPC grava em `bank_reconciliation_audit`.

### PR 4 — UI: importação + tela de conciliação
- `src/pages/BankReconciliation.tsx` no menu financeiro.
- Upload CSV/XLSX (usa `xlsx`) + parser BR (`1.234,56` / `-1234.56`), mapeamento de colunas, preview, hash do arquivo no cliente.
- Abas: Extrato, Títulos do sistema, Divergências, Motoristas. KPIs no topo.
- OFX fica marcado como TODO (aceite não exige na primeira iteração — “se viável”).

### PR 5 — Despesas do motorista + integração com acerto
- Migration aditiva em `driver_expenses`: `payment_source`, `supplier_name`, `document_number`, `city`, `state`, `odometer`, `no_receipt`, `no_receipt_reason`, `paid_with_advance`. Default preserva comportamento atual; `reimbursable` derivado quando não informado.
- `driver_create_expense` atualizado (novos parâmetros opcionais, back-compat).
- `DriverExpenses.tsx` e tela de aprovação (`ExpenseApproval.tsx`) recebem novos campos e alertas (sem comprovante, possível duplicidade, marcação indevida).
- Ajuste na geração/recalculo de `driver_settlements`: reembolsáveis → `driver_reimbursement_total`; company-paid → custo da rota sem afetar `driver_payable_amount`; adiantamento reduz payable. Ao aprovar acerto e ao registrar pagamento, sincroniza `financial_obligations`.

### PR 6 — Contas a pagar + relatórios
- `src/pages/Payables.tsx` (CRUD, aprovar, cancelar, filtros). Baixa só via conciliação ou baixa manual auditada.
- Exports CSV/XLSX dos relatórios pedidos.

## Como quero prosseguir

Se você aprovar, começo **agora pelo PR 1 (migration de fundação) + PR 2 (RPCs de sync + import)** num único turno, já que são backend puro e não mexem em nada em produção. UI e refactor de despesas/acerto vão em turnos seguintes para eu conseguir validar build/lint entre eles.

Confirma essa ordem (PR1+PR2 primeiro), ou prefere outra sequência — por exemplo despesas do motorista antes, ou tudo backend (PR1–3) de uma vez sem UI?
