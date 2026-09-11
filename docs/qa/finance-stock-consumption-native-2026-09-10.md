# Consumo de estoque — ensaio PostgreSQL nativo

Data: 2026-09-10. PostgreSQL17.11 local descartável; nenhum acesso remoto. Suite `finance-stock-consumption`, script `scripts/test-finance-stock-consumption-native-cases.mjs`.

## Escopo e hashes

- 71503 consumo: `255b91a22d7e9dfe2a4bf43fa48c7c591d288d24976dc352cca653b57d58401c`.
- 71734 leitores: `0929a3da07490b2b35a2fd1515af100d8014e6182f2d56f0eca0fbfba8cd51f4`.
- 70454 aquisição: `8e56e0d16b593974ab2299713253c1282423793c21442c0f671c3bc6bdce9c7e`.
- 70539 leitores aquisição: `1f7f17c1f2b419c949824e5731c332e31935bfbfc9fd26481cc216fd0b2cfb2e`.

A cadeia usa schemas baseline de estoque/manutenção/folha, lote canônico, pagamento de título real e core de aquisições. Dependências são as explícitas no script, derivadas do ensaio de aquisições. Não representa instalação de todas as migrations ou ambiente Supabase completo. Distância/receita fiscal fora do escopo continuam helpers restritos da fixture. Tabelas de extrato para consulta de auditoria têm colunas mínimas; não são prova bancária.

## Casos

1. Aquisição real de 3 unidades por 1 centavo, registrada por lote+comando de associação após71503. Três comandos reais de consumo geram 0/0/1. Replay conserva IDs; reversão da parcela intermediária libera exatamente zero centavo/uma unidade, novo consumo preserva total1/3. Sem inserir links de aquisição manualmente.
2. Duas aquisições explícitas no mesmo consumo, soma exata e reversão removendo apenas reservas ativas; histórico permanece.
3. Duas fontes disputando a mesma capacidade: primeira vence; revisão obsoleta é rejeitada; quantidade total não ultrapassa aquisição.
4. Mesma chave simultânea: uma atribuição, retorno idempotente.
5. Autor revogado após espera observada em lock: rejeição e nenhuma atribuição residual.
6. Dinheiro, custos, títulos, pagamentos e alocações preenchidos permanecem idênticos antes/depois de atribuir e reverter. Alocação foi criada pelo comando de lote e pagamento pelo comando apply_finance_payable_movement. Há asserts explícitos de tabelas não vazias.
7. Reversão concorrente com novo consumo: preview antigo é rejeitado, revisão nova permite consumo e reserva correta.
8. Seleção de duas aquisições em ordens inversas: serialização sem deadlock permanente, preview obsoleto rejeitado; nova revisão consome saldo restante.

Schemas reais `stockConsumptionContextSchema`, `stockConsumptionPreviewSchema`, resultados de atribuição/reversão e resultado de aquisição são aplicados às respostas SQL. O leitor de consumo é consultado após atribuições. A ampliação de campos unitários do leitor de aquisição é instalada; esta suíte não exercita diretamente todas as telas/páginas desse leitor.

## Execução

Primeiro49987 terminou com erro de expectativa no harness (rejeição40001 correta, mas wrapper esperava sucesso). Corrigido somente harness. Rerun93636:6 testes passaram, exit0, servidor parado. Rodada final ampliada18036: **8 testes passaram, exit0, servidor parado**. Hashes conferidos no log final.

Log: `node_modules/.cache/qa-postgres/finance-stock-consumption-native-2026-09-10.log`.

## Limites

Não é ensaio de implantação completa, prova de autenticidade de documento, recebimento físico ou vinculação retroativa automática de todo estoque. Fontes físicas foram inseridas na fixture; as atribuições, aquisições, custos e pagamentos testados usaram comandos reais. Não testa nesta rodada todos os guards de mudança de fonte/tenant já exercitados em aquisição, nem isolamento de cada endpoint com motorista; esses casos permanecem na matriz SQL/UI e ensaios anteriores. Nenhuma alteração ao SQL de produto ou classificador B.
