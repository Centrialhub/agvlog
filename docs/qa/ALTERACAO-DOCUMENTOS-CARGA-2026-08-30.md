# Inclusão e remoção de documentos da carga — evidências locais

Estado: **implementado e ensaiado localmente, não publicado**. Não representa liberação integral do aplicativo motorista/operação.

## Defeitos reproduzidos

Os quatro testes do legado usam as funções capturadas antes desta candidata e demonstram:

1. Inclusão de nota em carga planejada criava item sem alocação na parada.
2. Remoção podia deixar a alocação antiga na parada, com a nota já sem carga.
3. Documento de saída/excluído era aceito como mercadoria de entrada.
4. Exclusão de um entre vários itens da mesma nota podia zerar o espelho fiscal mesmo com outro item remanescente.

Os testes da tela real também reproduziram `ReferenceError` no filtro do painel: `normalize` era usada antes da inicialização. A função foi movida para o escopo do módulo; a tela com itens carregados passou novamente. O callback local `confirm` foi renomeado para não colidir com a regra de proibição dos diálogos nativos. Nenhum teste de acessibilidade foi removido ou afrouxado.

## Contrato candidato

Migração `20260830085557_harden_document_composition_changes.sql`, dependente das candidatas anteriores de composição, planejamento, replanejamento e integridade carga/viagem. **Não aplicar isoladamente nem fazer `db push` indiscriminado.**

- `get_load_document_change_context` fornece revisão SHA-256 da composição e dos documentos escolhidos. `change_load_documents` exige seleção integral, ação, motivo, revisão e chave da requisição.
- As duas APIs novas são limitadas a `authenticated`, com validação de owner/admin/operator ativo do tenant. Os três helpers são privados; `PUBLIC`, `anon` e `service_role` não recebem acesso às APIs novas.
- Inclusão em viagem planejada exige parada existente escolhida explicitamente, pertencente à viagem, ou nova parada com destino/coordenadas válidos. Carga sem viagem exige escolha explícita desse estado. Não se escolhe automaticamente a primeira parada.
- Notas de outro tenant, já vinculadas a outra carga, excluídas, de saída, com evidência de entrega ou vínculo de emissão fiscal são recusadas. Não há transferência implícita ou emissão/cancelamento fiscal.
- Itens, espelho fiscal, totais e alocações nas paradas são alterados na mesma transação. Locks ordenados/NOWAIT impedem a retenção de locks filhos durante conflitos com partida e outras alterações.
- Remoção abrange todos os itens das notas selecionadas. Paradas esvaziadas ficam canceladas no histórico, sem horários físicos inventados. Viagem esvaziada fica cancelada, sem fabricar partida/conclusão. Mercadoria manual remanescente e referências de ocorrências/comprovantes preservam a carga.
- As quatro funções legadas de incluir/remover delegam ao núcleo protegido. Repetição de inclusão já existente é no-op, sem outro item/auditoria. Inclusão nova em rota planejada precisa migrar para a API explícita.
- `delete_load_item_v3` usa locks do grafo e remoção documental protegida. Exclusão isolada de um entre vários itens da mesma nota é recusada, evitando quebrar o espelho.
- Resposta completa e auditoria `document_composition` ficam na transação. A chave é separada por tenant/ator e não permite reutilização com outro payload. Replay continua possível após exclusão da carga vazia. Membership é revalidada após espera pela chave.

O cache existente mantém RLS e não recebe políticas abertas de escrita. O preflight exige a política de leitura esperada, RLS ativa e ausência de políticas de escrita.

## Frontend e recuperação da resposta

`LoadItemsPanel` abre um diálogo com motivo e destino explícitos. Nota em outra carga aparece desabilitada, com indicação de usar realocação; não promete reatribuição automática. Botões de remoção têm nomes acessíveis e os novos campos têm labels/descrição.

A requisição é persistida antes do transporte, com versão, tenant, ator, carga e UUID. Web Locks coordenam abas; uma solicitação incerta não pode ser sobrescrita por nova edição. O retorno só vira sucesso quando IDs, ação, quantidades, destino e chave correspondem ao pedido.

O painel global em `AppLayout` permite recuperar a mesma requisição após remontar a aplicação, sem depender da existência da carga original. Não há reenvio automático. Falta de acesso ao armazenamento ou conteúdo inválido bloqueia novos envios; erro posterior não apaga uma resposta anteriormente incerta. Rascunhos são limpos ao trocar carga, tenant ou ator. Invalidação inclui consultas de notas, composição, planejamento, paradas e entregas do motorista.

A revisão orientada pela skill React manteve o armazenamento versionado/mínimo e a separação por contexto, e levou à correção do filtro inicializado tardiamente. Esses testes não substituem Axe no navegador autenticado.

## Testes executados

- **70 testes específicos**: quatro reproduções do legado, 21 SQL de negócio, 18 SQL de recuperação/preflight, 23 de fila durável/contrato e quatro com componentes reais conectados à candidata SQL.
- **97 testes PostgreSQL nativos** no total: 71 anteriores mais 26 deste lote, com sessões concorrentes reais e observação de bloqueio em `pg_stat_activity`.
- Concorrência: chave repetida/payload diferente, disputa por viagem/carga/documento/item/parada/membership, revogação durante espera, corrida com partida, rollback integral e replay após exclusão da carga.
- Fluxo cruzado: planejar → incluir nota → remover outra → iniciar → entregar notas restantes. Resultado: carga `delivered`, viagem `completed`, dois comprovantes, nota removida `confirmed` e sem carga, um acerto `pending_review`, **zero pagamentos**.
- **Gate completo aprovado: 1.273 testes em 116 arquivos**, TypeScript, lint de erros/críticos, baseline, sintaxe de 40 Edge Functions, build e artefato público. Maior chunk: 488,3 KiB, abaixo de 500 KiB.
- Cobertura do subconjunto configurado: 93,03% statements/linhas, 65,83% branches, 81,81% funções. Não representa cobertura total do sistema.

Uma tentativa nativa não foi contada como aprovada: o prazo de encerramento de 10 segundos foi excedido pelo checkpoint local (log confirmou parada normal cerca de 12 segundos depois), ocultando a falha do último teste. O harness passou a preservar a causa original e esperar até 25 segundos pelo encerramento. A comparação do último ensaio foi corrigida para considerar a remoção intencional de `response_body`: os registros completos são comparados após reaplicação da coluna. Reexecução integral: **97 aprovados e encerramento confirmado**. Lint dos scripts ajustados também passou.

### Limites da evidência

PostgreSQL 17.11 portátil, em loopback e descartável, sem DSN de produção. Fixtures incluem os corpos e triggers capturados, inclusive `trg_cleanup_empty_loads`; não simulam a pilha Supabase completa. A chegada no cenário de entrega é preparação de fixture, não validação GPS/PostGIS. Auth/HTTP/Storage real e Axe autenticado continuam pendentes. Provedores externos são instrumentados; não há transmissão fiscal real.

## Recuperação protegida

[SQL de recuperação](DOCUMENT-CHANGES-RECOVERY-2026-08-30.sql) e [contratos](DOCUMENT-CHANGES-LOCAL-CONTRACTS-2026-08-30.json) são artefatos **locais**, não captura/recovery executado em produção.

O roteiro confere 17 contratos de função/privilégios e o cache, bloqueia a tabela de idempotência e restaura as cinco funções anteriores somente **antes do primeiro uso**. Depois de qualquer uso registrado na API ou nos wrappers legados, recusa recuperação. Não desfaz edições de negócio, não apaga auditoria e não apaga chaves para forçar passagem pela guarda; preferir correção adiante após uso.

Ensaios confirmaram:

- Recusa após entrega/acerto, mantendo documentos, comprovantes, cache e financeiro.
- Espera por commit concorrente da nova API e dos wrappers legados de inclusão/remoção, seguida de recusa. O núcleo legado participa da barreira mesmo sem escrever chave de resposta.
- Recusa de alterações em corpo, privilégios públicos/privados, RLS e políticas de leitura/escrita; recusa também com auditoria sem cache.
- Restauração/reaplicação antes do uso preserva rotas e registros. Cerca de **744 ms** no fixture final; não é previsão de duração em produção.
- Recuperação antiga do replanejamento agora recusa execução enquanto qualquer API/helper deste lote existir, mesmo sem uso, porque dependências de corpos PL/pgSQL nem sempre são rastreadas pelo DROP. Recuperação em ordem inversa e reaplicação dos dois lotes passaram, preservando registros/chaves.

## Produção consultada, não alterada neste lote

Leitura independente confirmou ausência de `change_load_documents`, `get_load_document_change_context`, `replan_load_items` e coluna `response_body`. As cinco funções legadas continuam com hashes/permissões anteriores. `upsert_load_item_v3` mantém hash `62f819a77731d9fc694d7cd9bc4fe0db` em produção; sua correção local posterior está documentada em [preparação de itens](PREPARACAO-ITENS-2026-08-30.md).

Assessores permanecem com 140 alertas de funções privilegiadas, três tabelas RLS sem políticas e proteção contra senhas vazadas pendente. Não é revisão/validação integral dessas funções. Referências: [funções privilegiadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [RLS sem políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Próximo lote e critérios de publicação

1. Proteção de identidade, métricas, resultados físicos e locks de `upsert_load_item_v3` implementada no lote local posterior. DML direto e demais escritores de carga/item/nota/parada/vínculo ainda precisam de revisão; não basta a nova API.
2. `useLoadItems` (inclusão/edição) e criação dos itens de pedido em `Ingestion` migrados no lote posterior. Revisar exclusão manual, demais etapas da ingestão, `useLoadControl`, `NewLoadDialog` e `PendingDocsGrouping`, testando contratos antigos e novos. Cada entrada planejada precisa destino explícito e recuperação de resultado incerto.
3. Corrigir atomicamente baixa/reversão/reentrega em `LoadNotesPanel`: hoje há UPDATE direto de status fiscal e reentrega em duas etapas, que pode deixar a primeira persistida se a remoção falhar. Preservar histórico de comprovantes e resultados; não resolver apenas ocultando a ação ou reabrindo remoção insegura.
4. Completar mercadoria manual até planejamento, parada, comprovante e baixa. As restrições atuais são provisórias e não satisfazem o objetivo de aplicativo integral.
5. Concluir recuperação do planejamento original, isolamento Supabase completo/PostGIS, fluxo autenticado motorista → operação → portal, uploads/reenvio e fiscal homologado. Não contornar a negativa anterior à publicação dos triggers amplos de carga/viagem.
6. Publicar SQL/Edge/frontend em versão compatível e repetir frontend/backend pós-deploy, concorrência e regressões. Não publicar o frontend novo contra RPC ausente, nem misturar alterações fiscais inacabadas.

Todas as cargas existentes estão autorizadas para testes; isso não transforma ensaio local em evidência de produção. **SSX continua inativo, nenhum serviço pago adicional foi ativado e nenhuma emissão fiscal real foi executada.**

Referência técnica: [funções, search_path e privilégios no Supabase](https://supabase.com/docs/guides/database/functions).

Atualização posterior: a recuperação documental recebeu uma guarda de dependência adicional, recusando execução enquanto `save_load_item_preparation` existir ou o upsert não corresponder ao predecessor. Os testes de recuperação anteriores foram repetidos, e restauração/reaplicação dos lotes em ordem inversa passou. Detalhes e limites em [preparação de itens](PREPARACAO-ITENS-2026-08-30.md).
