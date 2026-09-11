# Navegação de folhas extensas — 11/09/2026

Implementação local em main, ainda não publicada nesta rodada. PeriodEntries mostra até 50 funcionários por página e busca por nome, identificação, departamento ou filial, com filtro da situação de pagamento. Os totais, aprovação e fechamento continuam relativos à folha inteira; a interface declara esse alcance. Troca de empresa/período reinicia filtros; redução da lista mantém página válida. Abertura do funcionário usa botão acessível por teclado.

Validação: financePayrollScreen, 4 testes passaram, incluindo 125 funcionários, busca de registro fora da página visível, totais integrais após filtro, abertura da identidade correta e troca de período. ESLint dos dois arquivos passou; diff --check passou.

Limite: paginação de apresentação. A RPC ainda retorna a projeção completa; isto reduz linhas renderizadas, não reduz volume transferido nem comprova desempenho de consulta em grandes bases. Não houve lançamento real nem nova emissão fiscal. Publicação e teste autenticado permanecem pendentes.
