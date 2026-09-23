# Checagem sintética de criação e manejo de cargas — 23/09/2026

## Escopo

Criação manual e agrupada, recuperação de pedidos sem resposta, importação,
documentos e metadados, itens, alteração e exclusão, status, controle,
realocação, replanejamento, roteirização, despacho, reentrega, desfecho
operacional, viagem e custódia. Os testes de banco usam PostgreSQL local via
PGlite com as funções SQL das migrações do projeto.

## Resultado

- Bateria consolidada: **98 arquivos e 962 testes aprovados** (`vitest run`,
  dois workers).
- `npm run typecheck`: aprovado.
- Lint dos arquivos alterados: aprovado.
- `npm run build:check`: aprovado, incluindo orçamento dos bundles e verificação
  de artefatos públicos.

## Achado e correção

A confirmação de criação aceitava uma resposta com a contagem correta de notas,
mesmo quando os IDs confirmados eram diferentes dos IDs solicitados. O outbox
agora compara exatamente os IDs selecionados e exige o ID da nota criada
manualmente. Respostas incompatíveis mantêm o pedido pendente para recuperação.

Foram acrescentados testes para troca de IDs com a mesma contagem, ausência do
ID de nota manual, duplicidade de notas, excesso de capacidade do veículo e
atomicidade em caso de rejeição. Três testes de interface foram atualizados
para os contratos atuais de custódia, paginação de cargas e papel financeiro;
um quarto passou a distinguir o botão de fechamento do diálogo.

## Limites

Esta checagem usa fixtures sintéticos e não executa um fluxo autenticado em
navegador contra um projeto Supabase remoto. A suíte global do repositório
(1.258 arquivos de teste) foi iniciada, mas apresentou falhas em módulos fora
do escopo de cargas; a execução foi interrompida e não constitui um resultado
global aprovado. A bateria de 98 arquivos acima foi repetida integralmente
após as correções e passou sem falhas.
