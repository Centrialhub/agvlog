# Coletor servidor da previsão de caixa — proposta concreta, 2026-09-11

Somente investigação de código/desenho. Nenhuma leitura de dados pessoais, migration ou alteração de produção. Nomes indicados como propostos ainda não existem.

## Estado atual confirmado

`src/lib/financial/cashForecastProjection.ts` calcula saldo-base + movimentos pós-corte + saldo restante de títulos/fretes. `cashForecastComparison.ts` compara o original preservado com `periodMoneyPackageSchema`, nos mesmos tenant/contas e intervalo [cutoff+1,period_end], usando fluxos brutos. As referências atuais são exclusivamente os módulos e seus testes: não há RPC coletora, tela consumidora ou journal de previsões.

O cálculo já trata recebido60/título100 corretamente: dinheiro pós-corte +60 e expectativa restante40. Fulfilled deve considerar o histórico inteiro validado até a captura; limitar recebimentos ao período recriaria dívida já quitada antes do corte.

## Mapa de fontes reais

| Camada | Fonte/helper existente | Regra do coletor |
|---|---|---|
| Contas | bank_accounts; period_money_package193723 | Validar IDs no tenant autorizado, tipos e contas selecionadas/excluídas; não usar saldo cadastral como confirmação. |
| Base fechada | finance_account_period_closures/reopenings; account_period_closure_evidence64923; period_money_account193723 | Preferir fechamento ativo terminando exatamente no cutoff, snapshot/dependencies íntegros. Banco usa extrato; caixa usa contagem. Ler closing_cents congelado, rejeitar lacunas/sobreposições/corte dentro de fechamento. |
| Base por abertura | finance_account_openings140010 e cash141240; account_opening efetivo após active183438/185338 | effective_from=cutoff+1 comprova saldo no fim do cutoff. Abertura anterior + movimentos até o corte produz livro provisório, não nova confirmação bancária/contagem. Não reinstalar corpo antigo raw140010. |
| Caixa pós-corte | active_movements; account_period_review; statement_period_evidence; conciliação ativa83442 | movement.id único, conta exata, cutoff<occurred_on<=dia da captura São Paulo. Void excluído. Bank transactions, pagamentos e extrato não são somados novamente. bank_confirmed só com conciliação/prova; demais recorded. |
| Receber atual | receivables + _receivable_financial_snapshot; receivable_portfolio_summary151617 | Reutilizar numeric_valid, requires_reconciliation e fiscal_block_reason. Fulfilled é alocação líquida validada, respeitando reversão, correção e crédito. Cancelados não geram previsão. due_date agenda; created_at não agenda recebimento. |
| Pagar atual | payable_portfolio_evidence180040; payable_effective_cost_evidence60700/72723; active_payable_payments | Uma linha por payable.id e mesmos nominal/paid/open da carteira. Pago150/custo120 continua nominal150/paid150/open0. Folha/acerto/custo que geraram o título são proveniência, não novas saídas. |
| Frete sem título | unbilled_freight_rows153731; get_finance_unbilled_freight_summary/origins | Somente state=available no expandido; valor freight_value, nunca mercadoria. Reservado/incerto/autorizado/review/cancelado não vira segunda previsão. Reentrega sem preço permanece review. issue_date/attempt.recorded_at não é data de recebimento. |
| Crédito cliente | finance_customer_credits011121 + payment/origin/observation/bank_transaction IDs e receipt_snapshot | Dinheiro já recebido, não entrada futura. unique(tenant,payment); não há destination_receivable_id nem reserva para novo título. reserved_credit_cents=0 por título sem vínculo específico; expor unassigned com IDs e diagnóstico. Valor original não prova disponibilidade atual sem conferir histórico/estornos. |
| Custódia/recuperação | get_finance_cost_dispositions; coverage72723 + returned/open74603 | Resíduo histórico não é novo dinheiro. Retorno registrado entra uma vez pelo incoming movement. Custódia pode financiar outro custo: não implica devolução agendada. Manter sidecar; recuperação futura só com obrigação/data explícitas. |

O resumo de receber151617 filtra created_at e não entrega linhas/revisões. Coletor deve montar linhas servidor com o snapshot existente. Não concatenar páginas de várias RPCs em capturas diferentes e chamar o resultado snapshot único.

## Deduplicação por título, serviço e NF

1. Confirmados: economic_key `receivable:<id>` ou `payable:<id>`, source_table/id do título real. Nunca somar fatura e seu receivable, ou custo e seu payable.
2. Cobrança de descarga possui ponte finance_unloading_charges.receivable_id. Descarga e frete da mesma NF são serviços distintos: vínculo com descarga NÃO elimina automaticamente frete disponível.
3. Frete disponível: `freight:<document_id>:original`. Tentativa teria chave com attempt_id, mas atualmente fica sem preço em revisão. Não reutilizar valor original automaticamente.
4. finance_fiscal_receivable_origins tem receivable_id único, chaves tenant/doc_type/source_id e fiscal_identity; CTe/NFSe possuem fiscal_document_ids. client_invoices.receivable_id, client_invoice_charges e closing_report_charge_claims fornecem linhagem comercial. Um título multi-NF permanece uma expectativa, sem ratear nominal arbitrariamente.
5. Suprimir NF disponível somente por linhagem comprovada de cobrança DE FRETE. r.fiscal_document_id legado sem tipo/prova gera freight_title_lineage_ambiguous, não deduplicação por descrição/valor/pagador. Dois títulos conflitantes ou autorização duplicada conservam IDs e diagnóstico.
6. movement.id único: baixa/associação/correção/retorno altera cumprimento/reserva e não cria segunda linha de dinheiro. Transferências internas mantêm ambas as pernas brutas, uma vez cada, pois Comparison usa gross_cash. Entre contas dentro/fora do escopo, preservar só a perna selecionada.

## Escopo por conta e caminho positivo inicial

Receivables não possui conta futura. Payables possui bank_account_id, mas apply_payable_movement02244 escolhe conta do movimento e registra em payables_payments: não é prova de uma reserva/promessa futura. Não atribuir restante à conta do último pagamento parcial nem distribuir proporcionalmente.

Primeira entrega segura: consolidado da empresa com TODAS as contas elegíveis explicitamente selecionadas e suas bases provadas. Os títulos podem compor expectativa da empresa sem inventar conta individual. Em subconjunto, saldo/movimentos reais continuam calculáveis, porém origens sem conta futura ficam não atribuídas e impedem conclusão completa desse subconjunto. Destinação futura por conta exige decisão revisada específica, ainda não disponível.

## Contrato proposto

RPC readonly proposta: `preview_finance_cash_forecast(_tenant_id uuid,_account_ids uuid[],_cutoff date,_period_end date,_expected_revision text default null)`.

- require_access, tenant/actor atuais, uma consulta STABLE com fontes CTE MATERIALIZED/snapshot MVCC único. captured_at é captura, não commit-clock. Não chamar workers nem emitir fiscal/mover dinheiro/reservar crédito.
- Não excluir dívida antiga pelo created_at. Vencido permanece needs_new_date; não reagendar para hoje. Fretes sem agenda ficam unscheduled apenas no expandido.
- Revision determinística de TODOS os componentes/IDs/estados: pagamentos, correções, reversões, void, claims, créditos e bases. Sem captured_at no hash e sem max(id). Divergência40001; totais e contagens antes da paginação.
- Envelope v2: tenant_id/actor_id/captured_at/cutoff/period_end/revision/account_scope; base {amount_cents,as_of,confirmation,components:[{account_id,kind,source_table,source_id,source_revision,balance_cents,confirmation,issues}]}; source_counts, projection, issues, unassigned_credits[{credit_id,payer_id,source_payment_id,amount_cents,valid,issues}], details{page_size:30,total_origins,total_movements}.
- Base v1 tem um source_id e confirmação única bank_confirmed|cash_count: não representa múltiplas provas de contas mistas. V2 deve ter componentes e mixed_confirmed quando todos válidos, provisional se algum provisório e unverified/null quando algum indeterminado. Não usar primeiro UUID como prova de toda soma.
- Linhas internas preservam nominal/fulfilled/reserved_credit; provenance e account_assignment explicit|company_unassigned separados. Fontes inválidas conservam IDs e diagnóstico, sem inventar valor0.
- Detalhe proposto `get_finance_cash_forecast_sources(...,kind,page,expected_revision)` usa mesmo conjunto/revisão. Não passar apenas uma página à calculadora pura. Servidor calcula sobre todas as linhas com teste de equivalência ao projectCashForecast, ou entrega base integral a consumidor servidor; navegador recebe resumo e detalhes paginados.

Captura durável proposta e separada: comando idempotente record_finance_cash_forecast guarda base/projeção/revisões/escopo/ator/request em journal append-only. Reader devolve original exato para Comparison. Nenhum journal de forecast foi encontrado. Sem captura durável, nova consulta é outra previsão, não a original de ontem.

Não preencher reviewed_date sem decisão de agenda rastreável. Due_date real serve; ausência/atraso vira diagnóstico. Não adicionar aplicação de crédito nem agenda de cobrança à primeira implementação do coletor.

## Três lacunas confirmadas

1. Coletor autorizado/captura/paginação comum faltam; cálculo e comparação atuais recebem objetos sem obter ou guardar prova no servidor.
2. Base precisa componentes por conta; previsão de subconjunto não pode concluir sem atribuição futura de títulos. Há caminho positivo no consolidado com contas/bases integralmente provadas.
3. Datas de fretes a faturar e reserva de crédito por título não existem nas fontes. Manter unscheduled/unassigned. O cálculo atual trata QUALQUER source_issue como bloqueio de ambos cenários; contrato deve distinguir confirmed|expanded|scope para NF sem preço/data não bloquear também o confirmado. Datas sem revisão e créditos sem vínculo não podem ser inferidos.

## Ordem concreta de implementação e testes

A. Linhas de receber/pagar com helpers efetivos e unbilled_freight_rows; equivalência às carteiras, inclusive150 pago/custo120 e recebido60/título100.
B. Base por conta e active movements pós-corte, fronteiras de transferência, conta nova vazia com prova de abertura/contagem; zero cadastral não basta.
C. Revision/diagnósticos: >1000origens, título multi-NF, descarga+frete mesmaNF, nova baixa/claim entre leituras e página revision40001.
D. Journal de previsão e comparação com pacote193723 fechado/reaberto, original preservado após editar título/crédito/data.

Provas de não duplicação: base1000+recebido60+restante40; crédito cancelado já no caixa sem nova entrada; retorno de custódia contabilizado apenas pelo movimento; transferência interna mantém bruto; parcial contaA não atribui restante àA; dívida antiga não desaparece por filtro de criação. Nenhum documento fiscal novo é necessário.
