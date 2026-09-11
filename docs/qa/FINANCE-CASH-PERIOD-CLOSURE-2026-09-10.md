# Fechamento real de caixa físico

Migration local 20260910173906_finance_cash_period_closure.sql. SHA256 `c5a8e1039831002b94b39f4ef870d5c641c835533df63c97c9961209ec0377e5`. Sem aplicação remota.

Contagem explícita em denominações BRL usa cash_count_total, incluindo zero. O servidor preserva autor, custodiante, motivo, data real do registro e declaração end_of_day para o dia selecionado. Conta cash ativa apenas, dia encerrado em São Paulo, uma contagem ativa por conta/fim, replay estrito. Contagem divergente é gravada normalmente; falta/sobra bloqueiam fechamento e nunca criam ajuste.

Snapshot separado cash_count_v1 exige abertura física válida, primeira janela exatamente na abertura ou predecessor contíguo, contagem selecionada ativa da mesma conta/fim, posição registrada igual à contagem, revisãoB vigente/aprovada e guards efetivos. Movimento de caixa é somado uma vez; parcelas bancárias de adiantamento não entram nessa conta, e aliases72624 não somam novamente. Evidência bancária atribuída a cash bloqueia como anomalia; não há OFX fictício.

Fechamento usa finance_account_period_closures/dependencies existentes, acrescentando cash_evidence. A guarda de movimentos existente bloqueia dinheiro retroativo. Count e reversal têm guarda própria; contagem usada por fechamento ativo não pode ser retirada. Reabertura existente preserva snapshot, exige capacidade owner/admin e rejeita predecessor com sucessor ativo. Correção da contagem é reversão seguida de novo registro, não UPDATE. Contagem registrada posteriormente não prova que o cadastro ocorreu no instante declarado do encerramento.

## Contrato final

record_finance_cash_period_count e reverse_finance_cash_period_count seguem finance-cash-period-close-contract-2026-09-10.md. Resultado {version,tenant_id,request_id,count_id,account_id,period_end,counted_cents:string,revision,confirmed:true,cash_created:false}; reversão acrescenta reversal_id.

preview_finance_cash_period_close(_tenant_id,_account_id,_from,_to,_count_id) retorna version/tenant/account/from/to/currency/timezone/evidence_type/revision/eligible/can_execute/blockers; opening_id/predecessor_id; objetos account/opening/predecessor/count/legacy; balances com opening_cents,in_cents,out_cents,expected_closing_cents,counted_closing_cents,difference_cents,closing_cents; facts.movements/transfers/transfer_departures e dependencies. Valores desconhecidos são null. Count tem total_cents string e counts originais; abertura/predecessor são snapshots das linhas. closing_cents equivale ao contado, para encadeamento existente.

close_finance_cash_period recebe versiontenantrequestaccountfromtocount_idrevisionreason e retorna envelope padrão close. Eventos cash_period_count_recorded, cash_period_count_reversed, cash_period_closed; reabertura mantém account_period_reopened. Reader de contagens/histórico74142 e auditoria global são responsabilidade da integração root.

## Verificação

10 testes PGlite próprios passaram; ESLint passou. Abertura10000+entrada1000-saída2500=contagem8500 fecha com revisãoB real. Falta/sobra permanecem registradas e impedem close. Caixa zero fecha. Contagem e dinheiro retroativo são protegidos até reabrir. Sucessor contíguo fecha e impede reabrir predecessor. Revisão antiga após novo dinheiro falha. Conta bancária, dia atual e motorista são rejeitados. Replay count/close não duplica. Reader real get_finance_account_period_evidence passa schemaUI e integridade snapshot/dependencies antes/depois reabrir. Adiantamento com parcelas cash2000+banco3000 afeta caixa apenas2000. Transferência real banco→cash adiciona a perna física2000 sem nova receita ou extrato.

Factory createCashPeriodCloseDatabase compõe schema atual72624 sem alterar fixtures congeladas. Native concorrência está com agente de banco, ainda não alegada neste relatório. Sem ensaio de implantação completa das migrations no remoto.

Pendências de escopo não ocultadas: contagem é declaração física auditada, não autenticação bancária nem garantia antifraude; encerramento depende de todas as origens monetárias legadas estarem resolvidas; eventuais registros reais de perda/sobra exigem política separada e não são criados automaticamente. A abertura sozinha não certifica períodos posteriores.
