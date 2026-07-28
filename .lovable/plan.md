# Lançamentos manuais no Financeiro

Objetivo: dar autonomia à operação para (1) lançar despesas/taxas avulsas, (2) dar baixa em boletos a pagar e (3) baixar recebíveis — permitindo baixa parcial e gerando automaticamente uma linha em `bank_transactions` já conciliada com o documento.

## 1. Despesas / taxas avulsas

Novo diálogo **"Nova despesa avulsa"** dentro de `Financial.tsx` → aba Contas a Pagar.

Campos:
- Descrição, categoria (tarifa bancária, imposto, taxa, despesa administrativa, outros)
- Fornecedor (opcional — busca em `clients` com `is_supplier=true`)
- Data de competência e data de vencimento
- Valor
- Conta bancária de origem (se já paga) — opcional
- Status inicial: **em aberto** ou **já paga** (se paga, gera baixa imediata)
- Anexo (comprovante) — bucket privado existente

Grava em `payables` com `source='manual'` e sem vínculo a load/settlement. Se marcada como "já paga", cria imediatamente o registro em `payables_payments` (ver §2) e a `bank_transaction` conciliada.

## 2. Baixa manual de Contas a Pagar (boletos)

Botão **"Dar baixa"** em cada linha aberta de `payables`. Abre diálogo com:
- Data do pagamento
- Valor pago (default = saldo restante; aceita menor → baixa parcial)
- Conta bancária (obrigatório)
- Forma (pix, boleto, ted, dinheiro, cartão)
- Observação / número do comprovante
- Anexo (opcional)

Regras:
- **Baixa parcial + total** suportadas. Enquanto `sum(payments) < amount` → status `partial`; ao quitar → `paid`.
- Cada baixa cria uma linha em `bank_transactions` (tipo `debit`) já `matched` contra o payable, aparecendo no extrato interno e sem exigir importação do banco.
- Estorno: possível excluir uma baixa (reverte status e apaga a `bank_transaction` correspondente).

## 3. Baixa manual de Contas a Receber

Mesmo fluxo do §2 aplicado a `receivables`:
- Botão **"Registrar recebimento"** com data, valor, conta, forma, observação, anexo.
- Baixa parcial + total; status `partial` → `received`.
- Gera `bank_transactions` (tipo `credit`) conciliada contra o receivable.

## 4. Banco de dados (migração)

Duas tabelas novas de pagamentos + colunas auxiliares:

```text
payables_payments (id, payable_id, amount, paid_at, bank_account_id,
                   method, notes, attachment_url, bank_transaction_id,
                   created_by, created_at)

receivables_payments (id, receivable_id, amount, received_at, bank_account_id,
                      method, notes, attachment_url, bank_transaction_id,
                      created_by, created_at)
```

- Ambas com `tenant_id`, RLS por tenant, GRANTs (`authenticated`, `service_role`), triggers `updated_at` (na tabela pai).
- Triggers `after insert/delete` recalculam `paid_amount` e `status` em `payables` / `receivables` (adiciona coluna `paid_amount NUMERIC DEFAULT 0` se faltar, e expande enum de status para incluir `partial`).
- Coluna `source` (`manual` / `system`) em `payables` para separar as despesas avulsas criadas pela operação.

RPCs (SECURITY DEFINER, restritas a `admin`/`owner`/`operator`):
- `register_payable_payment(payable_id, amount, paid_at, bank_account_id, method, notes, attachment_url)`
- `register_receivable_payment(receivable_id, ...)`
- `reverse_payable_payment(payment_id)` / `reverse_receivable_payment(payment_id)`
- `create_manual_expense(payload jsonb)` — cria payable avulso e, se marcado como pago, chama `register_payable_payment` na mesma transação.

Cada RPC insere/deleta a `bank_transaction` correspondente atomicamente, com `reconciliation_status='matched'` e `related_type='payable'|'receivable'`.

## 5. UI (`src/pages/Financial.tsx` + componentes)

Novos componentes em `src/components/financial/`:
- `ManualExpenseDialog.tsx`
- `PayablePaymentDialog.tsx`
- `ReceivablePaymentDialog.tsx`
- `PaymentHistoryList.tsx` (histórico de baixas por documento, com botão "Estornar")

Ajustes:
- Colunas "Pago" e "Saldo" nas tabelas de payables/receivables.
- Badge `Parcial` quando `paid_amount > 0 && < amount`.
- Ação "Ver baixas" abre `PaymentHistoryList`.
- Filtro por `source` (todos / operacionais / avulsos).

## 6. Testes

- Unit: `register_payable_payment` — baixa total, parcial, tentativa de valor > saldo, estorno.
- RLS: usuário de outro tenant não vê pagamentos.
- Integração UI: criar despesa avulsa "já paga" gera payable + payment + bank_transaction.

Sem impacto em outros módulos — mudanças isoladas ao financeiro.
