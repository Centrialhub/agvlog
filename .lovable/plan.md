# Vistoria completa do módulo Financeiro

Rodada de verificação (sem features novas). Objetivo: garantir que Financeiro, Contas a Pagar, Contas a Receber, Conciliação Bancária, Fechamentos, Acertos de Motorista e os fluxos novos de baixa manual estejam íntegros ponta a ponta.

## 1. Auditoria estática (código + tipos + testes)

- `tsgo` e `bunx vitest run` do zero — travar 250+ testes verdes antes de qualquer diagnóstico.
- Grep de contratos quebrados nos novos hooks/RPCs:
  - `register_payable_payment`, `register_receivable_payment`, `reverse_*`, `create_manual_expense`.
  - Assinaturas dos parâmetros (`_payable_id`, `_amount`, `_paid_at`, `_bank_account_id`, `_method`, `_notes`, `_attachment_url`) x uso em `useFinancialPayments.tsx`.
- Verificar imports órfãos e sentinelas Radix (`__none__`) em `ManualExpenseDialog`, `PayablePaymentDialog`, `ReceivablePaymentDialog`.

## 2. Auditoria de banco (RPC + RLS + Grants + Triggers)

Consultar via `supabase--read_query`:

- Existência e assinatura das RPCs novas (`pg_proc`) + `SECURITY DEFINER` + `search_path = public`.
- `payables_payments` / `receivables_payments`: colunas, `tenant_id`, FK, unique, GRANTs para `authenticated`/`service_role`, RLS habilitada, políticas por tenant.
- Trigger de recálculo de `paid_amount` / `received_amount` e transição de status (`pending → partial → paid`).
- Enum/constraint `status` em `payables` e `receivables` inclui `partial`.
- `bank_transactions` gerado pela baixa: `reconciliation_status='matched'`, `direction` correto (débito/crédito), vínculo pelo `bank_transaction_id` na tabela de pagamento.
- Coluna `source` em `payables` com default e index útil para filtro operacional/avulso.
- Isolamento cross-tenant: refazer os cenários de `rlsCrossTenant.test.ts` cobrindo as tabelas novas.

## 3. Smoke funcional (Playwright headless em `localhost:8080`)

Fluxos executados de ponta a ponta, com screenshot em cada passo:

1. **Contas a Pagar**
   - Criar despesa avulsa em aberto → aparece com badge "Avulsa" e saldo cheio.
   - Criar despesa avulsa "já paga" → gera `payables_payments` + `bank_transactions` conciliada.
   - Baixa parcial de boleto operacional → status `partial`, saldo restante correto.
   - Segunda baixa quita → status `paid`.
   - Estornar última baixa → volta para `partial` e transação bancária some do extrato.
   - Tentar baixa com valor > saldo → erro amigável.
   - Filtro por origem (Todos / Operacional / Avulsa) filtra corretamente.

2. **Contas a Receber**
   - Registrar recebimento parcial → status `partial`, saldo remanescente.
   - Concluir com segunda entrada → status `received` (ou `paid`, conforme enum atual).
   - Estornar → status reverte, transação bancária removida.
   - Anexo (PDF) sobe no bucket `receipts` privado e URL assinada abre.

3. **Conciliação bancária**
   - Importar XLSX SICOOB (arquivo de fixture no `/tmp/browser/`) → detecção de header e mapeamento automático.
   - Transações geradas pelas baixas manuais aparecem já `matched` e não bagunçam o saldo importado.

4. **Acertos de motorista / Fechamentos**
   - Novo acerto manual com múltiplos romaneios → travamento por motorista, driver_id inferido.
   - Fechamento por viagem com filtros por data/placa/motorista + km inicial/final + PDF em paisagem "Controle de Viagens" abre sem erro.

5. **Dashboard `/financial`**
   - KPIs de a pagar / a receber / conciliado batem com a soma direta das tabelas após os cenários acima (tolerância 0,01).

## 4. Cross-checks silenciosos

- `useReceivables` / `usePayables` continuam invalidando cache ao registrar baixa (React Query keys atualizadas via `useFinancialPayments`).
- Nenhum uso de `service_role` no cliente.
- Toasts em pt-BR e mensagens de erro específicas nos casos: sem conta bancária, sem valor, valor > saldo, tenant sem permissão.
- Logs do dev server sem `permission denied` ou 401/403.

## 5. Entregáveis

- Relatório curto (o que passou, o que falhou, evidência por screenshot).
- Correções pontuais só se algo quebrar durante a vistoria — cada correção como um ajuste isolado, sem refactor.
- Nenhuma migração nova a menos que uma inconsistência real apareça (ex.: trigger faltando, GRANT ausente, enum sem `partial`).

## Detalhes técnicos

- Playwright em `/tmp/browser/financial-smoke/`, viewport 1280×1800, sessão restaurada via `LOVABLE_BROWSER_SUPABASE_*`.
- Fixtures: XLSX mínimo SICOOB reutilizando o parser de `src/lib/bankStatementParser.ts`.
- Consultas SQL apenas via `supabase--read_query` (somente leitura durante a vistoria).
