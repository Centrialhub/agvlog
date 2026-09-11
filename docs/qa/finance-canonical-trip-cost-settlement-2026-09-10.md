# Custos canônicos no acerto de viagem

Migration candidata: `20260910134948_finance_canonical_trip_cost_settlement.sql`. Nada aplicado remotamente.

## Comportamento

- `_build_driver_settlement` soma o valor integral dos itens de lotes canônicos da viagem aos custos aprovados/totais e ao resultado operacional. Não copia dados para `driver_expenses`.
- Custos derivados usam `driver_settlement_items.item_type='expense'`, `source_table='finance_expense_items'`, `source_id` original. Metadata contém `payable_id`, `allocation_total_cents`, `reimbursable:false`, `settlement_credit_created:false`, categoria, data, fornecedor e comprovante/origem.
- Snapshot distingue `canonical_expenses` e `canonical_expenses_total`; mantém despesas legadas e a estrutura operacional existente. Versão `driver_settlement_v3_attempts_finance_costs`.
- `driver_reimbursement_total` e `driver_payable_amount` não recebem custos canônicos. Complemento não pago mantém seu payable original; o acerto não cria uma segunda obrigação.
- Cada rebuild remove/recria derivados, preservando ajustes. Replay do lote e rebuild repetido não acumulam itens/custos.
- Um novo item de lote de viagem marca acerto relacionado `needs_recalculation`, preservando snapshots aprovados/pagos/fechados. Acrescenta motivo sem apagar pendência anterior. Não recalcula automaticamente acerto protegido.
- Contexto office não alimenta acerto de viagem; acerto manual sem trip não recebe custo por coincidência de motorista.

## Compatibilidade com folha

O guard132406 anteriormente rejeitava qualquer item expense com origem diferente de `driver_expenses`. Esta migration aplica patch exato posterior, sem editar o arquivo132406: aceita origem canônica apenas quando item/batch/viagem do acerto, valor, payable e alocação correspondem à origem real e os marcadores booleanos negam reembolso/crédito de acerto. Origem arbitrária ou metadata adulterada continua bloqueada. A soma de reembolso da folha continua restrita às despesas legadas efetivamente reembolsáveis.

## Verificação

`npx vitest run src/test/financeCanonicalTripSettlement.test.ts`: **12 testes passaram**. Lint do teste passou.

Fixture: tabelas/defaults/enums reais da baseline; builder real mais recente de `20260831114316`, comandos reais de lote, descarga, geração/recompute de folha, projeção000731, dedup132406 e lifecycle133352. Funções de documentos da viagem e KM são dependências explícitas de teste (retornam vazio/null), portanto os testes não homologam integração de reentrega, documentos ou rotas.

Cobertura:

- Custo canônico integral R$150, valor enviado R$90, complemento único R$60; remuneração de ajuste R$200 permanece R$200.
- Despesa legada reembolsável R$25 permanece reembolso R$25 mesmo com custo canônico adicional.
- Snapshot/itens/metadados e referência ao payable original.
- Replay/rebuild sem acumulação.
- Preservação de cada estado approved/paid/closed, com marcação de pendência e rejeição de rebuild protegido.
- Exclusão de contexto office e ausência de vínculo heurístico com acerto manual.
- Geração de folha com lifecycle/dedup reais: crédito apenas da remuneração de R$200 e payable complementar original inalterado/único.
- Rejeição de crédito canônico forjado, payable ausente, alocação divergente e origem arbitrária.

O cutoff33700 não é carregado nesta fixture: não há registro nem alteração de pagamento de acerto nesta entrega. A integração de pagamento/folha/cutoff tem suite nativa separada documentada em `finance-settlement-payment-native-2026-09-10.md`.

## Concorrência e limites

Builder obtém lock da trip e do acerto antes de ler fontes (NOWAIT). Lote canônico já segura SHARE na trip; o trigger de item marca o acerto sob lock NOWAIT. Essa ordem pretende impedir que um rebuild com fonte antiga apague a pendência de um lote concorrente; **não foi feita ainda a reprodução nativa dessa disputa específica**. Rejeição por busy/lock exige retry, sem gravação parcial do lote.

Não houve browser, native desta parte, ensaio integral de migração ou mudança remota. Não transfere obrigação do payable canônico para acerto/folha; não implementa reabertura de acerto protegido ou migração retroativa do histórico. Custo operacional aparece no acerto somente após rebuild permitido; o snapshot protegido fica preservado e sinalizado até resolução auditada.

Arquivos próprios: migration134948, `src/test/financeCanonicalTripSettlement.test.ts` e este relatório. Nenhum frontend ou arquivo132406 foi editado.
