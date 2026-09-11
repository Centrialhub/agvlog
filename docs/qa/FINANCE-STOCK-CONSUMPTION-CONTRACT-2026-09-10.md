# Consumo de estoque por aquisições explícitas

Proposta para revisão antes da implementação. Não altera 70454 em validação nativa.

## Comando e identidade

`attribute_finance_stock_consumption(_payload)` recebe version=1, tenant_id, request_id, maintenance_part_id, consumption_movement_id, revision, reason e same_stock_origin_confirmed=true, mais `lines:[{acquisition_link_id,quantity}]`. Quantidades são strings decimais positivas, IDs não se repetem. O servidor ordena linhas por acquisition_link_id para cálculo/snapshot estáveis. Nenhuma escolha automática de lote por valor/data/FIFO.

Peça e movimento devem identificar exatamente o mesmo consumo: tenant, item, OS, quantidade e tipo consumption. A soma de quantidades das linhas deve ser exatamente a quantidade consumida. Aquisições ativas do mesmo item/unidade, com data anterior ou igual ao consumo. Fontes incompletas aparecem como diagnóstico; não inventar aquisição ou valor zero para suprir ausência de origem.

Preview dedicado recebe os IDs/quantidades selecionados e retorna revisão combinada das fontes, aquisições, reservas e saldo disponível, valores derivados por linha, total e eventual divergência dos custos operacionais digitados. Consumo normal com valor digitado arredondado não deve exigir igualdade impossível com proporção fracionária: o operador confirma a atribuição derivada e reconhece a divergência explicitamente no payload quando houver. Não sobrescrever os valores operacionais. Identidade/quantidade errada continuam bloqueando.

## Centavos conservados sem reescrever história

Política explícita `remaining_balance_floor_v1`, para atribuição gerencial de compra já reconhecida; não é FIFO, média ponderada ou valorização contábil de estoque.

Para cada aquisição, sob trava, calcular quantidade disponível Q e centavos disponíveis C a partir da aquisição menos linhas ativas. Uma linha de quantidade q recebe `floor(q*C/Q)` centavos; se q=Q recebe C integral. Numeric exato no banco, sem Number no cliente. C pode ser zero com Q positivo; a atribuição física permanece válida com zero centavos. Aquisição continua com valor positivo. Rejeitar Q insuficiente ou C negativo como inconsistência.

Exemplo compra de 1 centavo/3 unidades, consumos unitários: primeiro 0, segundo 0, último 1 centavo. O preview mostra a política/resíduo; não há arredondamento oculto nem bloqueio da rotina por fração de centavo. Reverter a segunda linha devolve exatamente 1 unidade e 0 centavos. A próxima atribuição dessa unidade vale 0; a terceira original continua valendo 1. Reverter a terceira devolve 1 unidade/1 centavo. Nenhuma atribuição anterior é recalculada.

Exemplo 10 filtros/R$ 1.000: consumo de 2 recebe R$ 200; consumo de 3 recebe R$ 300; ficam 5/R$ 500. Consumo de 4 unidades usando aquisições A e B recebe duas linhas explícitas, por exemplo A:1 e B:3. Cada linha calcula seu saldo próprio. O total global continua sendo a compra já registrada; nenhuma linha entra de novo no UNION de recorded_costs/summary.

## Persistência, reserva e reversão

Cabeçalho append-only `finance_stock_consumption_attributions` com tenant, part_id, consumption_movement_id, order_id, revision, policy, source_snapshot, actor/id/name, reason, request_id, created_at. Linhas append-only `finance_stock_consumption_lines` com attribution_id, acquisition_link_id, quantity, amount_cents>=0, available_quantity_before, available_cents_before e cálculo/ordem. Uma atribuição ativa por parte e por movimento. Novos registros não criam expense, payable, payment, finance_movement ou stock_movement.

Reservar cada linha no registro finance_stock_acquisition_dependencies com source_kind='consumption_line', source_id=line.id; ampliar seu check de amount_cents para >=0 em nova migration. A unicidade já inclui acquisition_link_id, permitindo várias aquisições no mesmo consumo. A reserva de quantidade/centavos e o cabeçalho/linhas/evento/command são atômicos.

`reverse_finance_stock_consumption_attribution` recebe tenant/request/attribution_id/revision/reason. Primeira versão reverte a atribuição inteira, liberando exatamente cada reserva pela linha correspondente. Criar evento de reversão append-only e liberação privada verificada por IDs, mesma quantidade/centavos e evento persistido; nunca apagar linhas históricas. Remover a reserva materializada é permitido apenas como efeito dessa reversão auditada, com trigger DB verificando a reversão real, sem GUC ou declaração do cliente como bypass. Reversão da aquisição continua bloqueada enquanto houver qualquer linha ativa.

Correção de rateio: reverter a atribuição inteira e registrar nova seleção com revisão atual. Não alterar consumo físico nem devolver material automaticamente. Devolução física é um fato separado, ainda exige identificação explícita do movimento de retorno; reversão da atribuição não declara que houve retorno.

## Locks e provas de aceitação

finance advisory → catálogo/item → origem peça/movimento/OS em ordem estável → aquisições em UUID ordenado → dependências. Reautorizar após espera; comparar revisão depois de todos os locks. Guards OLD/NEW não permitem trocar tenant/item/OS para escapar. Imutabilidade das fontes financeiras ativas; notas operacionais livres. Replay mantém ator/payload estritos.

Testar: 1cent/3un e reversão intermediária/última; consumo parcial 2+3; duas aquisições na mesma saída; decimal de quantidade; duas requisições consumindo saldo restante; reversão contra aquisição e novo consumo; mesma parte/movimento com duas chaves; stale saldo após preview; revogação; perfil misto; rollback integral se segunda linha falhar; manutenção direct_part ativa conflitando com consumo; preservação de compra/payable/pagamentos e caixa fechado; total canônico inalterado; histórico de fontes e política visível. Nenhuma cobertura de estoque completo será alegada enquanto saldo inicial/devoluções não identificadas e fontes órfãs continuarem pendentes.
