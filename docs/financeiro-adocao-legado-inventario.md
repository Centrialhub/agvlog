# Inventário para adoção do histórico financeiro

Inspeção inicial do repositório em 10/09/2026, atualizada após implementação local. O inventário temporal foi implementado em 20260910142740; associações de pagamentos antigos em 20260910143833 e de recebimentos antigos em 20260910145616. Consultas e comandos foram exercitados em testes locais; não houve implantação remota nesta etapa. O inventário identifica registros candidatos; não declara que o legado esteja integrado ou que seus saldos sejam verdadeiros.

O saldo de abertura validado delimita o início do livro por conta. Dinheiro anterior ao corte não deve ser importado novamente como entrada/saída posterior. Títulos e adiantamentos ainda abertos atravessam o corte com seu saldo residual e origem, sem novo faturamento. Essa separação está no planejamento, linhas 488–492, e nas funções de abertura `140010` e evidência `130956`, que ainda retornam `can_close=false`.

## Origens e vínculos exatos

Todos os joins abaixo exigem igualdade de `tenant_id`; nomes, datas, valores semelhantes e referência textual não substituem IDs.

| Origem | Dinheiro ou projeção | Identificação canônica / limitação |
|---|---|---|
| `bank_transactions` | Mistura extratos antigos e linhas fabricadas por baixa do próprio sistema | `finance_receivable_movement_links.bank_transaction_id → bank_transactions.id`, e `.movement_id → finance_movements.id`. Sem esse vínculo, `reconciliation_status='matched'` não prova conciliação nova. `import_id` aponta importação antiga; o arquivo precisa voltar pela ingestão canônica, sem transformar automaticamente a linha importada em movimento declarado. |
| `receivables_payments` | Recebimento declarado | `finance_receivable_movement_links.payment_id = id AND action='receive'`. A mesma linha pode aparecer em carga e fechamento; contar uma vez. Recebimento posteriormente devolvido continua sendo uma entrada histórica. |
| `receivable_payment_reversals` | Saída/devolução declarada separada | `.financial_command_id = finance_receivable_movement_links.command_id AND action='reverse'`; conferir também `payment_id`, `bank_transaction_id`, conta, valor e data. Não apagar entrada original nem excluir ambos por saldo líquido zero. |
| `payables_payments` | Saída declarada | `finance_payable_movement_links.payment_id=id`. Link não revertido identifica saída canônica. A view `finance_private.active_payable_payments` exclui pagamentos cuja alocação canônica foi revertida; eles não devem renascer como nova saída. Para `origin=legacy_adoption`, desfazer a associação preserva o pagamento e a baixa: ele volta a ser pendência de vínculo, nunca uma nova saída. Movimento original permanece no ledger. |
| `driver_settlement_payments` | Pagamento de acerto declarado | `finance_settlement_movement_links.payment_id=id`, descontando `finance_settlement_link_reversals.link_id`. A reversão aqui desfaz somente o vínculo: pagamento sem link ativo continua pendente de associação, não gera outro pagamento. Campo legado `payment_account` é texto, não FK bancária; conta não pode ser inferida. |
| `closing_report_payments` | Projeção quando possui ID canônico; declaração histórica quando não possui | `.canonical_receivable_payment_id → receivables_payments.id` (migration `20260830183929`). Sem esse ID, `receivable_id` sozinho não identifica pagamento e não autoriza deduplicação. |
| `load_payments` | Projeção moderna ou declaração histórica | `.receivable_payment_id → receivables_payments.id` e `.bank_transaction_id → bank_transactions.id` (migration `20260901141149`). Registros antigos sem os IDs ficam pendentes, mesmo havendo recebível igual. |
| `employee_advances` | Adiantamento declarado como pago ou obrigação ainda aberta | `.payable_id → payables.id`; alternativa exata `.id = payables.source_id AND source_table='employee_advances'`. Pagamentos do título são o dinheiro; o adiantamento e desconto posterior em folha não são saídas adicionais. `status='paid'` pode ter sido gravado sem uma linha de pagamento: pendência visível. |
| `payroll_entries`, `payroll_entry_items` | Cálculo/obrigação e projeções de valores já pagos | Título por `payables.source_table='payroll_entries' AND source_id=payroll_entries.id`; dinheiro em `payables_payments`. Itens `source_table='driver_settlement_payments'`/`'employee_advances'` referenciam essas origens; `already_paid` não cria dinheiro. |
| `driver_expenses`, `driver_settlement_items`, `finance_expense_items` | Custo/composição, não comprovante independente de saída | Acerto por `source_table/source_id`; custo canônico por `finance_expense_items.id`, com `payable_id` e `settlement_credit_created=false`. `finance_expense_allocations.movement_id` descreve cobertura já existente. Não adotar custo integral como pagamento além da alocação/complemento. |
| `financial_obligations`, `financial_matches` | Expectativa/projeção e conciliação antiga | `financial_matches.bank_transaction_id → bank_transactions.id`, `.financial_obligation_id → financial_obligations.id`; obrigação tem `source_table/source_id`. Usar como contexto auditável, nunca como segunda saída/entrada ou confirmação bancária atual. |
| `finance_internal_transfers`, `finance_transfer_departures` | Vínculos entre movimentos canônicos | Pares por `outgoing_id/incoming_id → finance_movements.id`; partida por `outgoing_id`. Não criar movimentos extras na adoção. Não foi localizada tabela bancária antiga própria de transferências no baseline: linhas antigas permanecem em `bank_transactions`, sem pareamento automático por valor/data. |

## Consulta proposta de pendências

SQL somente leitura para o schema com as migrations acima. Parâmetros `$1=tenant uuid`, `$2=conta uuid`, `$3=data inicial inclusiva`, `$4=corte final inclusivo`. Conta desconhecida aparece como pendência global do tenant na consulta de qualquer conta; não somar essa pendência entre contas. Datas timestamptz são convertidas para São Paulo. Uma lista vazia não comprova cobertura ou completude do legado.

A consulta remove projeções com IDs existentes; IDs órfãos permanecem visíveis. Não soma valores: duas declarações sem ligação exata podem descrever o mesmo dinheiro. Agrupar/revisar por `bank_transaction_id` antes de qualquer adoção, sobretudo se duas fontes apontam para a mesma linha. As linhas bancárias referenciadas são contexto dos pagamentos e não uma segunda linha monetária na saída do inventário.

```sql
with params as (
 select $1::uuid tenant_id, $2::uuid account_id, $3::date starts, $4::date ends
), references_to_bank as (
 select tenant_id, bank_transaction_id id from receivables_payments
 union select tenant_id, bank_transaction_id from receivable_payment_reversals
 union select tenant_id, bank_transaction_id from payables_payments
 union select tenant_id, bank_transaction_id from load_payments
), candidates as (
 select p.tenant_id, 'receivables_payments'::text source_table, p.id source_id,
  p.bank_account_id, (p.received_at at time zone 'America/Sao_Paulo')::date day,
  'in'::text direction, p.amount * 100 cents, p.bank_transaction_id,
  'receipt_without_canonical_link'::text issue
 from receivables_payments p
 where not exists(select 1 from finance_receivable_movement_links l
  where l.tenant_id=p.tenant_id and l.payment_id=p.id and l.action='receive')
 union all
 select r.tenant_id,'receivable_payment_reversals',r.id,p.bank_account_id,
  (r.effective_at at time zone 'America/Sao_Paulo')::date,'out',r.amount*100,
  r.bank_transaction_id,'refund_without_canonical_link'
 from receivable_payment_reversals r
 left join receivables_payments p on p.tenant_id=r.tenant_id and p.id=r.payment_id
 where not exists(select 1 from finance_receivable_movement_links l
  where l.tenant_id=r.tenant_id and l.command_id=r.financial_command_id
   and l.action='reverse' and l.payment_id=r.payment_id
   and l.bank_transaction_id=r.bank_transaction_id)
 union all
 select p.tenant_id,'payables_payments',p.id,p.bank_account_id,
  (p.paid_at at time zone 'America/Sao_Paulo')::date,'out',p.amount*100,
  p.bank_transaction_id,'payable_payment_without_mapping'
 from payables_payments p
 -- Any historical canonical link excludes this payment: a reversed payable
 -- allocation is inactive, not an old unadopted cash payment.
 where not exists(select 1 from finance_payable_movement_links l
  where l.tenant_id=p.tenant_id and l.payment_id=p.id)
 union all
 select p.tenant_id,'driver_settlement_payments',p.id,null::uuid,
  (p.paid_at at time zone 'America/Sao_Paulo')::date,'out',p.amount*100,
  null::uuid,'settlement_without_active_link_account_unresolved'
 from driver_settlement_payments p
 where not exists(select 1 from finance_settlement_movement_links l
  where l.tenant_id=p.tenant_id and l.payment_id=p.id
   and not exists(select 1 from finance_settlement_link_reversals r
    where r.tenant_id=l.tenant_id and r.link_id=l.id))
 union all
 select p.tenant_id,'closing_report_payments',p.id,p.bank_account_id,
  p.payment_date,'in',p.amount*100,null::uuid,'closing_payment_without_payment_id'
 from closing_report_payments p
 where not exists(select 1 from receivables_payments r
  where r.tenant_id=p.tenant_id and r.id=p.canonical_receivable_payment_id)
 union all
 select p.tenant_id,'load_payments',p.id,p.bank_account_id,p.payment_date,
  'in',p.amount*100,p.bank_transaction_id,'load_payment_without_payment_id'
 from load_payments p
 where not exists(select 1 from receivables_payments r
  where r.tenant_id=p.tenant_id and r.id=p.receivable_payment_id)
 union all
 select a.tenant_id,'employee_advances',a.id,null::uuid,
  coalesce((a.paid_at at time zone 'America/Sao_Paulo')::date,a.advance_date),
  'out',a.amount*100,null::uuid,'paid_advance_without_payment_account_unresolved'
 from employee_advances a
 where a.status='paid' and not exists(
  select 1 from payables p join payables_payments pp
   on pp.tenant_id=p.tenant_id and pp.payable_id=p.id
  where p.tenant_id=a.tenant_id and (p.id=a.payable_id
   or (p.source_table='employee_advances' and p.source_id=a.id)))
 union all
 select b.tenant_id,'bank_transactions',b.id,b.bank_account_id,
  (b.posted_at at time zone 'America/Sao_Paulo')::date,
  case b.transaction_type when 'credit' then 'in' when 'debit' then 'out' else 'unknown' end,
  b.amount*100,b.id,'legacy_bank_row_requires_source_classification'
 from bank_transactions b
 where not exists(select 1 from references_to_bank r where r.tenant_id=b.tenant_id and r.id=b.id)
  and not exists(select 1 from finance_receivable_movement_links l
   where l.tenant_id=b.tenant_id and l.bank_transaction_id=b.id)
)
select c.*, case when c.bank_account_id is null then 'account_unresolved'
 else 'account_identified' end account_status,
 case when c.cents>0 and c.cents=trunc(c.cents) and c.cents<=99999999999999
 then 'exact_cents' else 'invalid_amount_requires_review' end amount_status
from candidates c join params p on p.tenant_id=c.tenant_id
where (c.bank_account_id=p.account_id or c.bank_account_id is null)
 and c.day between p.starts and p.ends
order by c.day,c.source_table,c.source_id;
```

O SQL acima conserva a proposta inicial para contexto. A implementação executável está na migration 20260910142740, com alterações posteriores de 20260910143833 e 20260910145616; foi testada localmente e usa função privada com `can_access`, rejeição de motoristas inclusive perfil misto, validação de conta/corte e paginação. Para comportamento vigente, consultar essas migrations e seus relatórios de QA. Não executar diretamente com dados privados como substituto de um comando autorizado.

## Pendências complementares que a lista não resolve

- Pagamento apontando para `bank_transaction_id` inexistente ou com conta/sinal/valor/data divergentes precisa bloquear adoção. FK antiga `NOT VALID` não comprova integridade de todas as linhas anteriores.
- Links canônicos devem ser conferidos com o movimento de destino e capacidade, além do simples `NOT EXISTS` do inventário. Linhas com link inválido pertencem a diagnóstico de integridade, não a uma nova importação de dinheiro.
- Adiantamento marcado pago com pagamentos parciais não é integralmente explicado: comparar `employee_advances.amount` com soma dos pagamentos ativos dos títulos ligados, sem produzir uma saída residual presumida. Múltiplos títulos ligados e divergência entre `payable_id` e `source_table/source_id` bloqueiam resolução automática.
- Acerto sem conta não pode ser atribuído a uma conta por `payment_account`, método PIX, motorista ou dia. A resolução exige escolha explícita do movimento/evidência e autoria.
- `closing_report_payments` e `load_payments` sem IDs modernos podem duplicar recebimento antigo. `receivable_id` é vínculo de obrigação, não identidade de pagamento; manter os dois candidatos até revisão.
- Writers antigos de estorno de pagável apagavam pagamento e linha bancária (`baseline:12900`); ausência atual de linhas não prova ausência de dinheiro. A cobertura do extrato e auditoria disponível são necessárias, sem reconstrução inventada.
- `bank_transactions.import_id`, `raw_payload` e `financial_matches` ajudam a explicar a origem, mas não identificam por si só uma linha canônica `finance_bank_entries`. Não foi localizado mapa histórico exato de importação antiga para nova; reimportação deve preservar identidade bancária e deduplicação nativas.
- Datas desconhecidas, fontes órfãs e carteiras abertas exigem relatório adicional fora do filtro temporal. Saldos residuais de títulos são obrigações, não movimentos; cancelamento após recebimento não apaga entrada histórica.

## Comandos de associação implementados e adoção genérica proposta

Já existem comandos específicos `associate_finance_legacy_payable_payment` e `associate_finance_legacy_receivable_payment`, com respectivas reversões auditadas. Eles vinculam dinheiro existente, preservam as baixas e não resolvem as demais fontes, nem aprovam o corte histórico.

Contrato genérico ainda proposto, não disponível: `adopt_finance_legacy_source(payload)` com versão, tenant, request_id, source_table permitido, source_id, hash/revision do snapshot revisado, account_id, cutoff, resolução, movement_id opcional, bank_entry_id/evidência opcional e motivo. A autoria vem de `auth.uid()`, nunca do payload. Preservar snapshot e hash da fonte, IDs de todas as projeções consideradas equivalentes, ator/nome/data e intervenção manual permanente.

Resoluções explícitas: **vincular movimento existente**, **registrar declaração histórica ainda ausente** ou **coberto pela abertura anterior ao corte**. Classificar uma linha como projeção exige o ID da origem principal; classificar inconsistência mantém bloqueio. Nenhuma resolução executa transação bancária ou concilia automaticamente. Registrar declaração histórica cria movimento apenas se o dinheiro não estiver já no ledger, e nunca chama novamente o comando de pagamento do título.

Idempotência por tenant/request/ator/payload, unicidade ativa por fonte e proteção contra duas fontes adotando integralmente o mesmo movimento. Reversão append-only com justificativa, sem apagar pagamento antigo, movimento ou fechamento. Revalidar acesso e revisão depois de esperar locks; manter ordem compatível com fluxos fiscais (`fiscal` antes de `finance` quando necessário), períodos/contas e linhas fonte. Reusar validação de capacidade do movimento: vários pagamentos podem compor uma saída, mas a soma não pode exceder seus centavos.

Não usar o linker de pagável atual diretamente para todas as linhas antigas: `check_movement_use` em `002244` exige `payables_payments.bank_transaction_id IS NULL`, enquanto a baixa antiga frequentemente possui esse ID. A adoção precisa de contrato específico que preserve esse ID e o trate como projeção, sem limpar a evidência antiga para satisfazer o gatilho. O linker de acerto já admite associação histórica, mas requer conta/movimento explicitamente determinados.

Antes de liberar fechamento: testes de reversão, replay, capacidade conjunta, conta/tenant, motorista/misto, mudança da fonte durante espera, duas adoções concorrentes e corte já fechado; inventário integrado com diagnósticos de integridade; saldo de abertura e cobertura revisados; pendências do legado resolvidas de forma auditável. Nenhum desses requisitos é substituído por a consulta retornar zero linhas.
