# Revisao de aceite e concorrencia - 2026-09-11

Estado inicial main47a2b22a; Sites24 publicado. Briefing financeiro.txt relido integralmente nesta rodada. Os grupos de navegacao estao presentes; isso nao certifica a jornada completa.

## Evidencia nova

PG_QA_SUITE=finance-verification-reauth, node --experimental-strip-types scripts/test-delivery-concurrency.mjs: exit0, PostgreSQL17.11 nativo em loopback com fixture descartavel. Seis casos passaram: espera autorizada/replay; membership revogada durante espera; perfil motorista misto durante espera; driver ativo sem membership; replay reautoriza; OID/ACLservice-only preservados. Cluster parado pelo runner. Migration142923 SHA2569ce386f8a93b46865569099495f6a47935b207f51f6fdee8c932bc1f8763273f. Producao consultada:PostgreSQL17.6. Ensaio local nao equivale a toda a cadeia Supabase nem navegador remoto.

Sessao agent-browser finance-sites consultada: /auth. QA autenticada integral continua sem evidencia. Pedido anterior de autorizacao administrativa continua sem resposta; nao foi contornado.

## Lacuna prioritaria confirmada

ExpenseBatchLine usa uploadSecureFile legado, cujo caminho exige scanner externo ausente. BuildExpenseBatch exige receiptPath para descarga: o caminho de anexo v2 posterior ao gasto nao resolve a criacao pelo modal. Deve integrar preparacao/validacao do artefato antes do lote e consumo atomico no comando, mantendo a mesma tela. Nao usar caminho ficticio nem justificativa automatica de ausencia para contornar comprovante obrigatorio.

## Outros resultados da revisao

PayablePortfolioPanel rotulava nominal corrente como original. Agente corrigiu rotulo e teste150->120;7testes/lint0, ainda sem publicar esta alteracao nesta anotacao.

Regularizacao de custo ja pago precisa preservar saida real e distinguir saldo de adiantamento do motorista de valor recuperavel do prestador. Reversao existente de vinculo nao prova devolucao. Extensao ainda nao implementada.

Previsto versus realizado congelado e folha em volume requerem revisao complementar; nao declarar truncamento financeiro sem prova. Conciliação/caixa/fechamento ja tem implementacao: nao reconstruir por ausencia de QA autenticada.
