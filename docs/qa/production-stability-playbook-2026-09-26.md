# Roteiro de estabilidade e promoção

Estado em 26/09/2026: este roteiro descreve o candidato no [PR #3 em draft](https://github.com/Centrialhub/agvlog/pull/3), criado a partir do publicado `17a7592d`. O segundo Quality gate usou `05685fbce16e0b84aa42a35e34596d2c30bafea8`; confira o SHA atual na aba Commits antes de executar qualquer gate. As correções do candidato ainda não foram publicadas. O [log desta rodada](production-stability-log-2026-09-26.md) registra as evidências e pendências. Para releases seguintes, crie um log novo a partir do [template](release-log-template.md).

## Quatro estados que precisam coincidir

| Camada | Identidade a registrar | Situação observada |
| --- | --- | --- |
| Git | SHA do commit e diff do PR | `origin/main` e frontend publicado em `17a7592d`; segundo run do PR #3 em `05685fbc`, com SHA atual a conferir no PR antes do gate. |
| Postgres/Supabase | Versões em `supabase_migrations.schema_migrations`, assinaturas, grants e RLS | 896 versões aplicadas no início da auditoria. Há migrações publicadas sob timestamps diferentes dos arquivos Git. |
| Edge Functions | Nome, versão e hash do bundle publicado | Funções SSX/rastreamento foram publicadas em 24/09, após o frontend; a correspondência com o candidato precisa ser verificada antes de nova promoção. |
| Vercel | URL imutável, SHA embutido, alias promovido | O alias `agvlogistica.vercel.app` servia o deployment `dpl_HSmXs2XdmKBJA6SxHEP15kosqzoo`, SHA `17a7592d`. Preview `dpl_8Wjiez3LJwKHntXu89Zza6ou1RL1` do SHA `05685fbc` está `READY`, porém protegido por SSO. |

Um build verde confirma apenas o código que foi testado. A liberação exige verificar o contrato entre essas quatro camadas, com a ordem **migrações → contratos no banco → Edge → frontend → smoke**. Não usar `supabase db push` enquanto a paridade com o banco alvo estiver bloqueada.

## Invariantes de release

1. Cada alteração publicada tem um SHA e uma lista fechada de migrações, Edge Functions e artefatos Vercel. O log de release registra as versões antes e depois.
2. Uma migração com versão menor ou igual à última aplicada no banco só entra após reconciliação explícita do histórico. Nome igual não prova SQL igual. O [preflight de paridade](migration-parity-preflight-2026-09-26.md) falha nessas condições.
3. Cada chamada `.rpc()` do bundle publicado existe no banco alvo com assinatura, `EXECUTE`, `search_path`, autorização e semântica de tenant verificados. O inventário por nome é uma triagem, não substitui esses contratos.
4. Um fluxo crítico passa por teste de contrato SQL, teste da interface e smoke autenticado contra o mesmo candidato. Casos de erro, repetição e isolamento entre empresas entram no teste.
5. Uma correção de produção permanece no Git com a versão aplicada. Migrações antigas não podem sobrescrever seus efeitos; o grant de geofence é o caso bloqueador já identificado.
6. O plano de retorno inclui o deployment Vercel anterior, os bundles Edge anteriores e uma compensação SQL revisada quando houver mudança de banco. Dados e migrações aplicadas não são revertidos por trocar o frontend.
7. Nenhum resultado é marcado como aprovado sem comando, ambiente, SHA, horário UTC e link ou artefato de evidência. Testes usam dados sintéticos ou agregados; não registrar dados pessoais ou financeiros reais.

## Matriz mínima dos fluxos críticos

| Fluxo | Contrato a provar no mesmo candidato | Evidência mínima |
| --- | --- | --- |
| Importação CSV/XML | Colunas e valores entre aspas, vírgula decimal, paletes inteiros, erro por linha, criação sem duplicata | Fixture com CSV brasileiro e XML; teste do parser; importação pela interface e conferência agregada no banco. |
| Fiscal CT-e/NF-e | RPCs de contexto/criação/atualização de frete, permissões, cálculo e repetição; documentos visíveis no Portal por tipo e empresa | Testes SQL e interface; emissão de teste em staging; leitura no Portal; ausência de acesso cruzado. |
| Financeiro | Seleção em lote atualiza com o saldo autoritativo; revisão antes de liquidar; reembolso e carteira não aceitam snapshot antigo | Testes de mudança concorrente e pagamento parcial; smoke autenticado com valores sintéticos; conciliação da posição final. |
| Portal do cliente | Listas v2, MDF-e, ocorrência criar/responder, cancelamento de coleta e escopo de cliente/empresa | RPCs com grants/RLS; listas paginadas; comandos autorizados/negados; testes end to end com dois clientes. |
| Estoque e operação | Saldos, movimentos, criação idempotente, exclusão CAS de item, rotas e produtividade | Testes SQL de concorrência/repetição, paginação e interface; contagens antes/depois. |
| Equipe e incidentes | Convites, troca de papel, acesso Portal e SELECT de RH restrito ao responsável/autorizado | Testes de concorrência e RLS para operador, admin, responsável e outro tenant. |
| SSX, endereços e rastreamento | RPC de candidatos, dedupe de POI, grant de geofence, retry de sync, checkpoints, métricas e revisão de conflitos | Contratos Edge↔DB, `service_role` autorizado e clientes negados, ciclo completo e replay sem duplicata, logs de execução. |

## Gates, na ordem

1. **PR e análise local.** Fixar o SHA; revisar o diff, migrações e dependências. Executar `npm ci`, `npm run lockfile:check`, `npm run repository:check`, `npm run supabase:release:check`, `npm run test:pipeline`, `npm run typecheck`, `npm run lint:errors`, `npm run edge:syntax` e `npm run build:check`. `supabase:release:check` valida nomes e configuração local; ele não lê a produção.
2. **Quality gate do PR.** Exigir `validate`, os oito jobs `unit-tests` (`npm run test -- --shard=i/8`) e `database-and-e2e` verdes no GitHub. Este último deve verificar banco isolado, lint, contratos, pgTAP e Playwright antes da promoção. A cobertura focada usa as sete suítes listadas em `.github/workflows/quality.yml`. O [segundo run do PR #3](https://github.com/Centrialhub/agvlog/actions/runs/36267255499) passou em `validate` e nos oito shards, mas o replay falhou em `20260830061800`. O [terceiro run](https://github.com/Centrialhub/agvlog/actions/runs/36268506604) chegou a `20260830062933` e provou uma dependência impossível da função/trigger criados apenas em 31/08. Requer baseline verificável de banco para substituir o replay cronológico inválido no CI.
3. **Staging.** Criar um banco de staging com histórico reconciliado e dados sintéticos, publicar nele as migrações candidatas, depois Edge e frontend imutável. Executar `release-candidate.yml`, smoke autenticado e a matriz acima. A conta Supabase conectada mostra somente produção/branch `main`; no GitHub há apenas ambientes `Preview` e `Production`, e o workflow `release-candidate.yml` não teve execuções. Comprovar a disponibilidade dos três secrets `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_PUBLISHABLE_KEY` e `STAGING_E2E_PASSWORD`, das contas sintéticas e do acesso ao Preview Vercel protegido por SSO. O bundle Vite é configurado no build; confirmar que o Preview aponta para staging antes do smoke.
4. **Paridade do banco alvo.** Injetar `AGVLOG_RELEASE_DB_URL` como segredo do job protegido e executar `npm run supabase:parity:check` imediatamente antes de qualquer replay ou `db push`. O script lê apenas o ledger de migrações e falha sem credencial. Hoje ele deve bloquear produção por versões retroativas e aliases; não contornar o erro com `migration repair` automático.
5. **Promoção.** Registrar backup/ponto de retorno, SHA, ledger e versões Edge/Vercel anteriores. Aplicar somente o lote SQL revisado e aprovado, conferir assinaturas/grants/RLS, publicar Edge dependentes, promover o deployment Vercel e executar smoke autenticado de importação, fiscal, financeiro, Portal, estoque, equipe e SSX. Registrar tempos, contagens e erros por fluxo.
6. **Observação e retorno.** Observar filas, falhas RPC/Edge, erros de interface e registros de CI durante uma janela definida pelo responsável pelo release. Se um critério crítico falhar, parar a promoção, restaurar o deployment e bundles Edge anteriores e executar apenas a compensação SQL previamente testada. Registrar o resultado no log.

## Responsabilidade pela evidência

| Papel no release | Registro exigido |
| --- | --- |
| Autor da correção | Arquivos alterados, hipótese, contrato restaurado, testes executados e resultados. |
| Revisor de banco | Comparação do ledger no alvo, SQL e dependências, assinaturas/grants/RLS, plano de compensação. |
| Responsável por CI/release | SHA, URL imutável, links dos jobs, versões Edge, output de paridade e ordem de promoção. |
| Operação/produto | Resultado dos fluxos reais no candidato, horário, conta de teste e decisão de liberar ou retornar, sem dados pessoais nos logs. |

## Bloqueios conhecidos em 26/09

- O banco publicado ainda não tem 19 nomes de RPC chamados pelo frontend/Edge do commit publicado. O worktree contém migrações candidatas para restaurá-los; publicação e smoke não ocorreram.
- Foram encontrados 413 nomes de migração sob versões diferentes na comparação inicial. A migração local `20260916152615_finalize_geofence_automation` pode revogar o grant corrigido pelo hotfix publicado `20260924124326`; o replay está bloqueado.
- Não há staging visível na conta Supabase conectada. O ambiente GitHub `release-candidate` não aparece entre os ambientes, o workflow ainda não foi executado e a presença dos secrets referenciados não pôde ser verificada. O Preview Vercel do SHA `05685fbc` está `READY`, mas redireciona GET público para SSO; acesso automatizado e destino Supabase do bundle não estão comprovados.
- O gate de paridade não recebeu `AGVLOG_RELEASE_DB_URL` neste host. Na comparação com o banco publicado há 440 versões apenas no ledger live, 560 locais retroativas e 413 aliases por nome/timestamp; qualquer replay em produção exige reconciliação revisada. Não usar `db push` nesse estado.
- O segundo Quality gate passou em `validate` e oito shards, mas o replay falhou em `20260830061800`. O terceiro run demonstrou que `20260830062933` exige função/trigger criados só em `20260831230903`, que exige sua ausência antes da criação. O replay histórico não é um gate executável nesse estado. Os patches experimentais em preflights históricos foram retirados; é necessário um baseline confiável e um novo run de banco/E2E. O contrato fiscal hospedado, os fluxos integrados e o retorno ainda não foram executados.

Até que esses bloqueios sejam resolvidos e documentados, o estado do candidato é **não publicável**.
