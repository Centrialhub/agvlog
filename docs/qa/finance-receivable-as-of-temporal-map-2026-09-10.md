# Recebíveis históricos e descarga — mapa temporal e decisão

## Decisão

Não implementar um reader geral de posição passada a partir de `receivables` atual. Há prova de eventos de recebimento e de origens específicas, mas não há trilha completa e obrigatória de alterações do título. O caminho mínimo completo exige primeiro histórico temporal dos títulos, baseline explícita e captura de todas as alterações futuras. Fontes anteriores sem cobertura temporal permanecem diagnosticadas; não recebem valores atuais como se fossem históricos.

Esta revisão foi somente leitura do código candidato e não execução do catálogo efetivo integral. Não houve migration, aplicação remota, PostgreSQL nativo ou typecheck.

## Fontes e semântica

| Fonte | Tempo disponível | Reconstrução comprovável | Limite |
|---|---|---|---|
| `receivables` | created_at, updated_at; due_date; received_at agregado | Estado atual | updated_at não conserva versões. Valor/devedor antes do primeiro pagamento podem mudar; vencimento não está protegido pelo guard do razão. Cancelamento sem saldo pode mudar sem evento próprio. |
| `receivable_financial_commands` | created_at, before_snapshot/after_snapshot | Estado exato nos comandos receive/reverse/reconcile, incluindo evidence.receivable | Não prova ausência de edições entre comandos nem estado em todo dia intermediário. payload_hash não é payload completo. |
| `receivables_payments` | received_at econômico + created_at de registro | Recebimento individual imutável por payment_id e command_id | Um pagamento registrado depois pode ter dia econômico anterior. Não resolve sozinho valor, vencimento e devedor do título passado. |
| `receivable_payment_reversals` | effective_at + created_at | Devolução individual com data efetiva e referência exata ao pagamento | Não confundir devolução com correção de alocação. Não subtrair a mesma baixa duas vezes. |
| `finance_receipt_allocation_corrections` | created_at somente | Retirada da alocação, preservando dinheiro e IDs | Não há data efetiva comercial separada. Usar tempo de registro explicitamente ou exigir política/evento novo, nunca herdar silenciosamente received_at. |
| `finance_customer_credits` | created_at, observation_id, receipt_snapshot | Crédito por payment_id em cancelamento fiscal, sem novo dinheiro | A data de observação não é necessariamente a data jurídica do cancelamento. Crédito retira alocação do título; não equivale a devolução bancária. |
| `finance_fiscal_observations` | created_at + snapshot imutável | O que foi observado da emissão naquele registro | Não autentica retrospectivamente status que ainda não havia sido observado. |
| `finance_fiscal_projection_events` | created_at, before_data origem, after_data resultado/basis | Incorporação, suspensão/revisão/cancelamento por observação e origem | after_data não é snapshot completo do título; fila pode materializar depois. Distinguir conhecimento fiscal de materialização financeira. |
| `finance_fiscal_receivable_origins` | created_at/updated_at, basis | Identidade e base de origem, complementada pelos eventos | state/observation_id atuais não podem ser reutilizados no passado. |
| `finance_unloading_charges` | occurred_on + created_at, source_snapshot | Uma descarga por entrega raiz; supplier_id, amount e receivable_id imutáveis | O título relacionado ainda pode ter sofrido alterações sem histórico. O fornecedor da origem não deve ser redescoberto nas NFs atuais. |
| `finance_commands` de record_unloading | created_at + payload/result imutáveis | Vencimento originalmente informado, declaração e origem exata da descarga | Vencimento original não prova vencimento vigente numa data posterior; cancelamentos/renegociações do título precisam de versões. |
| Associações legadas a movimentos | created_at/reversão e snapshots | Evidência de associação por IDs | Não cria recebimento nem deve alterar sua data econômica; reversão de associação não desfaz baixa. |

Referências: `20260830183929_audit_receivable_payments_and_reversals.sql` linhas 10–38, 130–138, 180–203; `20260910025658_finance_receipt_allocation_corrections.sql` linhas 1–7; `20260910011121_finance_fiscal_cancellation_credits.sql` linhas 1–9, 66–72; `20260910010034_finance_fiscal_receivable_projection.sql` linhas 2–16 e process_fiscal_observation; `20260909212514_finance_delivery_unloading.sql` linhas 1–13, 111–130. `src/hooks/useReceivables.tsx` linhas 67–70 mantém writer direto de UPDATE. A busca de triggers na baseline e migrations não encontrou auditoria genérica completa de versões de receivables; isso ainda requer confirmação no catálogo integrado antes do cutover.

## Casos que podem e que não podem ser respondidos hoje

- Pode listar pagamentos, devoluções, créditos e correções ocorridos/conhecidos até um corte com IDs únicos, preservando separação entre dinheiro e alocação.
- Pode mostrar a obrigação original da descarga por fornecedor original e entrega, inclusive data do gasto e vencimento original do comando. Isso deve ser denominado origem registrada, não saldo histórico vigente.
- Pode mostrar snapshot de um comando financeiro ou incorporação fiscal em seu instante exato, sem interpolar períodos não cobertos.
- Não pode afirmar saldo aberto/vencido geral em um dia passado usando amount/client_id/due_date/status atuais. Nem igualdade entre original e atual prova ausência de mudança intermediária e retorno ao valor original.
- Não pode reconstruir títulos apagados antes de terem pagamentos/fatura apenas consultando títulos atuais. O guard183929 permite DELETE de título sem esse histórico; um inventário histórico geral precisa também tombstones.

## Contrato proposto para implementação posterior à captura temporal

`get_finance_receivable_position_as_of(tenant_id, as_of_date, knowledge_at, payer_id?, source_kind?, page=1, expected_revision?)`.

`as_of_date` é fim do dia em São Paulo; `knowledge_at` é o limite explícito dos registros conhecidos. Ambos participam da revisão. Distinguir posição conhecida naquele dia de reconstituição posterior por datas econômicas. Uma revisão fixa permite paginação consistente; se o conjunto mudar, exigir atualização ou servir manifesto persistido, nunca misturar páginas.

Envelope versão 1: tenant/currency/timezone/as_of/knowledge_at/basis/coverage/totals_valid/revision/source_count/unknown_count/totals/rows/next_page. Totais em centavos string ou null, com nominal, allocated_receipts, money_refunds, released_to_credit, allocation_corrections, open e overdue separados. Crédito/devolução/correção de um payment_id precisam classificação exclusiva, validada por cadeia; aliases não entram como outro pagamento. Débitos cancelados e créditos não somam novamente na obrigação ativa.

Cada linha conserva receivable_id, origem com tabela+ID, versão do título, payer_id e nome histórico quando comprovado, nominal/due_date/state, payment/event IDs e issues. Datas desconhecidas ficam null. Totais globais desconhecidos quando qualquer título potencialmente pertencente ao escopo não tem prova suficiente. O filtro por fornecedor não deve excluir uma origem cujo devedor histórico é desconhecido: ela fica em cobertura desconhecida, sem vazar dados de outro tenant.

Descarga usa o mesmo conjunto de títulos, agrupado por `finance_unloading_charges.supplier_id`, com charge/entrega/título e vínculos de NFs do snapshot original. Não adicionar novamente amount da charge aos totais de receivables. Divergência entre titularidade histórica do recebível e fornecedor de origem vira diagnóstico. Sem novas condições de cobrança presumidas.

## Próxima unidade implementável

1. Instalar tabela append-only de versões/eventos de receivables com before/after completos, autor, registro servidor, sequência determinística por título, proveniência do writer e marca de baseline. Capturar INSERT/UPDATE/DELETE efetivos, incluindo workers e recálculos, sem depender de payload/GUC de cliente como autorização.
2. Baseline conserva o estado atual e declara `coverage_starts_at`; não certifica o passado. Não criar recebimento/obrigação nessa captura. Provar concorrência baseline versus writers e distinguir alterações técnicas dos campos econômicos.
3. Implementar posição para cortes cobertos, eventos reais de recebimento/reversão/crédito/correção e estado fiscal observado. Legado anterior continua unknown; adicionar adoção histórica auditada somente com prova explícita e sem backdating fictício.
4. Testar criação, renegociação de valor/devedor/vencimento antes do primeiro pagamento, exclusão de título sem pagamento, pagamento retroativo conhecido depois, devolução com effective_at posterior, cancelamento fiscal antes/depois worker, crédito sem devolução, correção sem dinheiro novo, descarga com várias NFs/um fornecedor, >1000 títulos, paginação/revisão estável, tenant e motorista misto.

Esta dependência é necessária para entregar saldo histórico real, não um reader que retorne dados atuais ou apenas placeholders.
