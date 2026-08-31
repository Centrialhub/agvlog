# Replanejamento explícito de cargas — evidências locais

Estado: implementado e ensaiado localmente; **não publicado e não equivalente à prontidão integral do aplicativo**.

## Contrato implementado

Migração candidata `20260830080608_add_explicit_load_replanning.sql`, dependente das candidatas de integridade carga/viagem, composição e entrega. Não aplicar isoladamente nem executar `db push` indiscriminado.

- `get_load_replanning_context` fornece uma revisão SHA-256 da composição e das paradas das duas cargas. `replan_load_items` exige essa revisão, seleção integral por nota, destino explícito, motivo e chave de requisição.
- Origem e destino precisam pertencer ao tenant do operador ativo. Viagens devem estar planejadas e sem início real; cargas encerradas/em trânsito ou bloqueadas são recusadas.
- A transferência modifica itens, espelho fiscal e alocações de parada na mesma transação. Destino é uma parada escolhida da viagem correta, uma nova parada com coordenadas informadas ou uma carga explicitamente sem viagem.
- Paradas esvaziadas são preservadas como canceladas, sem inventar chegada/saída. Viagem de origem vazia é cancelada, sem fabricar início/fim. Referências de ocorrências e comprovantes preservam a identidade da carga vazia.
- Notas com comprovante, resultado final ou vínculo com emissão fiscal exigem revisão; a RPC não emite, cancela ou consulta provedores fiscais.
- A baixa ignora paradas canceladas, vazias e nunca visitadas no cálculo do resultado das mercadorias. Isso evita transformar entrega completa em parcial por causa do histórico de planejamento.
- Os dois helpers novos ficam privados. As duas APIs novas são executáveis apenas por `authenticated` e verificam operador/admin/owner ativo do tenant; `anon`, `PUBLIC` e `service_role` não recebem execução delas.

O cache de resposta usa coluna aditiva em `idempotency_keys`, mantendo RLS. Preflight recusa RLS desabilitada, políticas de escrita ou alteração da política de leitura esperada. Não são criadas políticas abertas.

## Frontend e recuperação de resposta perdida

A tela real `LoadReallocation` usa o novo painel, sem escolher a primeira parada automaticamente. A requisição exata é persistida antes do envio, com separação por tenant/usuário e coordenação entre abas. Uma resposta incerta permanece recuperável mesmo após remontar a tela e mesmo se a carga de origem já foi removida pelo servidor.

Não há sucesso baseado apenas em ausência de erro: IDs, quantidade, documentos, destino e chave precisam ser confirmados. Tentativa com rollback SQL comprovado pode ser refeita; uma confirmação perdida anterior não é descartada por um erro posterior. Dados locais inválidos ou armazenamento indisponível impedem novo envio.

A revisão React levou à limpeza de endereço/coordenadas ao trocar carga, tenant ou usuário. O defeito foi primeiro reproduzido: o campo ainda continha “Destino antigo”; depois a regressão passou. As consultas `driver_delivery_stops` e `driver_stop_products` foram incluídas na invalidação após alteração de composição.

## Testes e limites

- **58 testes específicos passaram**: 16 SQL de negócio, 13 SQL de recuperação/preflight, 24 de fila durável/contrato e cinco com componentes reais conectados à candidata SQL.
- **71 testes PostgreSQL nativos passaram**: 48 dos lotes anteriores e 23 de replanejamento/recuperação. Usam sessões reais e comprovação de espera/conflito, não apenas chamadas sequenciais.
- Cobertura nativa inclui chave repetida, payload divergente, conflito em viagem/carga/parada/vínculo/nota/item/membership, revogação durante espera, disputa com início real e rollback integral.
- Cenário interligado: replanejamento na mesma viagem → partida → entrega completa de duas notas → carga `delivered`, viagem `completed`, dois comprovantes, uma parada histórica cancelada, um acerto `pending_review`, **zero pagamentos**.
- Nova chegada nesse cenário é preparação de fixture; não valida GPS/PostGIS. Provedores fiscais externos ficam instrumentados, sem transmissão.
- Os componentes React usam ponte SQL local; não são E2E HTTP com Auth/Storage reais. `.env.test.local` continuava ausente nesta verificação; nenhum atalho de autenticação foi criado.
- Gate final após o último ajuste do formulário: **1.203 testes/111 arquivos aprovados**, tipos, lint, baseline, sintaxe das 40 Edge Functions, build e artefato público aprovados. Maior chunk: 488,3 KiB. Cobertura do subconjunto configurado: 93,03% linhas/statements, 65,83% branches e 81,81% funções; não representa cobertura integral do aplicativo.

## Recuperação protegida

[Roteiro SQL](REPLANNING-RECOVERY-2026-08-30.sql) e [contratos locais](REPLANNING-LOCAL-CONTRACTS-2026-08-30.json) são artefatos de ensaio. O JSON não é captura de produção.

O roteiro restaura apenas o estágio imediatamente anterior a esta candidata. Confere 11 contratos/ACLs e o cache, obtém lock exclusivo no cache e **recusa qualquer uso registrado** do replanejamento, inclusive auditoria sem chave ou outra operação usando a coluna nova. Após uso real, corrigir adiante: não apagar chaves ou auditorias para permitir rollback.

Ensaios nativos confirmaram recusa por alteração de função, grant, RLS, política de escrita ou coluna; recusa após entrega/acerto; e espera por transferência concorrente seguida de recusa após commit. Antes do primeiro uso, recuperação + reaplicação levou cerca de **410 ms** no fixture e preservou as rotas planejadas. Esse tempo não estima a duração em produção.

As recuperações antigas de composição/integridade não devem ser executadas fora de ordem. Os hashes agora diferentes fazem suas guardas recusarem contratos incompatíveis. Após o lote local de inclusão/remoção documental, a recuperação deste replanejamento também recusa execução enquanto a API/helper mais nova estiver instalada, mesmo sem uso. Recuperação em ordem inversa e reaplicação conjunta foram ensaiadas; ver [alteração de documentos](ALTERACAO-DOCUMENTOS-CARGA-2026-08-30.md).

## Produção consultada, não alterada neste lote

Leitura independente confirmou ausência das novas APIs e da coluna `response_body`; `_derive_driver_delivery_result` ainda tinha hash `f9c85c43e7813e316467b95fb09b5963` e `delete_load_if_empty`, `242330e8795383f6d9e66cdb4cd83b3a`.

Assessores mantiveram 140 alertas de funções privilegiadas, três tabelas com RLS sem políticas e proteção contra senhas vazadas pendente. Isso não é aprovação do lote local nem revisão completa das 140 funções. Referências: [privilégios das funções](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [RLS sem políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [proteção contra senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Próximos critérios de liberação

1. Inclusão/remoção de notas e `delete_load_item_v3` foram tratados no lote local seguinte, com testes e recuperação; ver [evidências](ALTERACAO-DOCUMENTOS-CARGA-2026-08-30.md). Ainda é preciso fechar todos os escritores alternativos/DML direto, `upsert_load_item_v3`, exclusão de cargas e planejamento legado. Há consumidores em `useLoadItems`, `LoadNotesPanel`, `NewLoadDialog`, `PendingDocsGrouping`, `Ingestion` e `useLoadControl`.
2. Os legados `move_load_items_v2`, `link_fiscal_documents_to_load_v1` e `unlink_fiscal_documents_from_load_v1` estão negados a `authenticated`/`anon`, mas ainda disponíveis ao serviço. Não foram classificados como exploração pública nem revogados indiscriminadamente. Duas variantes de `plan_dispatch_trip_v2/v3` continuam executáveis por `authenticated` e precisam de revisão/corte compatível.
3. Completar mercadoria manual até parada/comprovante/baixa. Esta candidata só move manual entre cargas sem viagem; rejeita inserção manual em rota planejada. Essa limitação não encerra o objetivo de aplicativo completo.
4. Concluir retorno/redespacho com evidência histórica, alterações fiscalmente vinculadas e recuperação específica do planejamento original.
5. Ensaiar Supabase completo/PostGIS, isolamento real e fluxo autenticado motorista → operação → portal. Não contornar a negativa anterior da revisão automática aos triggers amplos.
6. Coordenar publicação SQL, Edge e frontend compatíveis; repetir testes pós-deploy e regressões. SSX permanece inativo e nenhuma integração paga ou emissão fiscal foi acionada.
