# Despacho recuperável — ensaio local de 30/08/2026

Status: **progresso local; não publicado e não liberado para produção**.

## Contratos conferidos

Consulta somente leitura em produção confirmou:

- `dispatch_planned_route(jsonb)` ainda tem o hash `2ad186be84b9aca809f36302a3135be3`.
- `guard_trip_load_link_graph()` ainda não está instalado.
- A política de leitura de idempotência corrigida está ativa: `a5e2fc2cb8bbeb71640ea0bc13d8b3a8`.

A candidata `20260830062933_harden_dispatch_planned_route.sql` tem hash local `7b9c529c986d872eb1ee06ba384ddd62`, com execução negada a `anon` e preservada para `authenticated`/`service_role`. A função exige identidade e vínculo ativo de operador/admin/owner; um papel de serviço sem essa identidade não substitui a autorização. Hashes identificam o texto normalizado de `pg_get_functiondef`, não constituem controle de segurança.

O preflight recusa aplicar a candidata sem os guards de carga/viagem revisados e a política de idempotência corrigida. Não se tentou contornar a rejeição anterior de publicação do lote amplo carga/viagem.

## Correções locais

1. A RPC valida tenant e atividade de motorista, veículo e cliente; bloqueio/status/vínculos da carga; correspondência entre itens, documentos e paradas. Uma nota deve aparecer exatamente uma vez, e nenhuma nota da composição pode ser omitida.
2. O planejamento é transacional, mantém viagem planejada sem início real, preserva carga já carregada, grava vínculos canônicos e auditoria. Falhas não deixam viagem, parada ou acerto parcial.
3. Idempotência é vinculada a tenant, ator e chave. Mesma chave/corpo retorna a mesma viagem; corpo diferente é recusado. A associação do operador é revalidada após espera pelo lock. Repetições legadas com corpo exatamente igual têm chave derivada do conteúdo.
4. As duas telas passam pelo cliente compartilhado. Ele persiste o corpo necessário ao reenvio antes da chamada, com chave estável e escopo por empresa/usuário/rota. Resposta ausente, erro de rede ou identificador inválido não viram sucesso.
5. A recuperação é explícita: reenvia o corpo congelado, inclusive após recarga, sem substituir por campos editados. Uma negativa posterior não apaga uma tentativa cujo commit anterior é desconhecido. Apenas sucesso confirmado ou rollback SQL definitivo da primeira tentativa permite remover o registro local.
6. O armazenamento é versionado e removido após resolução. Contém somente a solicitação operacional necessária ao replay, não credenciais, perfil, XML ou anexos. Se estiver bloqueado, cheio ou corrompido, nenhum novo envio daquela tentativa é iniciado silenciosamente. Não há descarte automático de pendências por prazo.
7. Web Locks coordena tentativas entre abas; ausência desse recurso em contexto seguro gera orientação e impede envio. A proteção definitiva continua no banco. Troca de sessão/empresa impede que uma resposta antiga provoque confirmação na nova tela.
8. `LoadDetail` permite distribuir os documentos entre paradas; parada adicional vazia e documentos omitidos/duplicados são recusados. Labels e descrição do diálogo foram associados. Horários locais são convertidos para instantes com fuso explícito antes do envio.
9. Rascunhos usam atualização condicional por tenant, status e versão observada, sem upsert irrestrito. Um autosalvamento tardio não pode transformar rascunho despachado em rascunho editável nem recriar um rascunho conhecido que foi excluído. A autoria original é preservada. O autosalvamento foi extraído para hook próprio e é suspenso durante envio ou pendência de confirmação.
10. Rejeições e sucessos atualizam as consultas compartilhadas de motorista/operação/carga/viagem; falha de atualização não mascara o resultado da mutação. Não há retry automático de mutações.

## Evidências

| Camada | Resultado | O que comprova |
| --- | --- | --- |
| Reprodução do contrato capturado | 6 testes aprovados | No banco local, a função antiga aceita documentos omitidos/duplicados, carga bloqueada ou finalizada, vínculos de outro tenant e não recupera a repetição. Não houve exploração desses casos em produção. |
| Candidata SQL | 44 testes aprovados | Elegibilidade, cobertura documental, rollback, idempotência, autorização e planejamento → início → baixa → acerto pendente, sem pagamento. |
| PostgreSQL nativo 17.11 | 33 testes aprovados | 20 cenários anteriores de entrega/carga/recuperação mais 13 novos de planejamento. Sobreposição é comprovada com locks/sessões, não inferida apenas por pausas. |
| Frontend e integração local | 69 testes aprovados | Outbox (22), hook de despacho (11), consistência (12), CAS de rascunho (6), recuperação renderizada (5), telas reais (5), autosalvamento (5) e frontend/SQL (3). |

Os testes de tela exercitam os componentes reais `LoadDetail` e `RoutePlanning`, incluindo o seletor real de documentos. O transporte permanece isolado. Os três testes frontend/SQL usam a candidata em PGlite: perda de resposta após commit, recuperação após remount, correção após rollback definitivo e revogação de associação antes da recuperação.

O ensaio nativo usa PostgreSQL descartável em loopback, encerrado ao final. Chaves estrangeiras e triggers operacionais/financeiros capturados participam, mas há ramificações externas instrumentadas. PGlite e o PostgreSQL portátil **não equivalem** à pilha Supabase completa com Auth, Storage, RLS integrada e PostGIS. A chegada no teste de baixa é preparação de fixture, não validação de GPS.

Gate geral final `npm run check`, com Node 22.23.2/npm 10.9.4: **aprovado, 1.074 testes em 102 arquivos**. Tipagem, lint, baseline estrutural e sintaxe das 40 Edge Functions aprovados. Cobertura do subconjunto configurado: 93,03% linhas/statements, 65,83% branches e 81,81% funções; não representa cobertura do aplicativo inteiro. Build aprovado, maior chunk de 488,3 KiB, sem sourcemaps ou padrões reconhecidos de segredos no artefato público. Os 33 testes nativos são execução separada, não estão somados aos 1.074.

## Pendências antes de publicar

- Concluir proteção da composição e replanejamento depois do despacho, inclusive concorrência dos escritores `upsert_load_item_v3`, `delete_load_item_v3`, `assign_fiscal_documents_to_load_v2`, `remove_fiscal_documents_from_load_v2`, movimentação entre cargas e RPCs legadas de planejamento. Locks durante esta RPC não garantem a integridade de alterações futuras feitas por outros caminhos.
  - Lote posterior de [composição](COMPOSICAO-CARGAS-2026-08-30.md) corrigiu localmente a realocação na mesma viagem não iniciada, totais, isolamento e limpeza de mercadoria manual remanescente. Não fecha os demais escritores nem implementa replanejamento entre viagens; esta pendência continua aberta.
- Completar o fluxo canônico de itens manuais/sem documento, incluindo parada e baixa. A candidata atualmente os recusa explicitamente porque a baixa disponível é documental. **Isso é uma limitação provisória, não uma redefinição de “100% funcional”.**
- Produzir e ensaiar recuperação guardada específica da RPC de planejamento, mantendo chaves/resultados já confirmados e histórico; verificar todos os consumidores antigos antes do rollout.
- Concluir o ensaio da pilha Supabase completa e E2E autenticado motorista → operação, incluindo rede intermitente e múltiplas abas. `.env.test.local` continua ausente; nenhuma conta privilegiada ou atalho de autenticação foi criado para contornar isso.
- Conciliar migrações locais/remotas e publicar banco, corte de APIs e frontend em ordem compatível. Não usar `db push` indiscriminado nem promover o checkout fiscal inacabado.

Nenhuma alteração de produção foi aplicada neste lote. Nenhuma emissão fiscal, pagamento ou serviço pago adicional foi acionado; SSX continua inativo.

Referências técnicas consultadas: [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) e [revisão individual de funções privilegiadas no Supabase](https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0029_authenticated_security_definer_function_executable).
