# Correção da importação de 337 XMLs

Preparada sobre a `main` remota em `f36b01448a35ec04aa8755ad63134de5a68fdd09`, em checkout isolado, sem incorporar as demais alterações do workspace original.

## Comportamento

- Leitura limitada a dois arquivos por vez, com pausas para o navegador atualizar a interface e contador de progresso.
- Bloqueio de seleções concorrentes durante a leitura; liberação em caso de erro.
- Até 500 arquivos, 10 MB por arquivo e 50 MB por lote, aceitando o caso relatado de 337 XMLs dentro desses limites.
- Revisão de notas e pedidos com 25 entradas por página, preservando todos os documentos do lote para as etapas seguintes.
- Índice de clientes por documento evita repetir uma busca completa por arquivo.
- Falhas de arquivo são apresentadas individualmente sem descartar os demais documentos.
- Gravação em lote adia a atualização das consultas até o término do fluxo. Criações fora da importação mantêm atualização imediata.

## Verificação antes da publicação

- 48 testes aprovados: leitura de 337 XMLs, seleção concorrente, progresso, falha isolada, paginação e índices de ações, limites, identidade fiscal e atualização das consultas de faturamento.
- Dois testes dos scripts de publicação aprovados.
- Build de produção, orçamento do bundle e inspeção do artefato público aprovados.
- ESLint dos arquivos alterados aprovado.
- Lockfile, higiene do repositório e contrato de release Supabase aprovados. Esta correção não altera banco, Edge Functions ou dependências.
- TypeScript global permanece com erros preexistentes em consultas de itens de carga e normalização de pedidos; nenhum desses arquivos foi alterado neste commit.
- Verificação estrutural global permanece bloqueada pelo arquivo preexistente `src/test/productionConfiguration.test.ts`, acima de 500 linhas e ausente da lista de exceções.

Validação com dados sintéticos; não foram utilizados os XMLs reais do cliente nem gravadas notas no ambiente de produção. A verificação da publicação deve confirmar o commit em `/release.json` e a disponibilidade dos arquivos estáticos da aplicação.
