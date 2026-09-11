# Correção de movimento registrado — lacuna e contrato

2026-09-10. Investigação somente leitura; nenhum SQL de produto alterado, PostgreSQL parado após31310. Inventário textual completo desta revisão: `finance-movement-raw-reference-inventory-2026-09-10.json`, **122 referências em40 migrations** locais, com caminho/linha/texto e função mais próxima. Função mais próxima é pista lexical, não catálogo efetivo: patchesDO podem alterar outra função. Não afirmar que40arquivos são40leitores ativos ou que histórico local equivale ao remoto.

## Lacuna confirmada

`finance_ledger_foundation`212104 mantém finance_movements append-only via preserve_finance_movement, sem estadoativo/invalidação. `list_movements`213020:12–24 soma linhas brutas. Não foi encontrado comando público dedicado a invalidar/corrigir movimento canônico já registrado.

Os mecanismos existentes corrigem outras camadas: identityreview corrige duplicidade do extrato; reconciliationreversal desfaz correspondência; receiptallocationcorrection25658 muda atribuição do recebimento; reversões de payable/settlement/legacy liberam associação; cancel_finance_expense75641 cancela custo/obrigação ainda sem dinheiro. Nenhum remove do saldo uma saída manual duplicada. Registrar entrada compensatória inventaria um evento de dinheiro e distorceria inflow/outflow; editar/deletar raw perderia histórico e quebraria dependências.

## Primeira entrega segura e útil

Invalidação auditada de **movimento manual livre**, sem conciliação ativa, sem origem fiscal/recebível/transferência e sem qualquer vínculo financeiro histórico dependente. Isso resolve duplicidade/erro de digitação percebido antes de compor gasto/baixa. Fontes com dependências recebem bloqueio detalhado e caminho de resolução, nunca cascata silenciosa. A capacidade não pode ser liberada ignorando histórico de pagamento real.

`finance_movement_voids`: id,tenant_id,movement_id,actor_id,actor_name,reason,request_id,revision,source_snapshot,duplicate_of_movement_id nullable,replacement_movement_id nullable,created_at. Unique tenant/movement, append-only, FK composta. Sem coluna apagável no original. `finance_private.active_movements` (view protegida) exclui voids; raw continua história. Event/journal registra manual_intervention sempre, incluindo quem invalidou e antes/depois.

RPCs propostos:

- `preview_finance_movement_correction(tenant,movement)` → original,active,revision,origin_kind,capability,dependencysets/blockers,affected_accounts_periods,before/afterrecordedbalances,history. Preview operador; escrita com owner/admin+can_access como política mínima proposta, sem inferir dupla aprovação.
- `void_finance_movement({version,tenant_id,request_id,movement_id,revision,reason,recording_error_confirmed:true,duplicate_of_movement_id?})`.
- `correct_finance_movement({version,tenant_id,request_id,movement_id,revision,reason,recording_error_confirmed:true,replacement:{...campospermitidosrecord_movement}})` executa void+novo movimento num único commit. Não reutiliza id anterior. O novo registro é representação corrigida da mesma transação, não uma transação bancária enviada pelo sistema.

Resposta distingue `bank_money_transacted:false`, `recorded_balance_changed:true`, IDsoriginal/void/replacement e deltasregistradosporconta/dia. Não usar cash_changed:false sem explicar que o saldo representado mudou. Replays de record_movement original devem retornar mesmoID com informação de histórico quando consultado; nunca criar novo movimento por replay do comando antigo. Não reativar void na primeira versão: correção de decisão exige novo comando explícito/ligado, com guards de novo registro e revisão das dependências.

Reason/documento não prova automaticamente duplicidade. duplicate_of exige outro movimento ativo no tenant; evidência deve ser mostrada ao autor. Coincidência de valor/nome/data, mesmo forte, não autoriza invalidar. Extrato continua íntegro; arquivo/rawbankentry não muda para acomodar livro. Reconciliação automática recebe candidatos ativos após revisão, sem fechar por ausência de erro.

## Dependências obrigatórias no preview/guarda

1. Grupos ativos e históricos finance_reconciliation_groups/reversals: não desconciliar implicitamente. Primeira versão pode exigir nenhuma relaçãohistórica; extensãoposterior pode permitir grupos todos revertidos com prova explícita, sem apagarhistórico.
2. expense_allocations, payablelinks/reversals/payments, settlementlinks/reversals/payments, receivablelinks/corrections/refunds, legacyreceiptlinks/reversals. Distinguir reserva ativa de evento monetário ainda real após reversão. Um linkrevertido não prova que transação não ocorreu.
3. financial_command/project_receivable origin, bank_transactionbrowserboundary22628, banktransaction IDs de pagamentos/aliasesload/closing. Movimento derivado de comando fiscal/recebível não pode ser void genérico, mesmo sem reservaativa.
4. internaltransfers/departures/arrivals: exigir comando de correção do par/estágio próprio; bloquear void isolado. Trânsito atraves­sando corte não é duplicidade.
5. closure/dependency registry, opening/book positions, conta original e conta/datareplacement. Reabrir todosfechamentosafetados/dependentes antes de corrigir; predecessor ativo continua bloqueado. Snapshot congelado nunca é recalculado retroativamente.
6. paid_projection_chain/legacycut, approvedpaidclosedsettlements/payroll, recibosstorage e objetos de evidência. Projeções indiretas precisam indicar quais IDs dependem da perna original. Guard não deve confundir folha com novo dinheiro.
7. Finance_commands/events source_snapshot: provar que origemmanual é record_movement e não apenas supor porque não achou um dos links conhecidos. Origemdesconhecida bloqueia; mudanças no grafo depois do preview alteram revision.

Locks: auth → tenantfinance → contasordenadas → grafo/dep em ordem compatível com escritores atuais. Revalidar acesso após espera, replay, revercadeia/revision, guardsdeperíodo, inserçõesevent+void+replacement atomically. Trigger residual em void não pode esperaradvisory se já segurourowlock; trylock com erroconcurrency/retry. Escritores de alocação/pagamento/reconciliação precisam conferir active no banco, incluindo INSERT direto/triggers; mudar apenas optionsUI abre corrida.

## Mapa de leitores e escritores raw a migrar

| Grupo | Referências locais completas por versão | Tratamento necessário |
|---|---|---|
| Lista/saldo operacional |213020 list_movements | Ativos nos totais; modo histórico inclui void+autor, campos totalsactive/history explícitos |
| Abertura/período/fechamento |023911 account_period_review;140010 account_opening;162958 account_period_close_snapshot;173906 cash_period_close_snapshot | Ativos nos valores atuais, manifesto de voids/hash/dependências, histórico congelado inalterado |
| Conciliação manual/automática |013543 reconciliation_context;014238 reconciliation_options;022059 revisit/process/runautomatic | Excluir void de candidatos e impedir gruposnovos sobrevoid. Contextosguardados verificam statusatômico |
| Lotes/opções/despesas |213959 record_expense_batch;220020 expense_options;221405 list_expenses;124716 list_expenses;175733 list_expenses;120756 manual_expense_movements | Não alocar a void; não contar valorvoid como caixa; histórico mostra referência inativa sem reinterpretar custo |
| Pagáveis/capacidade |002244 check_movement_use/apply/options;143833 check/managelegacy;143920 legacyoptions;180040 payable_portfolio_evidence | Guardservidor ativo; pagamentos históricos não desaparecem; carteira invalida cadeia em vez de voltaraberto silenciosamente |
| Recebíveis/créditos/refund |024438 project_receivable_command/receiptoptions;025658 correction;032730 e150338 movement_receipt_trace;145616 capacity/managelegacy;145659 legacyoptions | Rastros raw preservados; entradasvoid nunca disponíveis; requer política específica para fonte derivada |
| Acertos/folha/adiantamentos |130540 check_settlement_movement_link;130921 get_settlement_payment_movements;133355 newcandidates;133421 record_settlement_payment;170213 settlementevidence;172624 paidprojection | Ativo na prova/opções/guards, não somar folha novamente, bloquear dependências protegidas |
| Transferências |033918 record_internal_transfer;034731 stages/pending;035550 transfer_period_position | Par/estágio íntegro e datas próprias; não apenas filtrar uma perna e ocultar trânsito |
| Integridade/B |151011 legacy_integrity_rows;163116 legacy_cut_manifest | Estado void como fonte explícita/issue quando associado; fingerprints e revisão mudam; não ressuscitar legado como saída |
| Guards/congelado |163109 assert_closed_source_mutable/guard/readiness;164942 frozen_movement/latecomposition | Dependencykind para void, requer trigger readiness; nunca permitir projeção tardia provada em movimento que deixou de valer |
| Comprovantes/DDL/origem |212104 foundation;220941 storage receipt;122628 bankbrowserboundary e FKsDDLs nas versões acima | Raw imutável com retenção; referências históricas continuam acessíveis; não apagar comprovante ou origem |

O JSONanexo lista cada linha inclusive DDL e stringsDO, permitindo revisão exaustiva sem omitir leitor porque não foi citado na tabela. Frontend atual acessa lista por ledgerClient.ts154/list_finance_movements; snapshots/index/evidence/export renderizam raw congelado. Esses leitores históricos devem **continuar raw** do snapshot com invalidações posteriores separadas, enquanto lista/capacidade/saldo atual usam visãoativa. Não substituir finance_movements globalmente por texto: mistura prova histórica com elegibilidade atual e pode quebrar FK/rowtype/guard.

## Sequência e validação antes de liberar

1. Catalogar definições efetivas na fixture integrada e fechar lista de origensmanual/derivada; inventáriotextual não substitui catálogo. Criar activeview+voidtable sem expondo comando antes de todosguards críticos migrados/readiness verificável.
2. Migrar leitores monetários e todosescritores de capacidade/conciliação; preservar consultas históricas. Testar voidnãoativo não aparece em options/não aceita directinsert.
3. Liberar voidmanual livre e correctionatômica, com registrodurável naUI e replays. Lançamentoconfirmadoerrado deve ser resolvido, não ocultado em filtro.
4. Testes: duplicado2×500extrato1×500→voiduma→saldo500 e uma conciliação; não cria entrada. Valor/data/contacorrigidos: umreplacement e deltasporconta; folha/custos permanecem correspondentes ou bloqueiam. Corridas void×expense/payable/receipt/settlement/match/close; revogação/replay; fechado bloqueia; históricoexportidêntico; transferência/derivado/legadodesconhecido bloqueados. Regressão detodosleitoresrawdoJSON e agregado>1000.

A primeiraentregalivre não resolve movimento já usado em tudo. Para esses casos o preview precisa apontar fluxo auditado de resolução, sem afirmar que reversão de associação sozinha prova ausência de dinheiro. Essa é lacuna central antes de declarar módulo apto a resolver todas as discrepâncias de lançamento.
