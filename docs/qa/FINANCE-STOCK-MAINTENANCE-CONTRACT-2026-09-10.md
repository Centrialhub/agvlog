# Estoque e manutenção: contrato mínimo para compra e consumo

Revisão somente leitura. Nenhum SQL ou fluxo operacional alterado. A proposta abaixo ainda não está implementada.

## Decisão recomendada

Manter o reconhecimento atualmente usado por recorded_costs: o custo canônico da aquisição entra uma vez, na sua data registrada. Ligar consumo à aquisição como **atribuição do custo já registrado à OS**, sem outra despesa, obrigação ou saída. Não apresentar essa atribuição como um segundo total somável ao custo de aquisição, nem como uma política contábil de valorização de estoque já implantada.

Reconhecimento por consumo, FIFO ou média ponderada exigiria uma decisão de produto e outro livro de valorização. O modelo atual não comprova nenhuma dessas políticas. A primeira entrega pode resolver rastreabilidade e dupla contagem sem presumir essa escolha.

## Evidência do código atual

| Evidência | Consequência |
|---|---|
| baseline.sql:3636 stock_items tem current_quantity/unit_cost e supplier textual | Não há lote de aquisição ou fornecedor identificado por ID |
| baseline.sql:3657 stock_movements tem tipo, quantidade, custos digitados e OS; não tem acquisition_id, documento, payable_id ou expense_id | Mesmo item, valor e data não provam de qual compra veio o consumo |
| baseline.sql:2445 maintenance_parts tem stock_movement_id e stock_item_id | Pode provar a ocorrência operacional por ID quando tenant/OS/item/quantidade são coerentes; não prova aquisição |
| useStock.tsx:95–117 insere movimento, lê saldo e atualiza em requisições distintas | current_quantity não é saldo financeiro confiável, sofre concorrência; erro da atualização não é propagado |
| useStock.tsx:105 usa positivo apenas inbound/return e negativo para todos os demais tipos | reserve, transfer e adjustment não têm semântica física suficientemente definida para derivar custo |
| Stock.tsx:88–95 calcula quantidade × custo informado no navegador | Valor do consumo não é custo de aquisição calculado no servidor |
| useStock.tsx:79 limita consulta a 500 movimentos | Não reutilizar lista da tela para disponibilidade ou totais financeiros |
| 52557 recorded_cost_summary soma itens canônicos, despesas manuais sem duplicar payable_id e remuneração | Acrescentar stock_movements ou maintenance_parts ao UNION duplicaria aquisições já registradas |
| 61702 já reserva finance_maintenance_cost_claims por cost_id para labor/direct_part | Aquisição de estoque deve compartilhar essa exclusividade; não pode reutilizar custo já atribuído integralmente a outra origem |
| Plano financeiro:462 distingue compra de consumo e proíbe novo contas a pagar no consumo | Associação deve preservar o payable e seus pagamentos existentes |

## Primeira entrega implementável

### Aquisição comprovada e integral

Nova associação `finance_stock_acquisition_links`: id, tenant_id, inbound_movement_id, stock_item_id, cost_id, supplier_id, quantity numeric, amount_cents bigint, source_snapshot, revision, actor_id/name, reason, request_id, created_at. Reversões append-only separadas.

Aceitar somente movement_type=inbound, reason=purchase explícito, data finita, quantidade positiva e finita, mesmo tenant/item, custo total integral em centavos. O alvo é finance_expense_items existente, com fornecedor ID do mesmo tenant e documento exibido para confirmação. Verificar payable por ID, vínculos/pagamentos/alocações e conflitos existentes. Quantidade e documento são conferidos pelo operador; igualdade numérica é compatibilidade, não prova automática. Não inferir fornecedor do texto stock_items.supplier.

Uma entrada integral por associação ativa e um alvo integral por origem ativa. Estender a reserva compartilhada de 61702 para source_kind=stock_acquisition com backfill e falha explícita se houver conflitos. Manutenção labor/direct_part e aquisição devem enxergar a reserva no helper de elegibilidade e na revisão, além da invariante DB.

RPC proposta `associate_finance_stock_acquisition(_payload)`:

```json
{"version":1,"tenant_id":"uuid","request_id":"uuid","inbound_movement_id":"uuid","cost_id":"uuid","revision":"hash","quantity":"10","document_number":"NF 123","same_purchase_confirmed":true,"reason":"motivo conferido"}
```

Resultado: version, tenant_id, request_id, link_id, inbound_movement_id, cost_id, confirmed=true, cash_changed=false, obligation_created=false, cost_created=false. Reversão `reverse_finance_stock_acquisition_association` recebe link_id/revision/reason; bloqueia enquanto existir consumo atribuído ativo, exigindo desfazer atribuições primeiro. Não estorna a compra.

### Consumo atribuído à aquisição

Nova associação `finance_stock_consumption_allocations`: id, tenant_id, acquisition_link_id, consumption_movement_id, maintenance_part_id, order_id, quantity, attributed_cents, source_snapshot, revision, actor_id/name, reason, request_id, created_at; reversões append-only próprias.

Primeira versão aceita uma aquisição por consumo integral. Movimento deve ser consumption, peça deve apontar para ele por stock_movement_id, e tenant/item/OS/quantidade devem coincidir. OS concluída, sem associação direct_part ativa. Outbound genérico, reserva, ajuste, retorno e transferência ficam diagnosticados para revisão; não transformar tipo ambíguo em consumo.

O operador escolhe acquisition_link_id por ID e confirma a origem. O servidor exige aquisição anterior ou na mesma data, mesma unidade/item e disponibilidade: soma de quantidades ativas <= quantidade adquirida e soma de centavos atribuídos <= valor adquirido. Não usar current_quantity. O valor proporcional é calculado como quantidade × amount_cents / quantity da aquisição; para esta primeira versão, fração de centavo exige revisão, sem arredondamento silencioso. O valor declarado da peça/movimento deve ser coerente; divergência não é sobrescrita.

RPC proposta `attribute_finance_stock_consumption(_payload)`:

```json
{"version":1,"tenant_id":"uuid","request_id":"uuid","maintenance_part_id":"uuid","consumption_movement_id":"uuid","acquisition_link_id":"uuid","revision":"hash","same_stock_origin_confirmed":true,"reason":"origem física conferida"}
```

Resultado inclui allocation_id, quantity, attributed_cents como strings, cost_created=false, obligation_created=false, cash_changed=false. Reversão desfaz apenas atribuição; nunca altera saldo físico, pagamento, compra ou movimento. Consumo de múltiplas aquisições exige linhas explícitas em versão posterior, não escolha heurística.

### Leituras, auditoria e isolamento

Contextos paginados por fonte, candidatos por IDs com issue e revisão combinada de origem/alvo/reservas/obrigações/pagamentos. Histórico independente da página de candidatos. Inventário inclui datas ausentes/infinito, órfãos e vínculos inconsistentes; não perde esses registros num filtro temporal.

Locks: autorização financeira; advisory finance do tenant; origens e alvos em ordem estável de IDs; reautorização após espera; revisão recalculada; replay estrito por ator/payload. Invariantes e restrições impedem dupla associação e sobreconsumo mesmo fora da RPC. Snapshots completos preservam fontes ao reverter. Guardar somente campos financeiros/identidade necessários enquanto ativos; notas operacionais continuam editáveis. Mutação de aquisição com consumo ativo exige reversão ordenada, sem apagar trilha.

Eventos manuais permanentes com ator/tempo/motivo/declarações. Motoristas e perfil misto são excluídos por can_access. Associação não é conciliação bancária. Não modificar closures nem extrato para atribuir consumo de uma compra já registrada.

## Exemplo e aceitação

Compra de 10 filtros por R$ 1.000 já em item canônico e payable. Entrada de estoque é associada integralmente. Consumo de 2 filtros na OS A atribui R$ 200; outro de 3 na OS B atribui R$ 300. Resumo de custos registrados continua R$ 1.000, saldo de atribuição é 5 filtros/R$ 500. Visão das OS mostra R$ 200 e R$ 300 como composição da aquisição, não R$ 1.500 de custo total. Pagar o fornecedor não acrescenta custo.

Testes necessários: replay; disputa mesma entrada/alvo; labor/direct_part contra acquisition nas duas ordens; dois consumos excedendo quantidade; fonte alterada durante espera; revogação; tenant/motorista; reversão com dependentes; valor proporcional fracionário; compras/consumos em meses distintos; mais de 1000 fontes; compra paga preservada; período bancário fechado preservado. Verificar IDs e contagens de movimentos/payables/payments antes/depois, não apenas retorno cash_changed.

## Limitações explícitas

### Parcial, devolução e correção

Consumo parcial da aquisição é permitido (2 de 10 unidades); cada movimento de consumo é atribuído integralmente na primeira versão. Fracionar uma mesma saída física entre aquisições ainda não é permitido. Reverter atribuição por erro não significa devolver a peça ao estoque. Devolução física necessita movimento próprio ligado explicitamente ao consumo original, com quantidade e motivo; enquanto não houver esse comando dedicado, retorno/ajuste relacionado torna a composição pendente de revisão e não libera automaticamente capacidade da aquisição. Devolução ao fornecedor também não é reversão da associação: exige relação própria com aquisição e documento/devolução financeira, sem apagar payable ou pagamento original.

Para correção, reverter primeiro atribuições dependentes, depois associação da aquisição, corrigir fonte operacional pelo fluxo permitido e revisar novamente com nova revisão. Snapshots históricos são imutáveis. Se um novo movimento relacionado por item/OS aparecer sem identidade exata suficiente para saber se é devolução, marcar revisão; não compensar por valor, sinal ou data.

Guards de UPDATE/DELETE precisam resolver e bloquear referências do OLD, antes de considerar NEW; mudar tenant_id, stock_item_id, maintenance_order_id ou stock_movement_id não pode escapar pela nova identidade. Quando ambos os tenants/contextos forem alcançados, adquirir suas travas em ordem determinística e validar os dois lados. INSERT de parte ou movimento que introduza conflito com uma associação ativa deve ser diagnosticado/impedido; não proteger apenas alterações da linha originalmente associada. Reserva compartilhada exige unicidade por tenant/cost_id e por tenant/source_kind/source_id, release somente por reversão auditada e integração de elegibilidade/revisão nas três famílias.

Não corrige o escritor físico não atômico, não certifica saldo de estoque, não determina custo médio/FIFO, não distribui tributos/frete/descontos da compra, não adota saldo inicial desconhecido, não suporta múltiplas aquisições por consumo nesta versão. Fontes sem aquisição demonstrável permanecem pendência com valor não incorporado, sem inventar compra ou custo zero. Para reconhecer custo somente no consumo, será necessário reclassificar aquisição como ativo e alterar simultaneamente recorded_costs e summary; isso não pode ser disfarçado como simples associação.
