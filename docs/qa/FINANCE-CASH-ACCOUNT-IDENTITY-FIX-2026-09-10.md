# Identidade bancária não identifica caixas físicos

Native reproduziu finance_closed_account_identity_conflict ao criar segundo caixa depois de fechar o primeiro, porque63109 comparava banco/agência/conta vazios (ou campos herdados idênticos) como se fossem identidade bancária de cash.

Correção em nova migration20260910175310_finance_cash_account_identity_scope.sql, hash `0de48bf482ee3bed0aa4e8985b43382822a37e946f807bdfcb38d8fe89b5cc63`. O CLI gerou este timestamp posterior; não foi criado arquivo74822 manualmente.

Comparação com outra conta fechada agora exclui cash de ambos os lados. Conta sem tipo definido permanece sob comparação conservadora. Guarda da própria conta fechada continua antes dessa comparação: mudar tipo/identidade, transferir tenant ou apagar o caixa fechado permanece proibido. Nenhuma mudança em73906/63109/72624 congeladas.

3 testes PGlite próprios e ESLint passaram: segundo caixa com mesmos campos bancários herdados; caixa após banco fechado enquanto banco duplicado continua recusado; alteração/remoção da própria conta cash fechada recusada. Fixture histórica com ticket testa a guarda de identidade, sem alegar nova prova de workflow positivo. Nativecash completo será repetido pelo agente de banco criando caixas depois dos fechamentos, sem contornar o bug pela ordem da fixture.
