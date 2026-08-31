# Saída física da parada — publicação e verificação

Estado: **RPC publicada e verificada; ajustes da tela ainda locais**.

## Publicação

- Migração aplicada: `20260830042313_harden_driver_stop_departure` em 30/08/2026 04:23 UTC. O arquivo local foi alinhado à versão remota para não publicar novamente.
- A assinatura `driver_register_departure(uuid,text) returns uuid` foi preservada. Execução continua autorizada para `authenticated` e `service_role`, negada a `anon`/`PUBLIC`; identidade de motorista ativo e posse da viagem são verificadas no corpo.
- Antes: hash `5cc34d5bc716417299f3ab437e75a2f6`. Depois: `ab0127d42b7d7a4c17bc2ad24127f0b5`. A migração aborta se encontrar contrato diferente do capturado e limita espera de locks a três segundos.
- Contratos originais em `STOP-WRITERS-PREDEPLOYMENT-2026-08-30.json`. Recuperação `DEPARTURE-RECOVERY-2026-08-30.sql` ensaiada localmente: restaurou hash/ACL sem excluir eventos. **Não executada em produção**; reabriria os defeitos antigos.

## Regra corrigida

- Nova saída exige viagem iniciada, chegada registrada e parada em `arrived`/`servicing`, com horários coerentes.
- Bloqueio viagem → parada, revalidando posse e vínculo após esperar. O teste concorrente também cobre reatribuição do motorista durante a espera.
- Repetir a saída retorna o mesmo evento/horário, sem nova auditoria. Alterar observações de uma saída já registrada exige outra ocorrência; não há sobrescrita silenciosa.
- Eventos/horários históricos inconsistentes não são reparados inventando timestamps.
- Saída é um evento físico: **não altera status da carga, nota fiscal, viagem ou parada para entregue/concluído**.

## Evidência no banco publicado

Usada a parada `d66535db-7cdb-46a9-8172-bd205722a5af` da viagem da carga 1012. Todas as escritas abaixo ocorreram em transações revertidas, com papel PostgreSQL `authenticated` e identidade do motorista atribuído. Isso testa o papel/autorização no banco, não login JWT ponta a ponta.

Antes da publicação, a função antiga aceitou saída com chegada nula e gerou **dois eventos** para duas chamadas iguais. Consulta independente após rollback confirmou zero eventos QA e estado original restaurado.

Após a publicação:

- Saída sem chegada recusada (`23514`).
- Saída válida e replay retornaram o mesmo ID; exatamente **um evento e uma auditoria** dentro da transação.
- Observação diferente recusada (`23505`).
- Identidade não atribuída e execução anônima recusadas (`42501`).
- Parada permaneceu `arrived`; carga e viagem permaneceram `in_transit`. O horário de saída de teste foi posterior à chegada.
- Após rollback, consulta independente confirmou **zero eventos/auditorias QA**, saída novamente nula, chegada e `updated_at` originais. Viagem preservou início `2026-08-29T19:04:08.982315+00:00` e `updated_at` original.
- Assessores: **140** funções privilegiadas executáveis por `authenticated`, três tabelas RLS sem políticas e proteção contra senhas vazadas pendente — sem novos alertas nesta substituição. A revisão individual restante continua necessária. [Orientação Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Frontend e regressão

- `DriverStops` local consulta por motorista/tenant, trata erros PostgREST legíveis e espera a resolução do motorista.
- Chegada disponível para `pending`, `planned` e `arriving`; ações de chegada/saída bloqueadas antes do início real.
- Após saída registrada, mostra confirmação e remove o botão de nova saída. Oferece acesso à entrega com a viagem correta e esclarece que saída não conclui a entrega.
- Removido o ramo sem chamador que enviava resultados finais por `driver_update_stop_status`; baixa e comprovantes seguem pela tela própria.
- **27 testes** PostgreSQL/PLpgSQL de saída e **11 testes** da tela renderizada aprovados. A fixture mínima não substitui toda a pilha Supabase.
- **Oito cenários multissessão** aprovados em PostgreSQL nativo 17.11, incluindo três de saída; sobreposição comprovada por `pg_blocking_pids()`. Servidor temporário encerrado ao fim.
- Gate antes e depois da publicação: **864 testes em 87 arquivos**, TypeScript, lint, baseline, 40 Edge Functions e build/inspeção pública aprovados. Maior chunk: 488,3 KiB. Cobertura configurada não é cobertura de todo o aplicativo.
- Browser integrado falhou na inicialização. Alternativa gratuita em Chrome isolado abriu `/driver/stops`, redirecionou para `/auth`, exibiu Email/Senha/Entrar e não registrou erro de página. Captura `departure-postdeploy-auth-2026-08-30.png` inspecionada; navegador encerrado. **Smoke anônimo, não E2E autenticado**.

## Próximas dependências

1. Separar derivação privada das novas entregas da função legada `derive_trip_and_load_status_v1`; separar os wrappers de corte legado da migração aditiva. `transition_stop_status_v1` é o chamador legado conhecido; não foram encontrados outros chamadores no frontend, Edges ou corpos das demais funções em produção.
2. Resolver transições carga/viagem e locks de alocação, com recovery e ensaios que incluam mirrors/constraints reais.
3. Concluir fila recuperável, anexos e respostas da operação, GPS/PostGIS, fiscal, revisão de privilégios e rollout coordenado do frontend.
4. Executar E2E autenticado motorista → operação → portal. `.env.test.local` com a conta de QA ainda não estava disponível na checagem desta etapa.

Nenhum gasto adicional, emissão fiscal, alteração de credencial fiscal ou ativação SSX foi feito neste lote. A prontidão integral de produção permanece **não demonstrada**.
