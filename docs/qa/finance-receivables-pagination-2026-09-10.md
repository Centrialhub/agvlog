# Paginação de contas a receber — 10/09/2026

Implementação local: migration `20260910154046_finance_receivables_paged_list.sql`, cliente e contrato `receivablesPage*`, página `Receivables.tsx`.

A consulta limita a resposta a 50 títulos, mas calcula as quantidades sobre todos os títulos correspondentes. Busca literal por descrição, número e cliente; filtros de cliente, status e vencimento são aplicados no servidor. Ordenação por criação e ID desempata datas iguais. Alterar filtros reinicia na primeira página. Indicadores usam o resumo independente da carteira completa; não somam a página visível. Falha de consulta aparece como indisponibilidade, sem mensagem de carteira vazia.

Verificação: quatro testes SQL PGlite e dois testes de tela passaram. Cobrem 1.005 títulos, páginas disjuntas e ordem repetível, busca literal, filtro de vencimento inclusivo, cliente da empresa, exclusão de títulos cancelados/vencendo hoje do filtro atrasados, rejeição de cliente externo e motorista com papel interno, mudança de filtro/página e falha de consulta. ESLint dos arquivos desta etapa passou. TSC integrado `tsconfig.app.json`, processo 73927, terminou com código zero.

Limites: ainda sem homologação em navegador ou teste nativo específico desta RPC. Paginação por offset não congela a carteira entre requisições concorrentes; novos títulos podem deslocar páginas. Contagens completas e busca textual podem exigir otimização medida em produção. Busca não remove acentos. O seletor de clientes mantém a fonte existente; sua paginação deve ser avaliada separadamente. Nenhuma migration remota foi aplicada nesta etapa.

Refinamento: a busca aguarda 300 ms sem digitação antes de consultar o servidor, usando o hook existente `useDebouncedValue`. Durante a espera a lista anterior fica oculta. Três testes de tela passaram, incluindo quatro alterações rápidas que resultam em uma única consulta final. ESLint passou novamente nos dois arquivos alterados.
