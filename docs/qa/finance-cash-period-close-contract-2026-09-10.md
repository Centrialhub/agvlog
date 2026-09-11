# Fechamento de caixa físico — contrato implementável

2026-09-10. Desenho de próximo incremento; nenhuma mudança no core72624 ou SQL de produto. Não existe hoje fechamento positivo de caixa:62958:12 aceita apenas checking/savings e em15/31–39 exige cobertura e conciliação bancária. A abertura141240 já admite cash_count_v1 sem receita/extrato.

## Limite de autoridade

Uma contagem é declaração física assinada, não prova bancária nem garantia de inexistência de fraude. O encerramento de caixa certifica que a contagem registrada coincide com a posição dos movimentos no corte. Caixa e contas bancárias permanecem separados. A política mínima mantém owner/admin + can_access para fechar/reabrir; operador pode consultar e registrar contagem; motorista e papel misto são excluídos por can_access. Não exigir segundo autor como se fosse regra já combinada.

## Comandos propostos

1. `record_finance_cash_period_count(payload)` estrito: `{version:1,tenant_id,request_id,account_id,period_end,counts:[{denomination_cents:number,quantity:number}],custodian_name,reason,counted_at_boundary:'end_of_day'}`. Fim deve ser dia encerrado em São Paulo. Total calculado pelo cash_count_total141240, sem float. Contagem zero é válida por denominação com quantidade zero. A moeda é BRL. Registra effective boundary, created_at real e autor separadamente: usuário declara a contagem no encerramento daquele dia; o sistema não afirma que foi gravada naquele instante.
2. `reverse_finance_cash_period_count(payload)` estrito `{version:1,tenant_id,request_id,count_id,revision,reason}`. Reversão append-only; exige autor com capacidade de fechar para retirar evidência. Bloqueada enquanto dependência de fechamento ativo; reabrir antes. Corrigir implica reverter e registrar outra contagem, nunca editar cédulas históricas.
3. `preview_finance_cash_period_close(tenant,account,from,to,count_id)` operador: envelope comum de fechamento mais evidence_type cash_count_v1, contagem selecionada, balances e blockers. Seleção explícita evita escolher silenciosamente outra contagem recente.
4. `close_finance_cash_period(payload)` `{version:1,tenant_id,request_id,account_id,from,to,count_id,revision,reason}`. Ação distinta no journal; usa a mesma tabela de fechamentos/reaberturas e dependency registry. Wrapper de reabertura existente pode atender caixa após validar tipo no snapshot.

Resposta de contagem: `{version,tenant_id,request_id,count_id,account_id,period_end,counted_cents:string,revision,confirmed:true,cash_created:false}`. Preview: `{version,tenant_id,account_id,from,to,evidence_type:'cash_count_v1',revision,eligible,blockers:[{code,source_table,source_ids,scope}],opening,predecessor,count,legacy,balances:{opening_cents,in_cents,out_cents,expected_closing_cents,counted_closing_cents,difference_cents},dependencies}`. Todos centavos strings. `difference=counted-expected`: negativo falta, positivo sobra. Ausência de abertura/contagem mantém campos desconhecidos null, não zero.

## Persistência

`finance_cash_period_counts`: id,tenant_id,account_id,period_end,evidence_type,currency,timezone,boundary,counts,total_cents,actor_id,actor_name,custodian_name,reason,created_at,request_id,revision. Append-only e validação de denominações/total/tipo de conta em trigger. `finance_cash_period_count_reversals`: id,tenant_id,count_id,expected_revision,actor_id,actor_name,reason,created_at,request_id. Uma reversão por contagem. Para o mesmo account/end permitir apenas uma contagem ativa; preservar todas antigas. Guard residual e comando serializam concorrência. FK composta tenant/ID onde possível.

Diferenças não são apagadas nem viram movimento automaticamente. Contagem divergente pode e deve ser gravada; bloqueia fechamento. Investigação pode corrigir registro monetário por comando auditado ou produzir nova contagem quando a anterior estiver errada, preservando a anterior/reversão. Não existe `accept_difference` ou ajuste automático para forçar igualdade. Um eventual registro real de falta/sobra precisaria natureza/política explícita separada e evidência; não está autorizado por este contrato de fechamento.

## Condição positiva determinística

- Conta ativa cash/BRL; período encerrado, finito, até366dias, sem fechamento ativo sobreposto.
- Primeira janela começa na abertura ativa cash_count_v1 validada; sucessoras são contíguas e usam saldo final contado do predecessor ativo. Não reiniciar saldo por nova contagem no meio de cadeia fechada.
- expected=opening+sum(in)-sum(out), usando finance_movements da conta nos dias inclusivos de São Paulo; todos IDs entram no snapshot. Count final ativo corresponde à mesma conta/fim; difference=0.
- Revisão B atual e aprovada, sem pendências monetárias/integridade; guards/retention presentes e versão compatível. Contagem não resolve dinheiro legado sem origem.
- Nenhuma exigência OFX, bank_entries, cobertura bancária ou matched_bank_count para conta cash. Dependências bancárias não são fabricadas como arrays de evidência aprovada.
- Extrato importado atribuído a cash ou vínculo bancário indevido deve aparecer como anomalia de domínio, não conferir legitimidade à conta física.

Movimento novo retroativo muda revision e bloqueia fechamento com preview antigo. Contagem nova/reversa muda revision. Hash exclui relógio de consulta; inclui IDs e conteúdo de abertura, contagem, movimentos, conta, transferências e manifesto/revisão B. Exportação histórica guarda contagens/autor/diferença e não consulta estado atual para reescrever passado.

## Guard e integração concretos

- Introduzir branch explícito cash no produtor62958 ou produtor privado separado chamado por dispatcher; não relaxar validações bancárias existentes.
- Foundation62807 já oferece imutabilidade, overlap, dependência predecessor, journal e reabertura; ampliar whitelist payload/ação ou adicionar wrapper específico. Fechamento cash usa mesma tabela para que guard monetário63109 detecte a conta sem duplicar um universo invisível de encerramentos.
- Dependency role atualmente enum em62807:17 não admite cash_evidence. Adicionar esse valor e source_kind finance_cash_period_counts/reversals. Resolver63109 deve localizar account/period_end e dependency ID; guards_ready exige esses triggers antes do caminho positivo.
- Proteção de finance_movements e account_type permanece; inserir contagem/reversão em data dependente de fechamento ativo exige reabrir. Proteger mudança de conta/tenant também pelo OLD; serviço não tem bypass.
- Locks: finance tenant → contas em ordem → contagem/fechamentos; acesso após espera e replay pelo mesmo ator/payload. Escritor que já possui row lock usa try advisory e erro de retry, não espera invertida.
- Queries histórico/evidência64923/164256 e schemasUI precisam union discriminada bank_statement_v1/cash_count_v1. Snapshot de caixa informa counted versus expected; não intitular contagem como extrato.
- Reabrir predecessor com sucessor ativo continua proibido. Snapshot antigo e divergências prévias continuam imutáveis; novo fechamento após reabertura gera ID novo.

## Adiantamentos, várias contas e transferência

Somar apenas pernas de dinheiro da conta cash. Adiantamento em duas parcelas (cash+banco) resolve footprints por IDs antes de filtrar: parcela cash entra uma vez; projeção employee_advances/already_paid não soma nem reserva novamente.72624 futuro deve fornecer essa prova; não modificar nem contornar sua implementação em andamento. Falta de conta em origem real continua bloqueando contas possíveis.

Saque banco→caixa usa transferência real com perna out no banco e in no cash. Caixa→banco inverso. Não transformar saque em despesa nem depósito em receita. Trânsito posterior não retroage caixa: chegada física é sua data de entrada. Transferências cruzando o corte conservam estágio e valor; discrepância de contagem não pode ser eliminada criando par artificial. Gastos ainda sem detalhamento podem ser composição posterior nos mesmos termos da guarda64942, sem reescrever dinheiro congelado.

## Modelo executável e matriz de validação necessária

`finance-cash-close-arithmetic-model.sql`: proposta somente leitura com cinco parâmetros, utiliza account_opening e cash_count_total reais; não produz autorização de encerramento. Executada em PGlite com abertura e movimentos por comandos reais: 1 teste passou em financeCashCloseArithmeticModel.test.ts, saldo8500 e falta500 preservados. Isso valida aritmética/contrato existente, não constitui prova de fechamento ou completude. Não instala RPC/migração.

Implementação deverá provar: abertura10000+entrada1000-saída2500=contagem8500; falta e sobra persistidas bloqueando close; caixa vazio com contagemzero; conta bancária rejeitada; diaSP/futuro; contagem duplicada/replay concorrente; close×movimento e close×reversão contagem; reauth após espera; predecessor contíguo/reopen dependente; adiantamento com pernas cash+banco; pagamento e projeção na folha sem dupla soma; transferência real banco/cash; evidência/exportação idêntica após reabrir. Fixtures precisam comandos reais e schemasUI, não apenas flags de elegibilidade.
