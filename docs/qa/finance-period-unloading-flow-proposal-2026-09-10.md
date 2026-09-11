# Próximo incremento: descargas e recuperação documentada no período

## Escolha

Implementar **um demonstrativo de fluxo de descargas por fornecedor**, com origem e recebimentos ligados aos movimentos do pacote193723. É uma ponte utilizável entre um direito a receber concreto e o dinheiro comprovado. Não é posição da carteira em data passada, nova trilha histórica nem painel todo desconhecido.

Atende plano4D/4E/4F e11.2/11.4: descarga gera direito contra fornecedor, recuperação é separada do custo, títulos/pagamentos/dinheiro não se somam. Respeita prioridade3 do pacote, mas não pretende resolver toda carteira ou adiantamentos nesta unidade.

## Fontes que já permitem cálculo

| Fonte | Data e valor preservados | Uso permitido |
|---|---|---|
| finance_unloading_charges | occurred_on, amount_cents, supplier_id, entrega raiz, receivable_id e snapshot append-only | Soma de descargas originalmente registradas cuja ocorrência está no corte, agrupada pelo fornecedor original. Não é saldo atual nem receita de frete. |
| finance_commands record_unloading | payload/result imutáveis, due_date original e created_at | Exibir vencimento originalmente declarado; não afirmar que continua vigente. Vincular comando e recibo. |
| receivables_payments canônicos | received_at e amount, payment_id/command_id imutáveis | Recebimento registrado referente à descarga, por data econômica SP, quando a identidade e ausência de disputa de alocação forem comprovadas. |
| receivable_payment_reversals | effective_at, amount, payment_id/command_id | Devolução real registrada, em seu próprio dia econômico. Não usar created_at como data do dinheiro. |
| finance_receivable_movement_links | command/payment/movement por IDs, action | Ponte canônica com entrada/saída. Validar direção, conta, valor alocado e data contra movimento congelado. |
| Pacote193723 | movimentos/saldos em closures exatas e íntegras | Dinheiro coberto no corte, contado uma vez por movement_id. Composição tardia pode ser exibida como evidência conhecida agora, nunca chamada de conhecimento existente no fechamento. |

Associações legadas podem aparecer no detalhe com seu snapshot/manualidade e reversão, mas não entram no primeiro total de recuperação comprovada sem validação integral por ID. Nenhum vínculo por nome/valor/data aproximados.

Correções de alocação025658 e créditos011121 têm apenas created_at, sem data econômica própria. São ressalvas conhecidas agora; não subtrair retroativamente nem projetar vigência anterior. Eventos com data não finita e fontes órfãs ficam em diagnóstico separado do filtro temporal para não desaparecerem.

## Contrato executável

`get_finance_period_unloading_flow(_tenant_id,_from,_to,_account_ids uuid[],_supplier_id uuid default null,_page integer default 1,_expected_revision text default null)`; páginas50, auth can_access, todas as contas escolhidas verificadas, motorista misto excluído.

Envelope: versão/tenant/period/timezone/currency; `basis: economic_event_dates`, `evidence_basis: currently_available_immutable_records`, `not_a_position:true`; revision/captured_at; money_package_revision; account_scope; sources_total/unknown_date_count; origin_totals; receipt_totals; refund_totals; supplier_groups; rows; issues/limitations.

Cada bloco monetário tem valid/count/amount_cents string|null, não Number. Campos diferentes não são somados como um total geral. Páginas e grupos usam o mesmo conjunto completo; revisão inclui todos os eventos, ressalvas, origens e revisões dos closures, sem captured_at. Revisão divergente retorna40001. A consulta não congela o conhecimento: entrada registrada amanhã com data econômica anterior muda a revisão e exige releitura.

Linha de origem: charge_id, receivable_id, supplier_id/nome do snapshot original, delivery_stop_id, occurred_on, amount_cents, original_due_date, original_command_id, recibo e IDs de documentos do source_snapshot. Não usar NFs/cliente atuais para redeterminar fornecedor.

Linha de recebimento/devolução: payment_id, reversal_id quando aplicável, command_id, movement_id, bank_account_id, economic_on, recorded_at, amount_cents, charge/supplier, cobertura por closure_id e issues. Correção/crédito/associação manual são sidecars com seus IDs e registro, sem inventar data econômica.

## Cálculos e não duplicação

1. **Descargas originadas no corte:** soma charge.amount_cents uma vez por charge_id onde occurred_on está em[from,to]. Independente de conta selecionada: uma obrigação não pertence a uma conta bancária antes do pagamento. Rotular explicitamente escopo empresa/fornecedor, distinto do escopo monetário das contas.
2. **Recebimentos de descarga no corte:** incluir pagamentos de qualquer charge, inclusive ocorrida em mês anterior, cujo received_at SP está no corte e conta está selecionada. Exigir uma origem descarga inequívoca pelo receivable_id, comando/pagamento/link coerentes e movimento ativo/frozen compatível. Um payment_id entra uma vez. Aliases bank_transaction/load_payment não acrescentam valor.
3. **Conflitos de alocação:** quando existir correção/crédito ou múltiplas alocações disputando a mesma capacidade, não somar o recebimento como recuperação líquida histórica daquele fornecedor. Expor linhas e IDs; o grupo afetado fica indeterminado. Validar a capacidade de entrada contra **todas** as alocações de outros títulos, não só descarga. Reuso após correção não vira dois recebimentos de caixa.
4. **Devoluções:** somar cada reversal_id uma vez por effective_at SP, independente do mês do pagamento original. Não apagar o pagamento original; não reaplicar a devolução em outro corte. Correção sem devolução não entra nessa coluna.
5. **Dinheiro no pacote:** agregar a evidência bancária/caixa por movement_id uma vez. Se um Pix de300 cobre descarga100 + frete200, a linha de descarga mostra alocação100 e aponta movimento300; não somar300+100 nem copiar300 para cada título. A coluna alocada não substitui o total bruto congelado do pacote.
6. **Sem saldo fictício:** não calcular aberto final, vencido, complemento a motorista ou obrigação cancelada apenas a partir desses três fluxos. Exibir original_due_date como tal. Não chamar charge−recebimentos do corte de saldo devedor.

Um crédito/correção atual pode tornar a classificação por fornecedor indeterminada sem invalidar o total monetário comprovado pelo pacote. O relatório não impõe bloqueio novo ao fechamento por pendência apenas de composição.

## Aceite mínimo com writers reais

- Descarga150 em janeiro; recebimentos60+90 em fevereiro: janeiro originada150/recebido0; fevereiro originada0/recebido150. Nenhum saldo aberto presumido.
- Um Pix300 alocado100 à descarga e200 ao frete: descarga100, dinheiro300 uma vez, IDs dos dois títulos presentes no controle de capacidade.
- Mesmo fornecedor, várias NFs de uma entrega: uma charge; duas entregas podem ter duas charges distintas. Fornecedores homônimos nunca agrupados por texto.
- Devolução20 em março de pagamento de fevereiro: coluna devoluções de março20, original mantido.
- Correção de alocação/reuso do mesmo movimento: diagnóstico por IDs, jamais duplicar recuperação/dinheiro. Crédito de cancelamento não vira devolução bancária.
- Descarga antiga com recebimento no corte continua incluída; descarga no corte sem recebimento gera número válido de origem, sem fabricar entrada ou conta.
- Registro tardio com economic_on anterior muda revisão; rótulo de evidência atual permanece, sem alegação de commit visibility histórica.
- >1000 fontes, paginação consistente, fornecedor inativo/renomeado, missing date/órfão, contas excluídas, empresa alheia e motorista misto.

## Gaps mantidos explícitos

Carteira aberta/vencida as_of ainda depende de política temporal e cobertura; parcela histórica do prazo renegociado não é reconstruída pelo vencimento original. Adiantamento do motorista exige saldo de responsabilidade com compensações/devoluções explícitas; natureza driver_advance no movimento não basta. Expectativa de frete sem vencimento comercial segue sem data presumida. Este incremento não resolve essas três frentes, mas entrega valores econômicos reais e sua ponte com o pacote, sem novo dinheiro ou duplicação de origens.
