# Devolução registrada vinculada à disposição — candidato74603

Migração: `supabase/migrations/20260911074603_finance_cost_disposition_recorded_returns.sql`.
SHA256 congelado: `dff497b45ea51da7287c628da7208630bc6456e6b617ff5f9f49319bbe5675b4`.
Catálogo real pós-instalação: `finance-cost-return-catalog-2026-09-11.json`, dez funções com MD5 normalizado, ACL, volatilidade, search_path e security definer.

## Comportamento

O comando privado vincula uma parcela de entrada já registrada à disposição vigente. Não cria movimentação, pagamento, conciliação ou crédito fictício. Exemplo: custo original150 corrigido para120, recuperação30; entrada30 já existente recebe vínculos10 e20. A obrigação nominal/paga150 e a saída/reserva150 permanecem intactas. A pendência corrente cai30→20→0 e a entrada possui30 de capacidade consumida.

`residual_cents` e `status:'pending'` continuam sendo o snapshot da disposição original. O overlay acrescenta `returned_cents`, `open_cents`, `resolution_status` e histórico de retornos. Coverage e carteira acrescentam totais devolvidos/abertos, inclusive por responsabilidade do motorista e recuperação do prestador; não sobrescrevem o residual histórico. A revisão da carteira inclui todos os retornos, não apenas a página exibida.

A entrada exige mesma empresa, direção de entrada, natureza permitida, data finita posterior ou igual à saída e prova canônica de registro. Motorista exige driver_id original; recuperação do prestador exige contraparte nominal igual à preservada. Essa correspondência é evidência do registro financeiro e não certificação bancária da identidade civil. A confirmação/conciliação bancária continua separada.

## Contratos privados e promoção planejada

- `cost_disposition_return_context(t,disposition,incoming,amount_text)`; wrapper futuro `preview_finance_cost_disposition_return(_tenant_id,_disposition_id,_incoming_movement_id,_amount_cents)`.
- `record_cost_disposition_return(payload)`; wrapper futuro `record_finance_cost_disposition_return(_payload)`. Payload version1/tenant_id/request_id/disposition_id/incoming_movement_id/amount_cents/revision/reason. Resultado inclui return_id, todas as identidades e efeitos confirmados.
- `cost_return_movement_options(t,disposition,query,page,expected_revision)`; wrapper futuro `get_finance_cost_return_movement_options`. Trinta linhas por página, revisão do conjunto completo, identificação por conta/data/contraparte/capacidade. Seleção passa pela prévia completa antes da confirmação. Disposição encerrada ou inválida deixa de oferecer opções.

Journal privado append-only `cost_disposition_returns`, sem grants às aplicações. Validação diferida exige fonte original, comando e evento compatíveis. Escrita toma fiscal→finance, revalida acesso após espera e antes do replay, trava disposição/expense/entrada/conta e confirma revisão novamente. Falha de auditoria desfaz vínculo e consumo.

A soma de `receipt_movement_used_cents` agrega retornos aos usos canônicos e legados. Os consumidores existentes continuam protegendo a capacidade compartilhada; cada parcela vinculada deixa de estar disponível para outra baixa. Não libera capacidade da saída original. Invalidação da entrada vinculada é bloqueada. Nova correção econômica após retorno exige plano explícito de transporte dos vínculos; prévia e guarda impedem ressuscitar saldo trocando IDs de disposição.

## Provas locais

`src/test/costDispositionReturns.test.ts`: cinco testes passaram05:05:12(local) em2026-09-11; ESLint0. Parsers reais `costDispositionReturnPreviewSchema`, `costDispositionReturnResultSchema` e `costReturnMovementOptionsSchema` validaram SQL.

1. Vínculos parcial/integral e replay; snapshots de payable/payments/movements/links byte-equivalentes, reserva de saída150 e consumo de entrada30.
2. Escritor canônico real `apply_receivable_financial_command` não reutiliza entrada consumida; nenhuma baixa residual. Carteira muda revisão e rejeita página antiga40001.
3. Rollback por falha final de auditoria; contraparte divergente, revisão antiga, outro tenant e motorista misto negados; entrada protegida contra invalidação e nova retificação sem transporte de vínculos bloqueada.
4. Envio real ao motorista, lote/descarga integralmente cobertos, custo120/custódia30; retorno exige driver_id correto e zera somente a pendência corrente.
5. Trinta e duas entradas reais, páginas30+2; consumo parcial muda revisão mesmo mantendo a quantidade de candidatos.

A fixture reutiliza60519 e os predecessores completos de upload/leitores, depois72557/72723. Acrescenta os corpos reais145616 de capacidade compartilhada e185517 de origem do movimento, omitidos nessa fixture-base, além do trigger real de recálculo do payable. Não simula estado pago ou sucesso financeiro. O INSERT de invalidação do negativo é deliberadamente rejeitado antes da persistência; não fabrica uma invalidação válida.

Revisão independente do agente banco: três testes locais passaram nas duas ordens de disputa com associação legada e com contraprova que invalida o custo/retorna valores correntes desconhecidos. Fonte específica e eventuais ensaios PostgreSQL nativos constam no relatório independente; esta nota não afirma concorrência nativa.

## Limites e implantação

Nenhum wrapper público é promovido por74603. A sobreposição altera corpos fixados pela promoção74203: a próxima promoção/readiness precisa pin explícito dos novos contratos. Não atualizar baselines indiscriminadamente. Não aplicar este overlay sem interface compatível com residual histórico e saldo corrente.

Compensação, nova prestação de contas, correção de vínculo de devolução e transporte de retornos para nova regularização continuam etapas próprias. Nenhuma é executada ou sugerida como pronta por este comando. Fechamento da entrada exige reabertura real quando o período estiver protegido.

Nenhuma aplicação remota, commit, TSC, deploy ou PostgreSQL nativo executado por este agente nesta rodada.
