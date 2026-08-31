# Idempotência — leitura cruzada entre tenants corrigida

Estado: **publicado e verificado em produção** em 30/08/2026, 06:18 UTC.

## Achado confirmado

A política `agvlog_select_authenticated` de `public.idempotency_keys` comparava `tenant_id` com `idempotency_keys.tenant_id` dentro de uma subconsulta a `profiles`. A referência era à própria linha externa, não a um tenant autorizado do usuário. Existindo o perfil, a igualdade deixava passar chaves de outros tenants.

A reprodução local usou dois tenants e uma política de `profiles` restrita ao próprio usuário. Em produção, duas chaves sintéticas foram inseridas em transação; um operador sem membership no segundo tenant leu ambas, incluindo uma chave estrangeira ao seu tenant. A transação foi revertida e a consulta independente confirmou zero chaves persistidas.

Não havia chaves preexistentes na tabela naquele momento. Isso confirma a falha de autorização, **não** uma leitura histórica de dados reais por terceiros.

## Alteração publicada

Migração: `20260830061800_restrict_idempotency_key_read_scope.sql`.

- Apenas a expressão de uma política SELECT foi alterada.
- Leitura exige identidade autenticada e membership ativa como `owner`, `admin` ou `operator` no tenant da linha, via helper já existente.
- Grants da tabela, corpos/ACLs das três funções consumidoras e helper de autorização permaneceram idênticos.
- Nenhuma carga, viagem, parada, documento fiscal ou regra financeira foi alterada pelo deploy.
- Preflight rejeita política adicional, corpo inesperado, helper divergente ou RLS desabilitada; usa limites de espera/execução.

Hash da expressão anterior: `52dcb2b8b590a76089a38b21cebaf9c7`.
Hash da expressão publicada: `a5e2fc2cb8bbeb71640ea0bc13d8b3a8`.
Hashes identificam texto normalizado, não são mecanismos criptográficos de segurança.

## Pós-deploy real

O SQL ensaiado em `IDEMPOTENCY-RLS-POSTDEPLOY-PROBE-2026-08-30.sql` passou em produção às 06:18:32 UTC:

| Verificação | Resultado |
| --- | --- |
| Operador: chave do próprio tenant | 1 visível |
| Operador: chave do tenant sem membership | 0 visíveis |
| Papel authenticated sem subject | 0 visíveis |
| SELECT anônimo | Negado |
| Acesso backend service_role | Duas chaves visíveis |
| Replay da RPC real `plan_dispatch_trip_v3` | Mesmo ID nas duas chamadas |
| Hash de cargas, viagens e eventos | Inalterado |
| Consulta independente após rollback | Zero chaves, inclusive zero chaves QA |

O replay usou cache sintético apontando para uma viagem existente; **não despachou nova rota**. As chamadas SQL usaram papel `authenticated` e identidade de um operador existente. Isso não é login E2E pelo navegador.

Assessores antes/depois: 140 funções `SECURITY DEFINER` executáveis por `authenticated`, três tabelas com RLS sem políticas e proteção contra senhas vazadas pendente. Nenhum alerta novo. Busca posterior não encontrou outra política pública com esse mesmo padrão textual de referência correlacionada a `profiles`; não equivale a auditoria integral de RLS.

## Frontend e regressão

- **22 testes PostgreSQL/PGlite**: reprodução, isolamento, papéis, membership inativa/alterada, rejeição de escrita, serviço, consumidor real, preflight, recuperação e SQL exato do pós-deploy.
- **Cinco testes do hook React real de planejamento** com RPC simulada: despacho pelo contrato existente, ordenação de paradas, atualização das consultas, erro de autorização, ausência/troca de tenant. O frontend não lê a tabela de idempotência diretamente.
- Gate pré-deploy: **966 testes/94 arquivos**. Depois de acrescentar o ensaio do próprio SQL de verificação, gate pós-deploy: **967/94**, com TypeScript, lint, baseline, sintaxe das 40 Edge Functions, build, bundle e inspeção de artefato aprovados.
- Maior chunk: 488,3 KiB; limite configurado: 500 KiB. Nenhum frontend ou Edge Function foi publicado neste lote.
- Os 20 ensaios nativos de carga/viagem continuam como evidência da etapa anterior; não foram repetidos neste lote de RLS.

## Recuperação e limites

`IDEMPOTENCY-RLS-RECOVERY-2026-08-30.sql` foi ensaiado localmente: preserva registros e consumidores, restaura a expressão exata e permite reaplicar a correção. **Reabre a vulnerabilidade**; não é recuperação automática nem foi executado em produção. Preferir correção forward-only.

As definições de planejamento foram capturadas em `PLANNING-PREDEPLOYMENT-2026-08-30.json`. Permanecem pendentes: idempotência do caminho `dispatch_planned_route`, cobertura/duplicidade de documentos por parada, vínculo de veículo/motorista/cliente ao tenant, hold/estado de cargas e concorrência com alteração da composição. Esse lote de RLS não resolve esses contratos operacionais.

E2E autenticado continua pendente; `.env.test.local` não estava disponível na checagem desta etapa. Nenhum gasto adicional, transmissão fiscal ou ativação SSX foi realizado.
