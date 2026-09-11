# Integração UI da correção de movimento — 10/09/2026

Proposta somente leitura de produto; nenhum componente, contrato executável ou SQL alterado, nenhum TSC. Base: finance-movement-correction-contract-2026-09-10.md. Nomes novos abaixo são propostas, não RPCs disponíveis.

## Pontos reais de entrada

| Arquivo / ponto | Estado atual | Integração proposta |
|---|---|---|
| src/pages/FinanceMovements.tsx:22 | Rota /financial/movements; owner/admin/operator + useFinanceAccess; workspace keyed tenant/actor | Manter leitura para operador; comando depende de capability do preview, owner/admin conforme decisão de backend. Perfil misto motorista continua recusado pelo can_access. |
| FinanceMovements.tsx:38,55–72 | Lista paginada50, cards total/inflow/outflow, tabela sem estado de invalidação; esconde erro, mas ainda mostra dados durante isFetching | Acrescentar ação por ID “Conferir / corrigir registro”, status textual e cor de registro invalidado. Ocultar comparação obsoleta enquanto consulta/preview atualiza. Preservar original na lista histórica. |
| FinanceMovements.tsx:66,73 | Único detalhe hoje é MovementReceiptTrace; não existe MovementHistoryDetail | Criar MovementCorrectionReview independente, sem transformar “Vínculos com recebíveis” em prova de ausência de dependências. |
| src/hooks/useFinanceLedger.ts:21 | Query finance-movements,tenant,user,filters; retry:false | Evoluir filtro/resultado via servidor para active/history/all; reiniciar página em mudança de filtro. Revisão por página se backend oferecer snapshot de lista. |
| src/lib/financial/ledgerContract.ts:7–25 | Movement tem receipt_path/created_by/created_at; lista só total/inflow/outflow. Sem active/void/origem/autor nominal | Estender resposta obrigatória após nova migration, sem default active=true para dados antigos desconhecidos. Identidades e centavos totais textuais. |
| src/lib/financial/ledgerClient.ts:153 | readFinanceMovements chama list_finance_movements e valida tenant/página | Manter esse caminho; novo cliente movementCorrectionClient para preview/comando/resultados, sem reusar RPC de criação na correção. |
| src/components/financial/MovementEntryDialog.tsx:24–60 | Registra movimento novo, preserva form/request em sessionStorage; erro conhecido primeira tentativa desbloqueia | Reaproveitar conceito de formulário, não chamar esse diálogo em sequência void→record. Substituição necessita comando atômico e pedido único. |
| src/components/financial/MovementReceiptTrace.tsx:7–30 | Só recebíveis, canônicos/adoção, correção/devolução separados; copy já declara cobertura limitada | Continua histórico. Void não remove recibos nem links de snapshots. Pode indicar status atual separado apenas se reader o fornecer. |
| src/components/financial/ExpenseReceiptDialog.tsx | Consulta comprovante existente com tenant/path | Reusar para comprovante original; nunca remover objeto como parte da correção. |

## Fluxo mínimo utilizável

Botão na linha abre MovementCorrectionReview(tenant,actor,movementId), com query própria por ID. Ler original, situação atual, origem comprovada, permissões, impedimentos e histórico. Mostrar conta/data/direção/natureza/beneficiário/valor/documento, comprovante e identificação original. Ausência de recebíveis não habilita correção.

Primeira entrega pode expor somente “Invalidar registro incorreto” para movimento manual livre elegível. Motivo10..2000 e declaração explícita de erro de registro, depois revisão final dos efeitos em conta/dia. Produto: “Nenhuma transação bancária será executada. O valor representado nos registros será alterado.” Não escrever “dinheiro inalterado” isoladamente, pois o saldo representado muda. Não oferecer entrada compensatória nem desfazer em cascata pagamentos/conciliação.

Original invalidado: status permanente “Invalidado — excluído dos totais ativos”, eventoID, autor nome/ID, data, motivo, referência à duplicidade/substituição se existente. Título do novo movimento corrigido aponta original e evento. Sem botão reativar nesta versão. Campos do original nunca são editados em memória para parecerem o substituto.

Duplicidade exige seleção explícita de outro ID ativo, com detalhes do escolhido; nunca preselecionar por valor/data/nome. Se não houver leitor paginado de candidatos, omitir esse facilitador na primeira entrega, mantendo motivo e invalidação simples; não aceitar referência digitada sem consulta/preview validado. Substituição fica indisponível até haver comando atômico confirmado.

Estados: consultando, erro, bloqueado, elegível sem capability, revisão, pedido incerto, confirmado e original já invalidado. Revisão invalida quando grafo/revision muda. Pedido durável por tenant/actor/movementId, persistido antes do envio, bloqueio de armazenamento corrompido e retomada integral após resposta perdida; rejeição conhecida libera edição só na primeira tentativa, nunca descarta pedido antes incerto. Troca de empresa/ator reinicia workspace sem reutilizar query/draft alheios.

## Envelope mínimo a fechar com core

Prévia: version,tenant_id,movement_id,revision,eligible,can_execute,origin_kind,original (dados do movimento+ator e comprovante), active, blockers[{code,source_table,source_ids,scope}], dependencies[{kind,ids,active_or_historical}], affected_accounts_periods[], effects[{account_id,from,to,before_recorded_cents,after_recorded_cents,delta_cents}], history/void|null com autor/motivo/created_at e original/duplicate/replacement IDs. Efeitos monetários assinados em string, null para indeterminado; não inferir saldo bancário a partir deles. Histórico separado de eligibility para continuar consultável quando original está inativo.

Confirmação: envelope tenant/request/movement IDs, void_id, replacement_movement_id nullable, confirmed:true, bank_money_transacted:false, recorded_balance_changed:boolean e deltas completos calculados servidor. Payload não recebe saldo calculado no browser. Reusar nomes propostos do documento-base somente após confirmação do autor SQL. Capability não deve ser inferida do currentRole local.

Lista: total histórico do filtro, active_count, voided_count, active_inflow_cents, active_outflow_cents, historical_inflow_cents, historical_outflow_cents; rows com active:boolean, void:null|evento, replacement/duplicate IDs. Cards rotulados como ativos e contagem histórica separada. Totais do servidor por filtro inteiro, nunca soma da página nem subtração local. O filtro de status precisa declarar se muda apenas rows ou também agregados; recomendar agregados gerais do filtro de conta/data/busca e contagens por status, rows filtráveis explicitamente. Dados de saldo congelados em AccountPeriodEvidencePanel/índice/export não devem ser recalculados nem substituídos pelo estado atual.

## Cache e consistência

Nova família proposta finance-movement-correction [tenant,actor,movementId]. Comando confirmado chama invalidateAccountReview(client,tenant), que já cobre abertura/período/fechamento/cash/B/carteiras/legado/custos, e invalida explicitamente famílias NÃO incluídas no helper atual: finance-movements, finance-audit, finance-movement-receipts, finance-options, finance-payable-options, finance-manual-expense-options, finance-receipt-movement-options, finance-reconciliation-options, finance-reconciliation-history, finance-automatic-reconciliation, finance-statement-lines e candidatos de acerto. Usar prefixos reais dos respectivos diálogos, inclusive finance-settlement-payment-candidates (SettlementPaymentWorkspace.tsx:19), finance-settlement-movements (SettlementMovementLink.tsx:37) e finance-settlement-expense-context (SettlementExpenseContext.tsx:19). Queries antigas de opções já abertas precisam ocultar dados/refazer revisão; invalidar cache sem bloquear revisão obsoleta não basta.

O helper também deve invalidar finance-movement-correction após criação de composição/conciliação/pagamento/fechamento, pois novos vínculos mudam elegibilidade. Invalidação de evidência histórica atualiza status de reabertura, nunca altera snapshot salvo. UI não substitui guards transacionais de escritores.

## Testes mínimos da entrega

1. Original manual livre: revisão obrigatória, soma ativa alterada pelo resultado servidor, original/autor/motivo continuam na lista; nenhuma chamada a recordFinanceMovement ou comando de pagamento/entrada compensatória.
2. Duplicidade500+500 com somente umregistro real: não escolher alvo automaticamente; fluxo remove apenas ID escolhido dos totais ativos, histórico continua2.
3. Movimentos derivados/transferência/origem desconhecida/conciliação histórica/pagamento/acerto/folha/fechamento: bloqueios por ID e nenhuma confirmação; operador só consulta quando can_executefalse; drivers e mistos negados.
4. Alteração de revision entre revisão e confirmação, erro de query após cache válido, saldo indeterminado: nunca confirmar com valores obsoletos nem mostrar zero.
5. Resposta perdida, remount, retry, rejeição conhecida após incerteza, corrupção, troca tenant/actor: mesmo pedido ou bloqueio seguro.
6. Lista>1000 e múltiplas páginas: totais ativos/históricos completos; filtro de direção/conta/data/status coerente; original cancelado não desaparece do histórico.
7. Substituição futura: um comando atômico, contas/dias antes/depois explícitos, apenas umnovoID após replay; comprovantes e evidências congeladas preservados.
8. Cache: mutação invalida opções/revisões; composição concorrente invalida prévia de correção. SQL precisa testar corrida/guards fora da UI, conforme documento-base.
