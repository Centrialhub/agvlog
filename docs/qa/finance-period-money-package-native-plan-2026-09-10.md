# Plano de suplemento nativo — pacote monetário do período — 10/09/2026

Pré-revisão enquanto193723 ainda está sendo escrita. PostgreSQL parado; nenhum ensaio realizado ou hash congelado nesta etapa.

## Evidências que o produtor deve respeitar

Snapshots bancários62958 e de caixa73906 representam conceitos diferentes de prova. Banco congela conciliação/extrato; caixa congela contagem e diferença. Ambos conservam `balances.opening_cents`, `in_cents`, `out_cents`, `closing_cents` e `facts.movements` do intervalo. Cash também conserva `counted_closing_cents`, `expected_closing_cents`, `difference_cents`.

A lista de transferências não é o conjunto de dinheiro do pacote: no snapshot bancário, facts.transfers inclui referências por perna ocorrida atéto, inclusive antesdefrom; no caixa, a seleção é pelo intervalo. A mesma transferência pode aparecer nos snapshots de ambas as contas. Eliminação exige exatamente ambas as pernas no conjunto monetário selecionado, mesma transferência/tenant, contas distintas e valores/sentidos coerentes. Não inferir pareamento por valor/data/texto.

## Matriz executável proposta

1. Duas closures reais contíguas da mesma conta: pacote exato com abertura da primeira, fechamento da última e soma dos fluxos de ambas; nunca soma mensal de aberturas.
2. Corte solicitado atravessa parcialmente uma closure: recusar cobertura exata, sem ratear snapshot ou consultar dinheiro atual para fabricar fatia.
3. Lacuna de um dia, fechamento reaberto, predecessor errado ou saldo inicial da segunda diferente do final da primeira: identificar conta/closure, bloquear total consolidado integral, preservar valores comprovados das contas elegíveis.
4. Banco+caixa com comandos de transferência reais, closures e snapshots reais: bruto preserva ambas as pernas; somente total ajustado elimina transferência interna porID, uma única vez. Saldo consolidado permanece igual.
5. Transferência com apenas uma conta no escopo, perna fora do corte ou chegada no mês seguinte: fluxo de fronteira/emtrânsito, sem eliminação indevida.
6. Transferências históricas presentes em facts.transfers mas ausentes em facts.movements selecionados: zero eliminação. MesmoID repetido com conteúdo divergente: classificação/ajustados indisponíveis, sem apagar soma bancária bruta comprovada.
7. Mistura banco/cash: evidence_type explícito; contar zero de caixa como zero, nunca como ausência. Divergência de contagem bloqueia a própria closure real, não cria lançamento compensatório.
8. Snapshot corrompido ou dependências relacionais divergentes do snapshot: marcar integridade inválida. Mudança de nome da conta atual não reescreve snapshot histórico; contexto atual deve ser separado.
9. Datas/SP, conta estrangeira/motorista misto, IDs repetidos de conta/closure e revisão mudando após reabertura: schemas reais e hash determinístico, sem captured_at no hash.
10. Mais de1000movimentos selecionados: nenhum corte silencioso de fonte. Páginas de detalhe, se existentes, referenciam a mesma revisão do agregado integral.

## Estratégia de fixture

Reutilizar `accountPeriodCloseDatabase`/`cashPeriodCloseDatabase` e builders nativos existentes, com comandos reais de abertura, lançamento, transferência, revisão e fechamento. Para bancos, bytes de extrato sintéticos devem passar pelo parser/worker real quando viável; declarar os limites da fonte sintética. Fixtures históricas/corrompidas servem exclusivamente a testes negativos de integridade, nunca como principal prova positiva. Não substituir guards/coverage por funções que retornam sucesso.

A execução aguardará SQL/contrato/hash finais. Esta matriz não afirma que193723 já atende os casos.

## Revisão estática do corpo inicial193723

Achados enviados ao autor/coordenador antes do congelamento:

- Arrays de classificação `facts.transfers`/`transfer_departures` com JSONnull ou tipo não-array provocam erro em jsonb_array_elements; precisam diagnóstico separado para não derrubar totaismonetários válidos.
- Partida precisa rejeitar destino igual à conta da perna de saída.
- Natureza ausente/desconhecida no manifesto não pode ser implicitamente classificada como não-transferência; isso deve invalidar somente classificação se os fatos monetários estiverem íntegros.
- Pares com perna ausente produzem amount/conta/dia null; o contrato precisa aceitar incerteza nessas linhas ou usar diagnóstico separado, sem inventar valores.

O root também encontrou e enviou validação de UUID/data/sentido, nome nulo, comparação entre perna raw e congelada, e void de partida. Estes são achados do corpo em implementação, não afirmação de falha após correções futuras. Nenhum teste executado nesta revisão.
