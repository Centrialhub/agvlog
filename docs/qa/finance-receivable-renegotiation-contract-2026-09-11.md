# Renegociação do saldo aberto — contrato candidato

Estado: desenho para implementação local; nenhuma API ou migração promovida. Base examinada: HEAD 7d362321, incluindo ajuste15046, previsão15916 e boundary121356 publicados. Requisito: plano financeiro linhas470–474. Não inclui juros, emissão fiscal nem alteração do nominal original.

## Modelo e invariantes

O recebível original continua sendo a única origem econômica e o único destino do ledger canônico. Parcelas são obrigações filhas privadas, nunca linhas adicionais em public.receivables. Uma versão de acordo distribui exatamente o saldo aberto verificado no momento da confirmação; dinheiro, créditos e descontos/perdas anteriores permanecem no ledger e no histórico original.

Tabelas privadas aditivas propostas: receivable_agreement_events (create/revise/revoke, receivable_id, previous_id, request/ator/motivo, snapshot e revisão); receivable_agreement_installments (agreement_id, id estável da parcela, ordinal, amount_cents, due_on); receivable_installment_allocations (evento canônico e tipo cash/credit/discount/loss, parcela, valor, evento de distribuição compensado quando reverse). Todas append-only, tenant explícito, FKs compostas e acesso raw negado. Nenhuma coluna nova em recebíveis/eventos históricos capturados por to_jsonb.

Equações obrigatórias: saldo original atual = soma de saldos das parcelas atuais + saldo não distribuído; liquidação canônica posterior ao acordo = soma das distribuições ativas por evento, sem duplicar liquidação no ledger. Soma de parcelas da nova versão = saldo aberto da revisão aprovada. Valores em centavos inteiros; sem negativos para simular estorno. Revisar acordo mantém versões anteriores e pagamentos associados a elas; somente o saldo remanescente passa às novas parcelas.

Estorno/liberação/reversão de evento distribuído restaura exatamente suas parcelas. Caso a versão tenha sido substituída, o valor restaurado aparece como saldo não distribuído, com requires_reallocation; não altera silenciosamente o valor das novas parcelas. Reversão de evento anterior ao acordo também gera saldo não distribuído. O saldo continua na carteira, com data não determinada e pendência explícita na previsão, até revisão do acordo. Isso preserva os writers legítimos de reversão sem inventar vencimento.

Cancelamento fiscal confirmado ou cancelamento válido da cobrança torna parcelas não cobráveis através da origem canônica; não apaga acordo/distribuições. Falha de compensação usa a recuperação fiscal existente. Suspensão fiscal impede novas baixas; não converte agenda em autorização financeira.

## Contratos privados propostos

receivable_agreement_context(tenant uuid, receivable uuid, proposal jsonb): preview de create/revise/revoke, vinculada ao snapshot financeiro e à versão atual. Proposal = {action, installments:[{id,amount_cents:string,due_on:date}]}; revoke exige lista vazia e retorna saldo ao vencimento original comprovado, mantendo histórico.

record_receivable_agreement(payload jsonb): {version:1,tenant_id,request_id,receivable_id,action,expected_revision,reason,installments}. Retorna {version:1,confirmed:true,tenant_id,actor_id,request_id,event_id,agreement_id,receivable_id,action,cash_changed:false,effects}. manager owner/admin existente; revisão após travas; request replay por identidade e payload integral.

receivable_installment_position(tenant uuid,receivable uuid): {version:1,verified,issue,receivable_id,agreement_id:null|uuid,revision,status:none|active|revoked|source_blocked,open_cents:string|null,scheduled_open_cents:string|null,unallocated_open_cents:string|null,requires_reallocation,installments:[{id,agreement_id,ordinal,due_on,amount_cents,cash_cents,credit_cents,discount_cents,loss_cents,open_cents,status}],history_count}. Histórico separado paginado com revision/offset/limit/next_offset; não truncar silenciosamente a agenda vigente.

Preview comum: {version,tenant_id,actor_id,receivable_id,revision,eligible,can_manage,can_execute:false,blockers:[{code,source_ids}],target:composição financeira atual,agreement:posição,effects:{cash_changed:false,nominal_changed:false,open_before_cents,open_after_cents,scheduled_before_cents,scheduled_after_cents,unallocated_before_cents,unallocated_after_cents}}. Identidades de parcela propostas são preservadas no outbox. Campos numéricos de diagnóstico inválido são null; não zero inventado.

## Baixa por parcela: integrar, não duplicar writers

O comando canônico de recebimento hoje aceita receivable_id, amount_cents e movement_id, sem parcelas (src/lib/financial/receivableCommands.ts:10–15). Extensão revisável: installment_allocations:[{installment_id,amount_cents:string}] + expected_agreement_revision. Na presença de acordo ativo, confirmação exige distribuição completa e cada valor limitado ao saldo da parcela. Sem acordo, corpo legado mantém comportamento atual. O mesmo contrato de distribuição acompanha aplicação de crédito e desconto/perda. A entrada bancária/pagamento continua sendo criada ou utilizada exclusivamente pelo writer existente; o journal filho só identifica a qual parcela corresponde.

Implementação deverá envolver os writers canônicos em contexto transacional privado com prova de distribuição e constraint diferida. Não basta wrapper opcional: caminhos antigos/raw não podem produzir liquidação nova sem distribuição quando houver acordo ativo. Reversões existentes e liberação automática fiscal precisam compensar as distribuições antes da verificação diferida. Replays usam a distribuição original, sem exigir nova seleção ou reaplicar valor.

## Consumidores concretos e divisão

- Snapshot/ledger15046: manter cash/credit/discount/loss/settled intactos; acrescentar apenas grupo agreement com revisão/contagens/pendência. Nunca somar parcelas ao nominal.
- Recebimento/reversão: receivableCommands.ts e writer canônico; pagamento listado por20202421 deve expor distribuição histórica paginada.
- Crédito01312 e ajustes15046: inserir/compensar vínculos a parcelas no mesmo commit do evento original; public contexts devem mostrar saldos e seleção por parcela.
- Carteira bulk13458+15046 e páginas04429: totais financeiros continuam por recebível; classificação temporal/atraso deve usar saldos filhos, sem duplicar contagem econômica. Datas mistas exigem indicação de parcelas, não escolher arbitrariamente uma única data.
- Previsão94505+15916: dividir somente saldo futuro em linhas filhas com economic_key vinculada ao pai e parcela, mantendo um total econômico. Snapshot antigo imutável; agenda anterior do pai fica explicitamente superada/stale, sem prevalecer sobre acordo contratual.
- Fatura/fechamento: recebido/aberto seguem o recebível original; exibir acordo e parcelas sem criar outra fatura. Guards de fechamento continuam bloqueando alterações vedadas.
- Fiscal worker/cancelamento e source_issue de descarga: preservar fatos e autorização existentes; agenda derivada nunca ativa uma origem inválida.

## Ordem e provas de entrega

1. Journal/resolver/preview e testes de soma/revisão/identidade, sem publicação do writer isolado.
2. Integração atômica de dinheiro, crédito, ajustes e reversões; exemplos nominal1000/cash600/acordo400 em200+200, baixa150 na primeira, estorno150, crédito100 na segunda; banco/nominal preservados.
3. Revisão do saldo restante com parcelas parcialmente liquidadas; estorno legado e estorno de versão antiga geram pendência não distribuída, sem esconder dívida.
4. Carteira/páginas/previsão/fatura/fechamento e schemas reais; provar somas, vencimentos, cancelamento fiscal e ausência de dupla receita.
5. Permissões tenant/actor/mixed driver, request replay, rollback integral, period guard; disputas nativas renegociação×baixa/crédito/cancelamento e reautorização após espera.

Parcela comercial numerada em fatura não é substituto desse modelo. Retenções e juros são trabalhos separados; não entram como desconto ou perda automaticamente. Qualquer caminho ainda não integrado deve permanecer indisponível explicitamente na candidata até a promoção conjunta.
