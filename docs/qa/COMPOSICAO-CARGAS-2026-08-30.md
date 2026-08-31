# Composição e realocação de cargas — candidata local

Estado: **implementação parcial, não publicada e não liberada como 100% pronta**. Todas as cargas existentes estão autorizadas para testes; este lote usou somente dados sintéticos locais e leituras de produção. Nenhuma emissão fiscal, pagamento, contratação ou integração SSX foi acionada.

## Defeitos reproduzidos e alcance da candidata

Foram capturados 14 contratos de funções, colunas, chaves estrangeiras, triggers e políticas. As oito reproduções executam as funções de composição capturadas em banco local, com a infraestrutura candidata de planejamento/entrega. Não são exploração nem comprovação de vazamento histórico em produção.

| Reprodução local | Tratamento neste lote |
| --- | --- |
| Operador do tenant A move itens para carga do tenant B | RPC exige origem/destino do tenant autorizado; trigger de itens valida referências e impede troca de identidade/tenant do item. Não substitui a revisão das políticas de alteração dos pais. |
| Inclusão de nota após planejamento não a coloca em parada | **Pendente:** escritores de inclusão e replanejamento explícito. |
| Remoção de nota deixa referência antiga na parada | **Pendente:** escritores de remoção e replanejamento explícito. |
| Realocação deixa a parada vinculada à carga anterior | Na mesma viagem ainda não iniciada, atualiza a carga e preserva parada/destino originais. Entre viagens ou entre atribuída/não atribuída, recusa e informa necessidade de replanejamento. O fluxo explícito ainda precisa ser implementado. |
| Totais da origem continuam incluindo o item movido | Trigger existente recalcula os dois lados: peso, volume e paletes. |
| Seleção desatualizada resulta em sucesso parcial | Requer todo o conjunto selecionado; falha desfaz a transação inteira. Uma nota com vários itens só pode ser movida integralmente. |
| Composição muda após partida porque o status da carga foi regredido | Helper reconhece início real e viagem `in_transit`, protegendo os escritores legados que o consultam. |
| Limpeza da última nota apaga mercadoria manual ainda presente | Limpeza verifica itens e documentos, bloqueia a carga e não força exclusão em conflito. |

Inventário read-only de produção: zero vínculos cruzados item/carga, item/documento e item/pedido; zero itens manuais atuais. Isso não descarta risco futuro nem autoriza dispensar o suporte a itens manuais.

## Contrato da implementação

- Migração local `20260830072744_harden_load_composition_integrity.sql`: substitui quatro funções existentes; não adiciona grants, tabelas ou triggers e não repara/apaga dados históricos durante aplicação. Preflight verifica contratos, permissões, autorização, trigger de totais e inconsistências de tenant.
- RPC preserva nome/assinatura e retorna `moved`, cargas de origem/destino, `document_ids` e `source_removed`. Locks de viagem precedem cargas/documentos/itens; conflitos de ordem inversa são recusados para nova seleção, sem retry automático. Associação ativa do operador também é protegida.
- A interface usa o tenant autenticado, congela a seleção enviada e valida a resposta completa. Ausência, quantidade parcial, notas divergentes ou cargas incorretas não viram sucesso.
- Exclusão posterior no navegador e junção textual de destinos foram removidas. O banco informa se realmente removeu a origem; o navegador não interpreta falha de contagem como carga vazia. Destinos operacionais são preservados, não reescritos com toda a rota da origem durante movimentação parcial.
- Contexto de usuário/empresa é conferido após resposta e após atualização de consultas. Seleções e histórico da sessão são limpos ao trocar de empresa/usuário. Reenvio simultâneo no mesmo hook é impedido.
- Erros definitivos do banco diferem de resultado desconhecido. Timeout, resposta incompleta ou SQLSTATE `40003` podem ter ocorrido após commit: a tela mantém aviso, não anuncia zero itens movidos, não cria histórico de sucesso e exige conferir/reselecionar.
- Consultas de cargas, documentos, viagens, paradas, motorista, planejamento e operação são invalidadas em sucesso ou falha. Isso atualiza o cache do navegador atual; **não comprova sincronização em tempo real entre dispositivos**.

As orientações Supabase/PostgreSQL influenciaram a ordem dos locks, isolamento e recuperação guardada; as de React influenciaram a coordenação do envio, validação de contexto e atualização paralela dos caches.

## Evidência de testes

- 8 reproduções do legado e 27 testes da candidata SQL: aprovados.
- 26 testes de contrato/hook React e 5 da tela real `LoadReallocation`: aprovados; seletores reais, confirmação, rejeição, resultado ambíguo e ausência de escritas extras.
- 5 testes hook real → SQL/triggers locais: aprovados. Incluem commit com resposta perdida, revogação de associação, seleção desatualizada, limpeza real e rejeição de mudança de viagem.
- 48 testes PostgreSQL nativos: aprovados em execução separada. São 33 cenários anteriores e 15 de composição/recuperação. Incluem disputas por viagem, carga, documento, item, associação e limpeza; composição → partida → baixa → acerto `pending_review`, com zero pagamentos.
- Recuperação guardada ensaiada: recusa divergência de corpo/configuração, grants e trigger; verifica os 14 contratos, restaura somente as quatro funções alteradas e reaplica a candidata. Snapshot de cargas, itens, documentos, viagens, vínculos, paradas, eventos, auditoria e financeiro permanece idêntico. Último tempo local: 469 ms, **não uma previsão para produção**.
- Gate geral `npm run check` com Node 22.23.2/npm 10.9.4: **aprovado, 1.145 testes em 107 arquivos**. TypeScript, lint, baseline (113/113 avisos `any`, sem novos arquivos >500 linhas), sintaxe de 40 Edge Functions e build aprovados. Maior chunk 488,3 KiB; artefato público sem sourcemaps ou padrões reconhecidos de segredos. Cobertura do subconjunto configurado: 93,03% linhas/statements, 65,83% branches, 81,81% funções — não representa todo o aplicativo. Os 48 ensaios nativos são separados desses 1.145 testes. `git diff --check` aprovado.

PGlite e PostgreSQL portátil usam fixtures com FKs e triggers capturados, mas ramificações fiscais externas instrumentadas. Não equivalem à pilha Supabase completa com Auth/Storage/RLS/PostGIS. A chegada no cenário de baixa é preparação de fixture, não comprovação de GPS. Testes React usam transporte isolado ou ponte SQL local, não E2E HTTP autenticado.

## Recuperação e compatibilidade de publicação

[Roteiro SQL de recuperação](COMPOSITION-RECOVERY-2026-08-30.sql) é um artefato local de ensaio, não foi executado em produção. Prefira correção adiante: restaurar o legado reabre os defeitos conhecidos. Ele não desfaz movimentações de negócio já confirmadas nem apaga evidências.

| Função | Hash capturado/produção ainda atual | Hash candidata local |
| --- | --- | --- |
| `_load_is_locked(uuid)` | `e77c73ef2b708130f34da83c2830c478` | `a15b8a40dfd93a05479f8cc0b04db3eb` |
| `delete_load_if_empty(uuid)` | `242330e8795383f6d9e66cdb4cd83b3a` | `d724afa8cce7714aae6c4deedf00e7a3` |
| `move_load_items_between_loads(uuid,uuid,uuid,uuid[])` | `7426489e533d6eecb3335dcd5bc1c8dd` | `7ac9704abb7f610328b22b1e9f129d99` |
| `recalc_load_totals()` | `87b2082210a98ec8b9447543b6092e8e` | `7dc12046ecada4d2f04bb2942a92493d` |

Nova leitura de produção após os testes confirmou os quatro hashes antigos e ACLs preservadas. Nenhuma tentativa de deploy deste lote foi feita.

Antes da publicação:

1. Concluir a proteção dos outros escritores de composição, atribuição de documentos/paradas e mudanças de tenant das entidades-pai. A candidata não fecha todos os caminhos de escrita direta.
2. Replanejamento entre viagens foi implementado e ensaiado no lote local seguinte, com destino explícito, histórico e concorrência. Ver [evidências atualizadas](REPLANEJAMENTO-CARGAS-2026-08-30.md). Fluxo manual canônico até parada/baixa continua pendente; a restrição provisória não redefine o objetivo de app integralmente funcional.
3. Concluir recuperação específica de planejamento e verificar a pilha completa, RLS e fluxo motorista/operação autenticado. `.env.test.local` continua ausente; não foi criado atalho de autenticação.
4. Conciliar dependências com as candidatas de início/entrega/planejamento, ainda não publicadas integralmente. A negativa anterior da revisão automática para os triggers amplos de carga/viagem não foi contornada por este lote local.
5. Publicar SQL antes do frontend que exige os novos campos de confirmação. Frontend novo contra SQL antigo receberia resultado incompleto e mostraria confirmação pendente, mesmo se o legado já tivesse movido itens. Coordenar também a recuperação, sem `db push` indiscriminado ou publicação das mudanças fiscais inacabadas.
6. Repetir pós-deploy frontend/backend, concorrência e regressões interligadas; não declarar prontidão por contagem de testes.

Referências primárias: [funções e privilégios no Supabase](https://supabase.com/docs/guides/database/functions), [abortar requisições no cliente](https://supabase.com/docs/reference/javascript/using-modifiers-abortsignal) e [locks do PostgreSQL 17](https://www.postgresql.org/docs/17/explicit-locking.html).
