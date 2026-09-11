# Histórico capturado de recebíveis — leitor local

Migration `20260910201323_finance_receivable_captured_history.sql`, posterior à foundation temporal195941. Não altera a foundation nem implementa posição as_of.

## Contrato e proteção

RPC `get_finance_receivable_history(_tenant_id uuid, _receivable_id uuid default null, _page integer default 1, _expected_revision text default null)`. Public invoker chama helper privado definer com can_access atual; tabelas e sequência permanecem sem grants de API. Motoristas, inclusive perfis mistos, não leem o diário.

Envelope versão1: tenant_id, receivable_id opcional, basis=captured_versions, captured_at da consulta, revision, coverage, page/page_size50/total, rows e limitations. Coverage explicita starts_at, baseline_kind e capture_basis=transaction_capture_not_commit. ID de título inexistente no diário retorna conjunto vazio; títulos excluídos continuam acessíveis por suas versões, sem depender da linha atual.

Cada evento expõe ordem técnica string, título, operação, captura/transaction_id, ator e nomes capturados, before/after projetados e changed_fields. A projeção é uma lista permitida: descrição, número da fatura, status, vencimento, valores em centavos, client_id, pagador capturado e IDs das origens. Não expõe OLD/NEW integrais nem notas/campos internos indiscriminadamente. Changed_fields compara somente as chaves públicas da projeção.

O reader não consulta o cadastro atual para substituir nomes ou estado de títulos. `payer` exige ID compatível com a versão e tenant correto. Valores precisam ser não negativos, finitos e exatos em centavos; números fracionários inválidos nunca são arredondados. O leitor conserva valores legados acima do teto dos escritores modernos, como strings exatas, com limite defensivo de100 caracteres na representação numérica original. Received_amount null permanece desconhecido. Datas infinitas/inválidas viram null com diagnóstico.

## Revisão e paginação

Ordem decrescente de event_order é somente desempate técnico, não ordem de commit. A revisão inclui todos os eventos visíveis do escopo, ordenados, e a cobertura, não apenas max(event_order). Cada linha integral é reduzida a um hash antes da agregação ordenada, evitando materializar todos os snapshots brutos em um único JSON. Captured_at da consulta fica fora do hash. Alterações em campos internos de uma versão também participam da revisão, embora não sejam expostas.

Página maior que1 exige expected_revision (`finance_history_revision_required`,22023). Revisão divergente em qualquer página retorna `finance_history_changed`,40001. A função STABLE trabalha no snapshot da instrução SQL. A confirmação posterior de uma transação com sequência menor deve mudar o hash e invalidar a próxima página, sem alegar reconstrução de conhecimento passado. O ensaio nativo independente foi solicitado especificamente para esse interleaving.

Uma consulta por título tem revisão desse título e cobertura; novos eventos de outros títulos não a invalidam. A consulta sem filtro considera o diário inteiro da empresa. Não há limite de1000 nem total derivado de página. Paginação requer reprocessar o fingerprint completo; volume muito elevado deve ser medido antes de adotar manifestos persistidos, sem trocar por maxsequence inseguro.

## Testes

`npx vitest run src/test/receivableCapturedHistory.test.ts`: **7 testes passaram**, todos com parser real `receivableHistorySchema` do cliente. ESLint passou nos arquivos próprios.

- 1.005 eventos,21 páginas, IDs únicos e ordem decrescente, total completo.
- Mudança de valor/vencimento e tombstone DELETE com snapshots e changed_fields exatos.
- Revisão repetível, escopo por título e rejeição de revisão antiga/página inválida.
- Quantia com fração de centavo, recebimento null e vencimento infinito retornam diagnóstico sem arredondamento.
- Valor legado de100000000000001 centavos é preservado, sem aplicar teto de escritor moderno nem conversão para Number.
- Nomes de ator e pagador permanecem os capturados após alterações dos cadastros atuais.
- Isolamento de empresa, motorista misto e ausência de grants diretos nas tabelas.

Factory `createReceivableCapturedHistoryDatabase` usa a foundation e cadeia real de recebíveis existente. Não cria substitutos de escritor. A prova de concorrência é responsabilidade do ensaio PostgreSQL independente; os testes acima são PGlite.

SQL SHA-256: `8a94f49b025db40e3a1629b091c0e33180720579e37c8fa04149cd28bca80fe6`.
Factory SHA-256: `f2c9f5b5c220e683127d3cb32d57415070797d7fb8a5cc923142b190a44b3121`.

Nenhuma aplicação remota ou TSC nesta subtarefa. Não representa saldo histórico/bancário, posição comercial em data passada ou certificação anterior à baseline.
