# Ensaio e recuperação — invariantes de carga/viagem

**Estado em 31/08/2026: concorrência e recuperação ensaiadas; publicação e reconciliação concluídas.** A candidata passou por preflight de hashes/ACLs, execução completa em transação no schema real, rollback independente, publicação e smoke autenticado revertido.

## Alvo e impacto

Migração publicada: `supabase/migrations/20260831230903_enforce_trip_load_transit_invariant.sql`.

Substitui quatro funções: as RPCs `driver_start_trip(uuid)` e `transition_load_status_v1(uuid,uuid,text,text)`, o espelhamento `sync_trip_load_mirrors()` e o marcador de recálculo `_tg_mark_outdated_trip_loads()`. Adiciona cinco triggers e quatro helpers internos, além de substituir o trigger de espelhamento para cobrir UPDATE. Rejeita carga em trânsito sem vínculo canônico com viagem iniciada e impede encerramento/desvinculação que deixe carga em trânsito. Não cria horários históricos nem altera automaticamente dados antigos.

O impacto inclui planejamento, reatribuição, início, atualização direta de cargas e conclusão por paradas. Um fluxo que hoje depende de gravar estados inconsistentes em transações separadas pode começar a receber erro. Triggers diferidos verificam o estado no fim da transação, mas não tornam atômicos vários requests HTTP separados.

## Pré-condições de publicação

1. Usar ambiente Supabase isolado com a mesma versão PostgreSQL, schema, RLS, triggers, extensões e migrações do destino. PGlite em schema mínimo não satisfaz esse requisito.
2. Não criar recursos pagos ou habilitar integrações externas. Fiscal e SSX ficam desativados; provedores são simulados.
3. Conciliar diferenças entre o histórico local e o remoto antes de `db reset`/aplicação. Não executar `db push` indiscriminadamente com todas as migrações pendentes.
4. Guardar definições, ACLs, hashes e relações atuais. A captura ampliada das quatro funções está em `TRIP-LOAD-ROLLOUT-CONTRACTS-2026-08-30.json`; a captura anterior de duas RPCs foi preservada. Preflight verifica hashes, permissões, trigger original e ausência dos objetos novos; divergência aborta a aplicação.
5. Revisar todos os escritores, inclusive planejamento/reatribuição e documentos/paradas. O ciclo carga → viagem foi reproduzido com `40P01` e corrigido nos cenários ensaiados: RPCs bloqueiam viagem → vínculos → cargas; triggers que já recebem filhos bloqueados usam NOWAIT e rejeitam conflitos com `40001`. Vinte ensaios nativos cobrem concorrência, invariantes e recuperação, mas não provam ausência universal de deadlocks.
6. Registrar versão anterior do frontend e o artefato candidato. Manter as assinaturas compatíveis e verificar clientes com bundle antigo.

## Matriz mínima de ensaio

| Cenário | Resultado obrigatório |
| --- | --- |
| Planejar sem iniciar | Sem carga marcada em trânsito; vínculos/espelhos consistentes |
| Iniciar pelo motorista e pela operação | Viagem, horário, cargas e auditoria coerentes na mesma transação |
| Dois inícios simultâneos | Uma partida efetiva; sem evento duplicado ou estado parcial |
| Hold concorrendo com início | Uma decisão serializada; nenhuma saída parcial |
| Atualizar carga antes da partida | Rejeição sem mutação de carga, viagem ou auditoria |
| Remover/mover o último vínculo | Rejeição ou reatribuição atômica válida, incluindo espelhos |
| Encerrar viagem e cargas na mesma transação | Aceito; nenhum falso bloqueio pelos triggers diferidos |
| Encerrar somente a viagem | Rejeição se houver carga em trânsito |
| Entrega parcial, recusa, retorno e falha | Estado final preservado; não transformar automaticamente tudo em entregue |
| Usuário de outro tenant/motorista | Rejeição sem acesso nem mutação cruzada |
| Repetição após perda de resposta | Mesmo resultado e histórico, sem nova partida |
| Dados antigos inconsistentes | Revisão explícita; não inventar `actual_start_at` nem regredir status por suposição |

Executar o pgTAP completo, testes de frontend/backend e os E2E críticos nas três larguras. Manter evidências de antes/depois e repetir smoke com contas operacionais e de motorista. Qualquer erro inesperado ou dependência de transação separada bloqueia publicação.

## Recuperação ensaiada localmente

1. Ao detectar regressão, interromper a promoção e bloquear somente as mutações afetadas; preservar dados e auditoria para diagnóstico.
2. Preferir migração corretiva forward-only. Não apagar registros de entrega, despesas, eventos ou horários para tornar um teste verde.
3. Se for indispensável retornar ao contrato anterior, revisar/aprovar o artefato `TRIP-LOAD-RECOVERY-2026-08-30.sql`. Ele remove somente os cinco triggers novos e os quatro helpers; restaura as quatro funções anteriores, comentários/permissões e o trigger de espelhamento original. Sem `CASCADE`, limpeza de linhas, revogação global ou rollback de outras migrações.
4. O script confere os oito hashes de funções da candidata, permissões e a estrutura dos seis triggers envolvidos antes de tocar no contrato. Versão desconhecida ou dependência imprevista aborta a transação inteira. Hashes são identificadores de texto normalizado (CRLF/LF), não mecanismos criptográficos de segurança.
5. ACLs restauradas: início para `authenticated`/`service_role`; transição somente `authenticated`; espelhamento e recálculo somente `service_role`, além do proprietário. Helpers novos permanecem privados durante uso da candidata.
6. Reverter frontend somente para artefato previamente validado e compatível; repetir smoke, contagens e reconciliação. Restaurar contrato antigo reabre limitações anteriores, portanto não constitui correção definitiva.
7. No PostgreSQL nativo 17.11, recuperação + verificação + reaplicação levaram 581 ms nesta fixture local. Esse tempo não estima duração em produção. Acerto pendente, itens/eventos financeiros, documentos, ocorrências e histórico permaneceram idênticos; nenhum pagamento foi gerado.

## Evidência disponível

- 37 testes PostgreSQL/PLpgSQL da candidata e 13 de aplicação/recuperação: **50 aprovados**.
- **20 ensaios nativos aprovados**, com conexões reais, triggers de espelhamento/duplicidade/recálculo e efeitos financeiros capturados da produção; ver `CONCORRENCIA-CARGA-VIAGEM-2026-08-30.md`.
- Frontend: 13 testes do hook de início, quatro da tela de cargas, seis do hook de transição e 12 dos contratos/respostas: **35 aprovados**. Incluem conflitos sem retry automático, atualização das consultas, resposta incerta e cliques duplicados.
- Os testes anteriores da carga 1003 em produção usaram RPCs publicadas e rollback, não a candidata. Nova consulta somente leitura confirmou viagem planejada, carga em trânsito e ausência de evidência de início em histórico/eventos; nenhum horário foi presumido.

Além da evidência nativa, a candidata foi executada contra o schema hospedado
em uma transação revertida e depois publicada como 20260831230903. A carga
1003 foi reconciliada separadamente como 20260831230957, sem criar
actual_start_at; o início e o replay autenticados passaram em nova transação
revertida. Consulta independente confirmou ready/planned, zero eventos
transitórios e zero violações globais. Reatribuição ampla com migração de
documentos/paradas ainda exige E2E operacional completo; isso não invalida o
contrato carga↔viagem já promovido.
