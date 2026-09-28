# Roteiro de estabilidade e promoção

Atualização de infraestrutura em 28/09: a alternativa autorizada é a [homologação local em Linux/WSL](local-staging-guide.md), com [log próprio](release-log-2026-09-28-local-staging.md). O baseline foi restaurado, [comparado por objeto](local-baseline-comparison-2026-09-28.md) e os [13 forwards foram aplicados localmente](local-forward-evidence-2026-09-28.json). O contrato de segurança identificou oito funções internas com EXECUTE anônimo; fixtures e testes também precisam acompanhar workspace e tenant atuais. Correções e testes funcionais estão em andamento. Essa decisão substitui a espera por aprovação de custo de uma branch Supabase Cloud citada no histórico abaixo.

Estado em 26/09/2026: este roteiro descreve o candidato no [PR #3 em draft](https://github.com/Centrialhub/agvlog/pull/3), criado a partir do publicado `17a7592d`. Confira o SHA atual na aba Commits antes de executar qualquer gate; resultados de um SHA anterior não aprovam automaticamente um novo diff. As correções do candidato ainda não foram publicadas. O [log desta rodada](production-stability-log-2026-09-26.md) registra as evidências e pendências. Para releases seguintes, crie um log novo a partir do [template](release-log-template.md).

## Por que as regressões reaparecem

A auditoria identificou causas concretas: frontend chama RPCs ausentes no banco publicado; o histórico Git difere do ledger SQL; hotfixes publicados podem ser sobrescritos por arquivos históricos; testes de navegação não comprovam gravação nem saldo; seleção financeira e importação tinham casos reais não cobertos. Não foi identificada uma causa única para todas as falhas relatadas. Cada incidente precisa vincular sintoma, versão, reprodução e causa confirmada antes da correção.

O trabalho futuro deve começar pelo contrato publicado e terminar com evidência do mesmo fluxo no ambiente final. Mudanças pequenas por contrato, testes que reproduzem o defeito e publicação coordenada entre banco, Edge e frontend reduzem as oportunidades de regressão.

O ensaio de 28/09 acrescentou uma causa verificável: testes de paginação financeira conferiam trechos do arquivo SQL e chamadas simuladas, mas não executavam a RPC publicada. O lint do banco restaurado identificou uma referência a `ordinal` sem o alias correspondente e uma expansão JSON inválida no ajuste de paletes. Testes desse tipo podem passar enquanto a operação falha. Para alterações SQL, exigir reprodução antes da correção e execução real depois, preservando autorização e verificando os efeitos; cobertura de texto ou mocks serve apenas como evidência complementar.

## Quatro estados que precisam coincidir

| Camada | Identidade a registrar | Situação observada |
| --- | --- | --- |
| Git | SHA do commit e diff do PR | `origin/main` e frontend publicado em `17a7592d` na auditoria; conferir o SHA atual do PR e seus runs no log antes do gate. |
| Postgres/Supabase | Versões em `supabase_migrations.schema_migrations`, assinaturas, grants e RLS | 896 versões aplicadas no início da auditoria. Há migrações publicadas sob timestamps diferentes dos arquivos Git. |
| Edge Functions | Nome, versão e hash do bundle publicado | Funções SSX/rastreamento foram publicadas em 24/09, após o frontend; a correspondência com o candidato precisa ser verificada antes de nova promoção. |
| Vercel | URL imutável, SHA embutido, alias promovido | O alias `agvlogistica.vercel.app` servia o deployment `dpl_HSmXs2XdmKBJA6SxHEP15kosqzoo`, SHA `17a7592d`. O Preview de `db49a29d` estava `READY`, porém `/` redirecionava para SSO; identidade em `release.json` foi consultada pelo conector. |

Um build verde confirma apenas o código que foi testado. A liberação exige verificar o contrato entre essas quatro camadas, com a ordem **migrações → contratos no banco → Edge → frontend → smoke**. Não usar `supabase db push` enquanto a paridade com o banco alvo estiver bloqueada. O replay cronológico atual do CI não é válido; a [proposta de baseline verificável](migration-baseline-plan-2026-09-26.md) descreve um caminho de teste isolado, ainda não executado.

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

Na auditoria de 26/09, os nove testes então selecionados por `@critical` cobriam principalmente autenticação, navegação, leitura, isolamento e argumentos inválidos. Os dois casos owner/admin foram depois corrigidos e incluídos na seleção crítica; continuam sendo testes de acesso. A seed desativa fiscal e SSX. Abrir essas telas com a integração desativada não aprova emissão, importação, liquidação ou sincronização. Cada linha da matriz só passa quando sua ação e o efeito persistido forem demonstrados; testes ignorados ou sem ambiente ficam **pendentes**. Fixtures alteradas por testes devem ser isoladas por execução, ou repostas de modo controlado no staging; repetir a suíte sobre estado residual não é evidência de repetibilidade.

A jornada do motorista cria despesa e chat imutáveis e altera a viagem compartilhada do seed. O checklist candidato foi corrigido e exercitado contra o RPC em PGlite, mas a jornada completa ainda não tem limpeza autenticada segura. Não contornar triggers nem mudar grants para limpar testes. É necessário banco exclusivo descartável por tentativa, ou provisionamento completo de entidades independentes com ciclo de vida comprovado. Não executar reset de um banco usado por outros workers. O workflow hospedado atual roda a suíte completa sem comprovar esse isolamento; permanece bloqueado para esse uso.

## Critério para declarar uma versão estável

- Nenhum defeito aberto que bloqueie autenticação, uso de um fluxo crítico, isolamento entre empresas ou integridade de dados/saldos; cada defeito bloqueador tem reprodução e teste de regressão.
- Todos os gates abaixo verdes para o mesmo SHA e backend, com evidência de gravação, erro e repetição dos fluxos da matriz. Uma integração indisponível mantém o fluxo correspondente pendente.
- Retorno ensaiado em staging, com limites explícitos para dados e efeitos externos. Emissão fiscal real não é usada como fixture; usar homologação suportada pelo provedor e dados sintéticos.
- Versões verificadas após promoção e janela de observação registrada antes do release. Critério inicial proposto: 24 horas incluindo um ciclo operacional representativo, sem nova falha bloqueadora e com filas/retries concluindo no prazo acordado. Se não houver volume representativo, ampliar a janela e registrar o motivo.

Esse critério mede o estado observado e os fluxos exercitados; não promete ausência de qualquer bug. O status permanece bloqueado enquanto faltar uma evidência obrigatória.

## Registro que acompanha cada mudança

Antes de editar, registrar no log do release o contrato atual, a reprodução e os fluxos que compartilham a regra. Depois, acrescentar o diff, os testes executados com resultado real, o ambiente e os riscos restantes. Corrigir um erro anterior no log por uma nova entrada que o referencie; preservar a linha do tempo.

Para falhas de execução, registrar horário UTC, ambiente, SHA/deployment, versão Edge/SQL, fluxo/operação, identificador de correlação, status HTTP/SQLSTATE, duração, contagens antes/depois e link para evidência sanitizada. Não registrar senhas, JWTs, XML completo, corpo de requisições com dados pessoais ou valores financeiros de clientes. HTTP 200 isolado não basta: respostas parciais e erros de negócio também exigem acompanhamento. O roteiro define o padrão; a cobertura dessa instrumentação na aplicação ainda precisa ser inventariada.

## Gates, na ordem

1. **PR e análise local.** Fixar o SHA; revisar o diff, migrações e dependências. Executar `npm ci`, `npm run lockfile:check`, `npm run repository:check`, `npm run supabase:release:check`, `npm run test:pipeline`, `npm run typecheck`, `npm run lint:errors`, `npm run edge:syntax` e `npm run build:check`. `supabase:release:check` valida nomes e configuração local; ele não lê a produção.
2. **Quality gate do PR.** Exigir `validate`, os oito jobs `unit-tests` (`npm run test -- --shard=i/8`) e `database-and-e2e` verdes no GitHub. Este último deve verificar banco isolado, lint, contratos, pgTAP e Playwright antes da promoção. A cobertura focada usa as sete suítes listadas em `.github/workflows/quality.yml`. O [segundo run do PR #3](https://github.com/Centrialhub/agvlog/actions/runs/36267255499) passou em `validate` e nos oito shards, mas o replay falhou em `20260830061800`. O [terceiro run](https://github.com/Centrialhub/agvlog/actions/runs/36268506604) chegou a `20260830062933` e provou uma dependência impossível da função/trigger criados apenas em 31/08. Requer baseline verificável de banco para substituir o replay cronológico inválido no CI.
3. **Staging.** Criar um banco de staging com histórico reconciliado e dados sintéticos; comparar seu catálogo com o live usando a [proposta de baseline](migration-baseline-plan-2026-09-26.md) antes dos forwards. Publicar nele as migrações candidatas, depois Edge e frontend imutável. Executar `release-candidate.yml`, smoke autenticado e a matriz acima. Configurar o ambiente GitHub e a restrição de branches conforme o [guia do teste hospedado](release-candidate-environment-guard.md), com os secrets `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_PUBLISHABLE_KEY`, `STAGING_E2E_PASSWORD` e `VERCEL_AUTOMATION_BYPASS_SECRET`. O bypass só pode ir ao host imutável aprovado. O bundle Vite é configurado no build: `release.json.supabaseOrigin` deve coincidir com a URL de staging no runner; smoke e setup E2E bloqueiam divergência antes de Auth. O workflow atualizado só entra em vigor após sua incorporação à branch principal. O staging e esses secrets ainda não estão configurados nesta rodada.
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
- `ssx-sync-rule-violations` v13 também foi reconciliado. O patch candidato reconhece 429 com corpo não JSON, bloqueia consultas quando o cursor não pode ser lido e respeita `Retry-After` entre o mínimo de 15 minutos e o limite de 24 horas do helper. A v13 literal não entende o novo formato `rate_limited:<segundos>`; restaurá-la diretamente pode liberar consultas cedo demais. O [pacote de retorno compatível](ssx-violations-compatible-rollback-2026-09-26.md) foi preparado com fonte fixada e testes locais do handler gerado, mas ainda exige ensaio em staging e conferência da versão ativa. A função continua sem exclusão mútua entre chamadas simultâneas antes do primeiro registro de cooldown.
- Os bundles `ssx-sync-governance` v14, `agvlog-pipeline-run` v153 e `ssx-sync-units` v146 foram comparados por arquivo, conforme [registro de reconciliação](edge-reconciliation-2026-09-26.json). O candidato preserva os checkpoints publicados e explicita os patches para bloquear governança após descoberta inválida e rejeitar o falso sucesso também na chamada direta de sincronização. Isso não prova paridade das demais funções ou funcionamento hospedado. Não usar publicação em lote para sincronizar esse checkout. As fontes históricas desses três bundles estão preservadas em [snapshots versionados com geração isolada](edge-bundle-recovery-2026-09-26.md); recuperar os arquivos não aprova o retorno e pode reintroduzir defeitos conhecidos. A API SSX pode omitir o código exigido para regras compatíveis; a origem de uma identidade válida para as 16 unidades ativas permanece pendente. A candidata mantém a falha visível e não inventa códigos a partir dos rótulos. O cache recente após uma falha de identidade preserva o erro e o intervalo existente, sem repetir automaticamente a consulta ao provedor dentro desse intervalo.
- Foram encontrados 413 nomes de migração sob versões diferentes na comparação inicial. A migração local `20260916152615_finalize_geofence_automation` pode revogar o grant corrigido pelo hotfix publicado `20260924124326`; o replay está bloqueado.
- O responsável confirmou que não existe staging. Sua criação aguarda a confirmação do custo informado pela API Supabase. O ambiente GitHub `release-candidate` não aparece entre os ambientes, o workflow ainda não foi executado e a presença dos secrets referenciados não pôde ser verificada. O último Preview inspecionado, do SHA `db49a29d`, estava `READY`, mas redirecionava a interface para SSO; acesso automatizado e destino Supabase de um candidato hospedado ainda não estão comprovados.
- O gate de paridade não recebeu `AGVLOG_RELEASE_DB_URL` neste host. Na comparação com o banco publicado há 440 versões apenas no ledger live, 560 locais retroativas e 413 aliases por nome/timestamp; qualquer replay em produção exige reconciliação revisada. Não usar `db push` nesse estado.
- O segundo Quality gate passou em `validate` e oito shards, mas o replay falhou em `20260830061800`. O terceiro run demonstrou que `20260830062933` exige função/trigger criados só em `20260831230903`, que exige sua ausência antes da criação. O quarto run, com os preflights originais restaurados, passou novamente em `validate` e oito shards, mas confirmou a falha inicial do banco. O replay histórico não é um gate executável nesse estado. É necessário o [baseline confiável proposto](migration-baseline-plan-2026-09-26.md) e um novo run de banco/E2E. O contrato fiscal hospedado, os fluxos integrados e o retorno ainda não foram executados.

Até que esses bloqueios sejam resolvidos e documentados, o estado do candidato é **não publicável**.
