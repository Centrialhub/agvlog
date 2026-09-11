# Revisão independente do snapshot de fechamento e classificador

Escopo: leitura de 62958 contra foundation 62807, guardas 63109 e classificador 63116 em desenvolvimento. Sem edição dos arquivos do produtor/classificador ou da fixture compartilhada.

## Achados transmitidos aos responsáveis

1. **Correção de alocação de recebimento não entra no manifesto.** 63116 enumera recibos e links, mas não `finance_receipt_allocation_corrections`. O comando 025658 libera capacidade da entrada sem devolver dinheiro. Se a mesma entrada é realocada a outro título, o classificador encontra o recibo antigo e o novo, ambos como `exact_canonical_mapping`, e soma a mesma capacidade novamente. Resultado: `legacy_mapping_capacity_exceeded` em um fluxo válido. A origem corrigida e sua projeção bancária precisam de classificação explícita de correção sem dinheiro/reserva adicional; o evento deve participar da revisão. Relatado ao root e ao autor B para reprodução e correção.

2. **Reversão canônica de baixa de pagável precisa de semântica diferente da reversão de adoção antiga.** A visão vigente `active_payable_payments` exclui baixa canônica revertida, enquanto reversão de vínculo `legacy_adoption` preserva pagamento antigo real. O laço atual de B filtra links revertidos e deixa ambas as fontes como não resolvidas. Depois de corrigir uma baixa canônica e associar corretamente a mesma saída, o pagamento canônico antigo não deve bloquear como dinheiro desconhecido; já o legado desassociado continua exigindo associação. Não resolver por valor/data nem apagar história.

Esses achados são limitações de classificação de fontes, não licença para ignorar seus IDs ou liberar capacidade indiscriminadamente. Foram detectados por rastreamento de código; a reprodução integrada ficou com o autor do classificador.

## Compatibilidades conferidas

- O snapshot separa saldos/entradas/saídas do banco e razão, usa diferenças brutas, exige cobertura atual e não usa `can_close=false` dos diagnósticos como predicado permanente.
- Dependências incluem IDs de movimentos, grupos/reversões, imports/linhas/verificações/identidade, abertura, aprovação de cobertura, predecessor e revisão do corte. O guard de chegada de transferência encontra `finance_transfer_departures` nesse conjunto; papel composition_snapshot preserva a posição histórica sem impedir chegada posterior permitida.
- Reabertura usa a revisão do fechamento, não depende de conseguir uma prévia elegível sobre período já fechado. Snapshot anterior permanece imutável.
- Recebimento e devolução são duas pernas de dinheiro, não liberação da capacidade da entrada original. O escritor atual 024438 exige mesma conta bancária do recibo para a devolução; não foi apontado suporte fictício a refund de outra conta.
- Remuneração, despesas, manutenção e obrigações abertas não entram como caixa. Fontes históricas ainda não classificadas com linhas presentes permanecem bloqueadores explícitos; conta vazia não deve ficar bloqueada apenas pela existência dessas funcionalidades.

## Refinamentos recomendados

- Revalidar explicitamente `legacy.blockers` vazio no predicado 62958, além de approved/current. Hoje B já deriva approved dessa condição, mas o contrato deve falhar fechado se um produtor futuro retornar combinação inconsistente.
- O manifesto mantém evidência completa de toda a empresa, inclusive outras contas/datas. Isso preserva informação, mas qualquer transação futura pode invalidar uma revisão de corte sem alterar seus fatos relevantes. É conservador e pode gerar muita repetição em alto volume; estreitar dependências exige preservar fontes desconhecidas e cadeia de IDs, não reduzir à página corrente.
- A posição de transferência está guardada por fatos completos no snapshot. Interfaces devem derivar a posição **no corte**, sem tratar um pareamento conhecido hoje com chegada posterior como dinheiro já recebido na data do fechamento.

Não foi afirmado fechamento pronto ou homologação de banco completo nesta revisão. O caso positivo real e a concorrência permanecem verificação obrigatória da integração.
