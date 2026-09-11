# Correção auditada da descarga: proposta executável — 2026-09-10

## Evidência e dependências atuais

`212514_finance_delivery_unloading`: uma charge imutável por `(tenant_id,delivery_stop_id)` e um receivable exclusivo; source_snapshot preserva entrega, documentos e fornecedor. Reentrega resolve a raiz histórica. `record_unloading` cria título e charge no mesmo comando. O fornecedor da cobrança não é necessariamente o beneficiário da despesa.

`213959_finance_expense_batches`: expense_item.unloading_id exclusivo; categoria unloading chama o writer da cobrança, cria custo integral e, se não inteiramente alocado, payable pelo complemento. Beneficiário pode ser motorista ou fornecedor do gasto. Alterar cobrança não prova alteração do custo nem da dívida ao motorista. `134948_finance_canonical_trip_cost_settlement` incorpora o custo e unloading_id no snapshot do acerto; `134943` verifica composição/complemento. Folha e acertos posteriores podem consumir esse snapshot. `175641` já recusa cancelar custo unloading sem resolução específica.

Recebimentos estão em receivables_payments, comandos financeiros, links de entrada e bank_transactions; devolução tem comando/link/transação próprios, correção de alocação e créditos são eventos diferentes. Histórico continua existindo após devolução/correção. `205941` protege origem e nova baixa; `210433` sinaliza incompatibilidade sem transformar problema de origem em reconciliação.

Carteira/snapshot atuais usam título corrente; histórico195941 captura alterações, mas não prova posição econômica nem ordem de commit. Fluxo203516 atribui charge/receipts/refunds ao fornecedor preservado e valida antes_snapshot do comando contra a charge original. Uma versão nova não pode simplesmente substituir essa origem em todos os joins: atribuiria pagamento passado ao fornecedor novo. Fechamentos preservam fatos bancários e dependências; correção de cobrança sem dinheiro não pode reescrever snapshot bancário nem alegar mudança de caixa.

## Duas operações diferentes

1. `repair_projection`: restaura client_id/amount e vínculos indevidos do título para a origem efetiva já comprovada. Não altera a cobrança nem seu fornecedor/valor econômico. Primeiro incremento pode ser completo para títulos sem QUALQUER payment/reversal/credit/correction/fiscal/closing/materialização financeira. Custo ligado pode permanecer porque não se altera a origem; dependências de acerto devem provar que nenhum snapshot guarda o título divergente. Não reativar cancelled/invoiced por inferência: estado legítimo precisa ser derivado e aprovado no contexto. Origem incompatível nos documentos atuais não é automaticamente nova verdade.

2. `amend_origin` / `cancel_origin`: muda o direito de cobrar ou o cancela. Deve acrescentar versão da MESMA charge, sem inserir outra charge nem remover a restrição por entrega. Primeiro writer pode operar sem histórico de recebimento/materializações protegidas; casos pagos continuam bloqueados por IDs e terão procedimento próprio de devolução/compensação, nunca trocar payer do pagamento antigo. Custo/pagável já registrado não é cancelado por tabela: contexto exige declarar se a mudança é apenas do direito de cobrança. Se a correção também pretende mudar o gasto ou reembolso do motorista, precisa comando coordenado específico e ainda não está elegível.

## Modelo mínimo

Tabela append-only `finance_unloading_amendments`: id,tenant_id,charge_id,previous_amendment_id,request_id,operation,revision_before,old_effective_snapshot,new_effective_snapshot,effective_on,captured_at,actor_id/name,reason,evidence. Unicidade de sucessor por versão inicial/antecessor e finance lock impedem bifurcação. Original permanece intacto. Helper único `unloading_effective_origin` resolve versão vigente e valida cadeia; cancelado nunca libera record_unloading para criar segunda charge da mesma entrega.

Comando proposto `correct_finance_unloading({version,tenant_id,request_id,charge_id,revision,operation,supplier_id?,amount_cents?,effective_on,reason,evidence_ids,correction_scope_confirmed})`. Preview traz original/efetivo/proposto, título, custo e dívida separadamente, blockers com IDs, pagamentos históricos e efeitos explícitos. Fornecedor escolhido por ID e documento, nunca por texto/valor. `repair_projection` não aceita valores novos livres. `cancel_origin` mantém custo/dívida inalterados e exige confirmação específica desse escopo; não finge que despesa foi desfeita.

Ordens: fiscal→finance→charge→título/grafo→custos/pagáveis/acertos em IDs estáveis; reauth após espera, replay após reauth, revision de todas dependências, assert_closed_source_mutable sobre OLD/NEW e registro de dependências quando exigido. Exceção ao205941 somente por ticket privado transacional do comando, aprovado pelo mesmo contexto e inserção do evento, nunca GUC/role admin. Guards de novas dependências mantêm origem cancelada inelegível.

## Integrações obrigatórias ANTES do writer

- Resolver efetivo compartilhado por205941/210433, record_unloading/replay e novos pagamentos; guard também valida ticket de correção e efeito exato no título. Nenhum UPDATE na charge original.
- Snapshot/carteira exibem estado efetivo e cancelamento auditado; histórico195941 permanece integral. Preview não oferece reconciliação como reparo.
- Fluxo203516 precisa modelar eventos de alteração/cancelamento separadamente: charge original permanece no seu dia/fornecedor; delta explícito na data econômica da correção (redução/cancelamento e nova obrigação por fornecedor quando trocado), sem modificar recibos/devoluções passados. Novo contrato deve permitir valores de ajuste com sinal e mostrar bruto original/ajustes/líquido, não sobrescrever amount de janeiro ao consultar depois. Não chamar isso posição as_of. `repair_projection` é informativo, sem novo valor econômico.
- Expense history exibe versões da cobrança por unloading_id sem trocar custo histórico. recorded_costs/summary e payable permanecem inalterados quando escopo é só cobrança; se custo também errado, bloquear e exigir resolução coordenada de175641/folha/acerto/claims.
- Grafo190516, audit manual, armazenamento/retention de evidências, registro de dependências/corte e revisões devem incluir amendment IDs. Não invalidar saldo bancário só por ajuste de cobrança; bloquear quando OLD/NEW atingem dependência congelada ou materialização financeira que precisa ser reparada.
- UI/contexto/paginação/histórico devem distinguir versão vigente, original e efeitos custo/obrigação/dinheiro; nenhuma segunda charge via tela de lançamento.

## Aceite mínimo

Reparo150/origem A versus título errado B sem pagamentos restaura A e recebe normalmente; não cria charge/custo/payable/movement adicional. Alteração real150→120 preserva original150, evento-30 e título120, sem alterar custo150 se confirmado apenas direito de cobrança. Cancelamento mantém original e custo, obrigação a receber cancelada auditadamente e nova charge da mesma entrega negada. Fornecedor A→B preserva evento original A e ajustes A/B; nenhum pagamento A é reatribuído. Qualquer histórico pago, fiscal, crédito, correção ou acerto materializado não resolvido bloqueia atomicamente. Reauth/replay/disputas/rollbackaudit/tenant/mixeddriver/fechado e aberto precisam testes reais antes promoção.

Esta rodada é análise somente. Recomendo começar por repair_projection sem histórico pago, depois alteração/cancelamento do direito de cobrança com contrato de ajustes pronto; casos com dinheiro não se tornam resolvidos por essa primeira entrega.

## Complemento de escopo integral

Quando fornecedor/valor errado descreve o próprio gasto (e não só seu direito de recuperação), a operação deve versionar conjuntamente origem da descarga, efeito ativo do custo, obrigação exata e recebível na mesma transação. Preserve item/payable originais com evento de substituição/cancelamento, visão ativa única e vínculo explícito ao sucessor, sem usar record_expense_batch para gerar segunda charge. A composição de acerto/folha precisa ser refeita por comando canônico ou bloquear se já materializada/protegida; pagamentos existentes exigem regularização por eventos reais, não saldo líquido zero. Esse caminho integral é requisito restante: o recorte repair_projection não o substitui. Na primeira reparação autorizável, limitar campos a supplier/client e amount originais; vínculos fiscais indevidos/statuscancelled exigem resolução própria comprovada em vez de apagá-los incidentalmente.
