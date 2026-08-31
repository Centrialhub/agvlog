# Torre de Controle — contratos de leitura e ações explícitas

Estado: correções locais com gate amplo **aprovado; não publicadas**. Nenhum serviço pago ou SSX ativado.

## Evidência e reprodução

- `get_active_trips_live` usa `row_to_jsonb`, inexistente no PostgreSQL: erro reproduzido no PGlite com corpo extraído da baseline. O filtro legado também exclui `in_transit`.
- O rascunho `20260830005603_close_authenticated_security_definer_surface.sql` revogava dois leitores ainda consumidos por `useActiveTripsLive` e `/operations-control`. A negação de execução foi reproduzida; essas duas revogações foram removidas. Isso **não conclui a auditoria das demais assinaturas** do rascunho.
- Cálculo em lote tratava uma Promise resolvida com `{error}` como sucesso. O detalhe aceitava `{data:{error},error:null}`. As duas interfaces agora exigem confirmação `ok:true` e ausência de erro de transporte.
- A seleção do detalhe guardava um objeto antigo, deixando paradas/cargas desatualizadas após refetch. Agora guarda somente o ID e deriva o objeto dos resultados atuais.
- O reavaliador podia sobrescrever `no_signal` com `stopped`, fechar ocorrências manuais e ignorar falhas SQL. Esses caminhos foram corrigidos/testados.

## Conferência restrita de produção, somente leitura

Projeto `qcvnsdrbcchaxvawcngk`, consulta realizada em 30/08/2026 à noite em São Paulo. Foram consultados apenas metadados dos dois leitores, **sem exportar registros operacionais**.

| Leitor | MD5 do corpo em produção e na baseline local | Estado atual em produção |
| --- | --- | --- |
| `get_active_trips_live(uuid)` | `ef1370f47b1f64c9f2fa81d6e6cbef6f` | SECURITY DEFINER, search_path public, contém row_to_jsonb, não contém in_transit |
| `get_open_trip_alerts(uuid)` | `492f1282e3266f34c7425daad12c48f1` | SECURITY DEFINER, search_path public |

Ambas negam `anon`, permitem `authenticated` e `service_role`. Os hashes idênticos ligam a reprodução local ao código atualmente publicado; a consulta não executou as RPCs com uma sessão de usuário em produção.

Consulta complementar restrita confirmou `row_to_jsonb_exists=false` no catálogo e **zero tenants com SSX efetivamente habilitado** (flag enabled sem kill switch). Nenhuma definição de função, credencial ou linha operacional foi exportada.

Advisors atuais: 140 avisos de funções privilegiadas, 1 aviso de proteção contra senhas vazadas e 3 informações de tabelas com RLS sem políticas. Os advisors de produção não validam uma migração que ainda não foi publicada. Referências: [funções privilegiadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [RLS sem políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Implementação local

- Migração criada pelo CLI: `20260831021458_reconcile_control_tower_read_contracts.sql`. Dois leitores SECURITY INVOKER, search_path vazio, papel/tenant/MFA explícitos, execução concedida somente a `authenticated`. RLS continua efetivo dentro da função; nenhuma política de tabela foi aberta para fazê-la funcionar.
- `in_transit` e compatibilidade com estados legados de viagem; cargas descobertas pela relação canônica `dispatch_trip_loads`, sem depender de `dispatch_trips.load_id`. Documentos contados por ID fiscal distinto, não por linhas de mercadoria.
- Vínculos de veículo, motorista, carga e parada exigem mesmo tenant mesmo quando o operador participa de duas empresas. Paradas e resultados são lidos diretamente da operação.
- Leitura diferencia viagem não iniciada, rastreamento desativado, ausência de sinal recente e avaliação ainda não calculada. Posição futura, inválida ou com mais de 15 minutos não vira marcador atual. Idade usa o instante da consulta, não o início de uma transação longa. Não houve alteração de horários históricos.
- Contratos de frontend validam os retornos, empresa, duplicidade de viagem e coordenadas. Consultas têm ator no cache e sinal de cancelamento. Erros ocultam os dados anteriores e não aparecem como lista vazia ou ausência de alertas.
- Textos da placa são escapados antes da inclusão no HTML do marcador Leaflet. Botões de atualizar/tela cheia têm nomes acessíveis.
- Consulta automática não dispara mais escrita oculta. Reavaliação é explícita e bloqueada no frontend e na Edge com SSX desligado. Ela usa somente posições já recebidas; não consulta o provedor SSX.
- Edge verifica usuário, membership ativa, papel e AAL2 de owner/admin. Leituras/escritas operacionais usam JWT do usuário e RLS; service_role fica restrito à guarda de capacidade. Cálculo de rota revalida acesso após a chamada ao roteador, antes de persistir.
- Reavaliador inclui trânsito canônico, não avalia viagens planejadas como se estivessem em movimento, preserva alertas manuais e propaga erros de banco.

## Testes

**76 testes focados / 8 arquivos aprovados**, incluindo 46 novos:

- 2 reproduções do legado;
- 19 cenários dos leitores SQL: autorização, MFA, RLS, tenant, estados, documentos e qualidade temporal da posição;
- 7 cenários da página real → hooks reais → validadores → SQL: detalhe atualizado, perda de acesso, dados de outra empresa, falhas de cálculo e SSX desativado;
- 12 cenários dos handlers Edge reais → transporte local → SQL com papel do usuário: capacidade, MFA, reavaliação, alertas manuais, falhas de persistência e revogação após roteamento;
- 6 testes dos contratos de confirmação e escape HTML;
- 11 regressões existentes de hardening e preparação SSX.
- 19 testes existentes de configuração de produção, incluindo o contrato corrigido de inventário/JWT/MFA.

O teste de tela substitui Auth/Tenant por contexto de teste e o mapa por um componente sem rede; os hooks de leitura e SQL não são mocks. O teste Edge substitui o transporte Supabase/Auth por um adaptador delimitado e o roteador externo por fixture; handlers, guarda de capacidade e autorização SQL são reais. As políticas internas e colunas/defaults são extraídas da baseline; MFA vem da candidata de restauração. Não é E2E de Auth/PostgREST/Storage hospedados nem verificação visual do mapa.

Houve falhas de infraestrutura de teste corrigidas (Blob do JSDOM, espaços de seleção no adaptador, contadores e tipo de retorno). Um teste adicional do retorno após reavaliação expôs referência temporal ao início de transação; o leitor passou a usar `statement_timestamp`. Nenhuma asserção de negócio foi removida.

Primeiro gate amplo: 2.530 testes aprovados e 1 falha / 214 arquivos, 381,26 s; tipos, lint, qualidade e 42 sintaxes Edge já aprovados. A única falha era uma expectativa antiga de 30 handlers com service_role; a remoção dessa credencial do cálculo de rota reduziu o inventário a 29. Esse teste também exigia ausência de MFA, contrariando a restauração de owner/admin. Ele foi substituído por inventário explícito e asserções de JWT/MFA nos dois fluxos da Torre; não se declara auditoria completa dos demais handlers. O hash dos **1.051 arquivos** ficou idêntico antes/depois desse primeiro gate: `184748fad0419b7245d0cf4938b68982b34d4b98a784881e3b03423aa3f76883`.

Último conjunto focado: **76/76**, 9,78 s; lint dirigido anterior sem warnings. **Segundo gate completo aprovado: 2.531 testes / 214 arquivos**, tipos, lint de erros/crítico, baseline de qualidade, 42 sintaxes Edge, build e scanner público; processo encerrado com código zero. Testes em 381,05 s; build em 20,63 s. Qualidade: 98/113 avisos explicit-any, sem novo arquivo acima de 500 linhas. Maior chunk 488,3 KiB; entrada 375,7 KiB. Scanner não encontrou sourcemaps nem material secreto reconhecido.

Hash dos **1.051 arquivos idêntico antes/depois** do gate final: `cccec90281c5b0ee12729f9c43d63fae8ad6959edab0a289a5771942dcf93638`. Escopo: src, scripts, funções/migrações/testes SQL e configurações de raiz selecionadas; documentos não entram no hash. Nenhum fonte/teste foi editado durante esse gate. A cobertura configurada mede somente cinco arquivos lib: 93,03% linhas/statements, 65,83% branches, 81,81% funções; **não** a aplicação inteira.

## Limites e próximos critérios de aceite

1. Concluir concorrência dos escritores de rastreamento e rota: status/alertas ainda são múltiplas operações HTTP; falta transação por viagem, revisão esperada e teste multissessão contra duplicidade de alerta aberto e replanejamento durante cálculo. A baseline possui apenas PK de `trip_alerts`, não unicidade por alerta aberto.
   - Invalidar/reavaliar métricas derivadas também quando mudar a parada, o veículo ou a rota sem chegar uma nova posição. A lista operacional usa paradas atuais, mas o estado calculado precisa de revisão vinculada ao mesmo contexto.
2. Completar origem/waypoints de rota: impedir uso de posição antiga e omissão silenciosa de paradas sem coordenadas, validar mudança de veículo/paradas durante a chamada e ensaiar resposta incerta. Nenhuma chamada real ao roteador foi realizada.
3. Preparar ligação da ingestão SSX à reavaliação idempotente e recuperação, sem exigir ação manual quando a integração for reativada. A ação explícita permite operar/verificar o cálculo, mas **não substitui a automação de reintegração solicitada**. Manter a integração inativa enquanto isso.
   - Leitura adicional durante o gate: `ssx-poll-positions/updatePositionsLast` consulta `captured_at`, compara em JavaScript e executa upsert separado. Falta reprodução multissessão e gravação condicional atômica por veículo; a comparação isolada não prova monotonicidade sob concorrência. O pipeline chama `agvlog-compute-state` e a fila, mas a busca de consumidores não encontrou encadeamento para `update-trip-live-status`. Nenhuma alteração nesses arquivos nem chamada SSX foi realizada neste bloco.
4. Preflight real de grants/RLS, MFA e consumidores externos de service_role; publicação coordenada banco/Edge/frontend e contenção/retomada ensaiadas. Não restaurar o leitor legado quebrado como estratégia de recuperação. O rascunho geral de revogações não deve ser publicado integralmente sem auditoria individual restante.
5. Rodar cenário autenticado motorista → chegada/baixa/ocorrência → operação → cliente e regressão dos módulos interligados no ambiente publicado. O navegador suportado e a autenticação administrativa ainda têm bloqueios documentados nos checkpoints anteriores; não foram contornados.
6. Não houve novo ensaio PostgreSQL nativo neste bloco; os 290 ensaios anteriores permanecem históricos. Não houve alteração de produção, emissão fiscal, pagamento, ativação SSX ou contratação de serviço.

As skills de Supabase/PostgreSQL orientaram privilégios mínimos e verificação com RLS; React orientou derivar a seleção atual em vez de conservar cópias antigas. Orientação oficial consultada: [funções de banco](https://supabase.com/docs/guides/database/functions).
