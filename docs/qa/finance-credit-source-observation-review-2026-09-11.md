# Revisão independente da identidade do crédito

O teste `src/test/customerCreditSourceObservationReview.test.ts` passou (1 caso, PGlite) e o lint encerrou sem erros. A fixture instala definições reais capturadas e os comandos fiscais/financeiros reais anteriores à candidata 01312. Não houve execução remota, emissão fiscal externa nem PostgreSQL nativo.

O cenário autoriza um documento fiscal da fixture, recebe dinheiro pelo comando canônico, processa seu cancelamento e obtém o crédito. Uma segunda observação real da mesma emissão cancelada, criada ao alterar a versão do documento no registro da fixture, também é processada. A prova do crédito continua válida, a linha original do crédito permanece idêntica e existe somente uma transação bancária. Entretanto, `source_revision` muda porque a prova inclui o estado atual da origem fiscal.

Consequência para 01312: aplicações não podem exigir igualdade eterna desse fingerprint mutável. A identidade imutável da fonte precisa de vínculo separado; a revisão corrente deve continuar participando da posição/prévia para detectar consultas desatualizadas. O agente proprietário do núcleo confirmou a correção por `binding_revision`, sem alterar o leitor original 82303.

A evidência prova o problema do predecessor, não a correção final de 01312. Ainda são necessárias as provas integradas de aplicação, recebimento/estorno de dinheiro, liberação no cancelamento fiscal/fatura e concorrência antes da promoção.

## Aplicação e estorno de dinheiro

`src/test/customerCreditCashReversalReview.test.ts`: 1 PASS às 07:34:33, com 01312 candidata instalada integralmente; lint sem erros. Administrador real na fixture aplica crédito40 a título50, recebe10 pelo comando financeiro canônico e devolve somente10 por estorno canônico. O título termina com dinheiro0, crédito40, liquidado40, aberto10 e sem nova possibilidade de estorno monetário. A aplicação do crédito fica byte-equivalente, disponível da fonte permanece60, e há exatamente três transações: recebimento original100, novo recebimento10 e devolução10. Não há crédito ou movimento fictício.

Durante evolução do candidato, o ensaio reproduziu ambiguidade SQLSTATE42702 nas novas subqueries do processador fiscal; o proprietário corrigiu os aliases e o caso passou sem alterar o núcleo neste trabalho. As primeiras falhas do próprio teste foram corrigidas usando administrador exigido pela ACL real de estorno e o nome real transaction_type da coluna bancária. Nenhum guarda foi desabilitado. Esta prova é PGlite, não concorrência nativa nem acesso por fronteira pública de crédito ainda inexistente.
