# Revisão independente dos leitores de previsão — 2026-09-11

Escopo: leitura das migrations84626 e85621 e testes independentes. Nenhuma edição nas migrations do root, nenhum acesso remoto e nenhum PostgreSQL nativo.

O achado anterior de ausência de reautorização final foi retirado: `record_cash_forecast_snapshot` chama `read_cash_forecast_snapshot` após inserir captura/evento/pedido, e esse leitor começa com `require_access`. O replay usa a mesma leitura. A proteção já estava implementada transitivamente.

O achado de paginação histórica sem revisão obrigatória a partir da página2 foi corrigido pelo root em84626 e coberto por sua suíte. O leitor de fontes85621 exige revisão válida em todas as páginas. A leitura histórica mantém conteúdo e revisão originais, enquanto o envelope da página informa o ator atual; o resumo distingue autor histórico e `viewer_actor_id`.

`src/test/cashForecastReadersIndependent.test.ts`: 2 PASS em aproximadamente3s; ESLint0. Teste1 cria32 títulos, captura original, lê30+2 sem duplicação e verifica leitura por segundo operador autorizado: autor histórico preservado, viewer atual correto, revisão live do outro ator rejeitada e alteração posterior do título invalida somente leitura live. Teste2 nega empresa alheia, período diferente da captura e leitura após o ator se tornar motorista misto.

Nenhum novo defeito reproduzido nos leitores atuais. Os testes invocam corpos privados com identidade real da fixture; não afirmam existência de grants ou wrappers públicos, que ainda são promoção separada. Dependem da fixture monetária do coletor, com seus limites de plataforma já documentados.
