# Correção positiva do custo e obrigação da mesma descarga — proposta para revisão

## Decisão e reaproveitamento

Não encontrei comando existente que altere auditadamente o valor positivo de finance_expense_items.213959 torna custo/charge IDs exclusivos e preserva o lançamento original;175641/53349/54915 resolvem cancelamento, sem substituição positiva.233637_audit_driver_settlement_adjustments registra crédito/débito do acerto, insere item_typeadjustment e reconstrói acerto: esse crédito/débito não corrige o custo canônico nem o payable original e criaria outro efeito.025658 corrige alocação de recebimento, não custo. Não reutilizar esses writers com semântica diferente.

Reaproveitar padrões reais de45402 (cadeia append-only, resolver, ticket, revisão, reauth/replay), grafo de dependências53349 (incluindo origem/payee do batch), cancelamento175641 como estado terminal e guardas de fechamento/reservas existentes. O incremento proposto altera somente o montante positivo do custo e a obrigação em aberto do MESMO expense/payable/charge. Beneficiário, categoria, data da despesa, entrega, comprovantes e cobrança permanecem. Mudar beneficiário ou regularizar dinheiro histórico exige operação específica posterior, não inferência por nome.

## Modelo e projeção

Tabela privada append-only expense_cost_amendments: tenant,expense_id,charge_id,payable_id,ordinal,previous_id,request_id,revision_before,before_cost/after_cost,before_payable/after_payable,actor/name,reason,captured_at e referência ao comando original do batch. Uma cadeia por expense, sem mudar expense.amount_cents original ou criar segunda descarga. Resolvedor efectivo valida original imutável, cadeia/evento/comando, tenant e correspondência da obrigação. Retorna original/effective/history/revision/verified; inválido não pode virar custo original silenciosamente nem desaparecer da soma sem diagnóstico.

Payable é projeção operacional mutável: atualizar amount para novo custo na mesma transação, preservando ID/source/beneficiário. Snapshot anterior e novo no evento preservam nominal original. Como o primeiro incremento exige ausência de qualquer alocação/pagamento histórico, complemento=novo custo integral. Proposta para approved: voltar explicitamente a pending, exibindo necessidade de nova aprovação no preview; não preservar aprovação de outro montante por inferência. Alternativa de menor escopo é bloquear approved até revisão: decisão de produto antes do writer.

A data da despesa original permanece. Relatórios de custo corrente por competência mostram valor retificado naquela data e história mostra quando foi corrigido. Não alegar posição as_of ou conhecimento anterior a commit, nem lançar a alteração como gasto novo na data atual.

## Consumidores obrigatórios antes de promover

1.130032 recorded_costs e152557 recorded_cost_summary: resolver valor efetivo, preservar original/histórico e estado cancelled. Soma usa um valor vigente por expense; não soma original+novo. Fonte inválida produz needs_review/total não comprovado, nunca coalesce para valor antigo.
2.175733→44823→51729 list_expenses: preservar amount_cents original na história; acrescentar cost_origin com valor vigente/histórico, e definir agregados correntes pelo efetivo. Receiptartifact_count e unloading_origin continuam separados. Não mudar expense_options, cujo corpo é capturado em190516.
3.134948 canonical_trip_costs e134943 settlement_expense_context (já usam active_expense_items após175641): migrar para projeção efetiva única. Snapshot novo inclui cost_revision/amendment_id e valor vigente; custo não vira segundo crédito de motorista. Acerto/folha existentes que materializem o custo bloqueiam este primeiro writer. Gerar acerto depois da retificação usa120, original150 permanece no evento/história.
4.02244 apply_payable_movement e carteira180040→50116: pagamento usa nominal atual do MESMO payable. Associar proof da versão do custo ao evento payable_movement_applied do pagamento futuro; pagamentos antigos nunca reinterpretados. Guard aditivo em novas dependências verifica custo efetivo/obrigação; não alterar check_payable_payment_insert capturado por190516 sem revisão específica. Capacidade do movimento continua pela soma de alocações reais, sem alterar dinheiro por correção de custo.
5.175641 expense_cancellation_context e clone53349 unloading_cost_cancellation_context: validar original pelo batch, nominal corrente pelo resolver; usar montante efetivo no cancelamento/KPI/resultado. Caso contrário correção150→120 faria os cancelamentos atuais rejeitarem payable120 contra original150.54915 precisa cancelar o custo efetivo restante sem nova retirada da cobrança.
6.211156/45402 contextos de descarga: comparação custo.amount_cents=chargeoriginal deve distinguir original preservado do custo efetivo. Corrigir serviço para120 não muda cobrança150; alteração posterior da cobrança continua possível quando grafo permitir.
7.55442 legacy_expense_cost_issue/snapshot e maintenance/stock claims: embora unloading não seja categoria elegível dessas associações, preservar bloqueios e impedir associação indevida por rawvalor antigo. Inventário efetivo via pg_proc após instalação integrada deve confirmar todos os consumidores e baselines; não substituir nomes por regex global.

## Elegibilidade e comando

Preview proposto get_finance_unloading_cost_correction_context(tenant,charge,target_amount_cents) exibe custo original/vigente/proposto, obrigação original/vigente/proposta, beneficiário comprovado, cobrança somente informativa, aprovação a refazer, IDs de todas dependências, revisão e efeitos. Command correct_finance_unloading_cost({version,tenant_id,request_id,charge_id,expense_id,payable_id,revision,target_amount_cents,reason}) exige IDs exatos e valor positivo diferente.

Bloquear custo/obrigação já cancelados, origem não comprovada, payable ausente/duplicado/destinatário incoerente, paidstatus sem prova, qualquer payment/link/reversal/allocation histórico, associação legada/material/estoque, obrigação derivada, acerto/folha materializados e fechamento ativo OLD/NEW. Reabrir período permite reavaliar, sem apagar histórico. Não liberar por soma líquida zero. Cobrança pode estar ativa ou cancelada auditadamente porque não muda; seu estado/prova entra na revisão.

Fiscal→finance→vínculo/perfilmotorista→charge/título/grafo→folha/viagem/acerto→expense/payable/beneficiário em ordem estável. Reauth após espera antes replay. Ticket privado com txid/ator/request/before/after exatos permite apenas UPDATE projetado do payable; guarda de novas dependências usa trylock40001 para row-first. Eventos de custo e payable e comando atômicos; falha do último evento desfaz tudo. Nenhum movimento/recebimento/pagamento gerado.

## Plano de provas com writers reais

- Batch serviço150/cobrança150/payable150→custo120/payable120, originais intactos, cobrança150, KPI120 e banco0; aumento150→180 também suportado.
- Sequência150→120→130 na mesma identidade; evento/versão anterior íntegros, stale40001, replay idêntico, tentativa de bifurcação/ownerupdate negada, rollback de falha audit sem ticket.
- Aprovação explícita e pagamento canônico após correção usam120; tentativa121 bloqueada. Extrato120 conciliado uma vez; snapshot de pagamento contém revisão do custo. Nova correção após pagamento bloqueia com IDs.
- Acerto gerado depois usa120 sem crédito duplicado; acerto materializado antes bloqueia. Folha/claims/associações negativas preservadas.
- Cancelamento175641/53349/54915 após correção retira custo/obrigação efetivos, não150; cobrança é decisão separada.
- Fechamento real bloqueia e reabertura reavalia; empresaativa/misto/tenantforeign negam; SQLretornos parsers reais e totais globais com paginação.

Somente proposta/read-only nesta rodada; nenhuma nova migração ou writer de correção positiva criado. A implementação só deve ser liberada com esses leitores e cancelamentos integrados, não como editor isolado de nominal.
