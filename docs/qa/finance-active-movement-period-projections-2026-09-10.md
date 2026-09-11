# Movimentos ativos na abertura e no período

183438 altera as definições atuais de account_opening, account_period_review e snapshots de fechamento bancário/caixa. A abertura contábil do corte considera apenas movimentos ativos anteriores; entradas/saídas do próprio período também excluem invalidações. Referências históricas a grupos e transferências permanecem disponíveis para evidência e diagnóstico, sem substituição textual global de toda fonte raw.

As novas prévias preservam facts.movement_voids e facts.voided_movements, inclusive correções anteriores ao início do corte que podem afetar a posição inicial. Facts.movements representa os movimentos ativos do período. O manifesto inclui eventos e originais invalidados com papel composition_snapshot, sem tratá-los como dinheiro adicional. Correções que se compensam em saldo ainda alteram a revisão e a composição preservada.

Quatro testes PGlite passaram com comandos reais de registro, abertura/contagem de caixa, revisão de origens, fechamento e reabertura. Cobrem saída duplicada excluída do período, posição antes/dentro do corte, duas correções de sinais opostos que alteram revisão mesmo com saldo líquido zero, persistência de evidência/manifesto e snapshot inalterado após reabertura. O reader real confirma integridade e o índice da interface mostra autoria/motivo da invalidação. ESLint aprovado.

A factory desta rodada também instala a API real de candidatos14238 e a migração183442. Um caso conjunto cria conciliação manual real e depois injeta deliberadamente invalidação inconsistente pelo owner: o extrato permanece com a saída, o livro ativo fica divergente, a conciliação exige revisão e o fechamento continua bloqueado. Isso verifica que remover uma representação não apaga evidência bancária nem faz a divergência desaparecer. A futura operação deve rejeitar essa dependência antes de permitir a invalidação; o caso não autoriza invalidar movimentos conciliados.

As invalidações são inseridas pelo owner da fixture e não por comando público, ainda inexistente. Estes testes validam as projeções após uma invalidação armazenada; não provam elegibilidade, concorrência ou autorização da futura operação que invalida. Ainda faltam migração de consumidores restantes e guardas do próprio INSERT de invalidação. Nenhum snapshot já salvo é reescrito pela migração.

SHA256183438 conferido: `0eb73159b24bf1afd731e24aa4153db833cdef03bd5612e4249e856f2fbccc0f`. Ensaio nativo integrado e aplicação remota não realizados nesta etapa.
