# Suplemento nativo: contenção140248

Resultado final:2casos passaram, sessão93144 exit0, PostgreSQL17.11 parado. SQL de reentrega original b39c73e86ed3881957b804e5ee5d39e774eeae9f5a425c4ff21402c4922f5987; contenção893b0342c185037306c474ac4a45419bead7e086b373cbd7f40c2215b2df9744; runner de casos b494f67d5a6f8a41315b11ed98d12730b18a0add40360cb07562b9512e49d9d9.

Cenário: uma reentrega confirmada e um segundo documento com devolução registrada por comando real antes da pausa. O SQL de contenção integral passou seus próprios guards e manteve hash de documentos, itens, alocações, tentativas, eventos, acertos, pagamentos e pedidos. Replay do primeiro comando devolveu resposta idêntica. Um novo pedido com revisão válida falhou55000 redelivery_temporarily_paused_preserve_request e o mesmo hash permaneceu intacto. O leitor operacional continuou mostrando a primeira tentativa histórica.

Após a contenção, a tentativa previamente criada foi reanexada, planejada, iniciada e entregue por comandos reais. O builder manteve a primeira perna com frete125 e a segunda com0/needs_recalculation/redelivery_pricing_review; não surgiram pagamentos. Nenhum writer antigo foi restaurado, nenhum dado real foi revertido.

Primeiro suplemento56689 falhou por coluna key inexistente no snapshot do teste. O erro foi corrigido somente no harness usando ordem por JSON integral; a parada desse servidor foi confirmada antes de93144. O log inicial está preservado. Nenhum SQL de produto foi modificado por essa falha.

Execução local: PG_QA_SUITE=redelivery-release e REDELIVERY_CONTAINMENT=1 com scripts/test-delivery-concurrency.mjs. O modo suplementar não repete os8casos do ensaio anterior. Limites de Auth/Storage e chegada preparada são os mesmos de redelivery-release-native-2026-09-10.md. Não é ensaio sobre dados de produção e não comprova autorização de deployment. Tempo de benchmark não foi instrumentado; logs, sessões e exitcodes são as evidências de execução.
