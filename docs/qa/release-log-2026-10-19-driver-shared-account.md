# Log de release — conta única AGV/LIRA — 19/10/2026

## Identidade e estado

| Campo | Valor |
| --- | --- |
| Autor | CodexDriverShared; revisão de promoção pendente |
| Task | driver-shared-account-20261019, baseada em ea6dc9c36050fbb54e2dc7f1b63ed71007f7bb8d |
| Primeiro candidato | 8e6f32d25cc0130bc0e3056c1707380e84f86211; complemento de limpeza/segurança autorizado; SHA ampliado em recibo externo |
| Publicado | a90eb6ccdb5212ab4da9fe2cd48bbf4ad43d1c93, publicação DOT preservada |
| Produção Supabase | qcvnsdrbcchaxvawcngk; somente leitura nesta implementação |
| Build local | release 8e6f32d2; origem https://qcvnsdrbcchaxvawcngk.supabase.co; não é homologação isolada |
| Banco de teste | Postgres 17.6.1.165, container próprio agvlog-driver-shared-20261019, sem rede, fixture parcial sintética |
| Estado | Candidato local ampliado; gates integrados e homologação autenticada pendentes |

## Estado anterior e retorno

As quatro definições anteriores foram exportadas por leitura, sem dados pessoais,
em `src/test/helpers/driverSharedAccountProductionBefore.json`. Seus MD5 foram
reconfirmados em produção às 17:42 UTC: attach `6e6a6cd983ce9ebe27d0c4b8c31c9ed0`,
enforce `fe9013b16fc8a550e293c717263c9fa8`, guard
`e613a1e24ffcf2a56dbb57f18ebfd9be`, prepare
`0264bdd2a49e56d97e1ffb7af6a82319`. A função nova não existe no alvo.
O mesmo check confirmou 46 cadastros ativos e zero vínculos com contas.

A migration candidata `20261019171216` tem SHA256
`cea89c8dc330ebda889224e44936e8a09dcc41e0f9ea8f6ae85fcd01bf873aae`.
Ela preserva assinaturas, owners, ACL e RLS; não faz backfill nem cria cadastros.
A Edge `manage-driver-access` permanece inalterada. O frontend acrescenta somente
o seletor de empresa do motorista. O retorno exige restaurar as quatro funções
após conferir predecessores e suspender novas criações durante a operação;
preservar vínculos/credenciais compartilhados já criados. Não restaurar banco ou
Storage nem apagar históricos. O retorno ainda precisa de homologação integral.

## Contrato e risco

Criação em qualquer empresa usa a pessoa canônica do workspace e uma UUID Auth
nos cadastros ativos existentes. Exige administrador ativo em todas as empresas
destinatárias. Não usa similaridade de nomes/CPF e não cruza workspaces. A reserva
privada é consumida na transação Auth; guards continuam recusando vínculos diretos.
O seletor aguarda contexto assinado e volta para /driver.

Riscos principais: triggers/Auth, concorrência e isolamento do contexto. A limpeza
administrativa do teste precisa evitar reprojeção de campos: a exclusão comum por
FK alterou nomes divergentes na fixture. O procedimento sintético passou usando
`session_replication_role=replica` apenas na transação de limpeza, para uma UUID
exata sem histórico próprio, com detach explícito e verificação de invariantes.
Isso não é uma capacidade de exclusão oferecida ao motorista nem altera guards.
Em produção, antes de qualquer limpeza, conferir UUID, dependências e histórico;
não generalizar esse procedimento para contas com operações reais.

## Gates e evidências

Artefatos locais em `F:/AGVLOG/checks/driver-shared-*`.

| Verificação | Resultado |
| --- | --- |
| Coordenação | 11/11 testes passaram; reconciliação preservou fonte DOT/publicação e as 110 tarefas anteriores |
| Lockfile / higiene / release / baseline | Passaram; 761 migrations, 50 Edge, 13+13+17 forwards revisados |
| Pipeline | 213 passaram, zero falhas, um skip preexistente (214 testes) |
| Typecheck / lint errors / tipos críticos / qualidade | Passaram; warnings existentes não são declaração de lint integral limpo |
| Edge syntax | 110/110 passaram |
| Cobertura crítica | 53 testes passaram; statements 87,81%, branches 74,78%, functions 93,93%, lines 91,35% |
| Build/budget/artefato | Passaram no primeiro candidato; sem sourcemaps ou material secreto reconhecido |
| Focados finais | 15/15 passaram, incluindo criação pelos dois lados, reserva adulterada, ACL, isolamento, limpeza e recriação |
| Postgres nativo | Criação pelos dois lados, limpeza preservando registros e duas conexões concorrentes passaram |
| Suíte geral | Inicial: 8811 passaram, uma falha de expectativa antiga de scanner e um skip. Após alinhamento à política DOT: 8825 passaram, zero falhas e um skip; gates no SHA final ainda exigidos |
| Security audit | Inicial falhou com seis high. Após correções autorizadas: passou, zero high/critical e cinco moderate; sem reduzir o gate |
| database-and-e2e | Não executado para este candidato; grafo parcial nativo não substitui baseline integral/GoTrue |
| Paridade/homologação/produção | Pendentes; nenhuma mutation SQL ou publicação realizada |

O audit inclui node-forge 1.4.0 sem versão corrigida segundo
[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv),
e a cadeia de braces segundo
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
Thomaz autorizou corrigir dependências e o leitor fiscal em 19/10. Os backports
privados, hashes, testes negativos, runtime Edge e limites estão em
[dependency-security-backports-2026-10-19.md](dependency-security-backports-2026-10-19.md).
Não foi aplicado `audit fix --force`, alterado o backport aprovado de seletor ou
enfraquecido o gate. Não houve emissão fiscal.

## Matriz do fluxo solicitado

| Fluxo | Local | Autenticado em staging/produção |
| --- | --- | --- |
| Criar pela AGV | Passou SQL/triggers | Pendente |
| Criar pela LIRA | Passou SQL/triggers | Pendente |
| Uma identidade/dois vínculos | Passou SQL/triggers | Pendente |
| Recusar concorrência e duplicata | Passou, incluindo MVCC nativo | Pendente |
| Login real e AGV → LIRA → AGV | Seletor passou com mocks de contexto | Pendente |
| Limpar teste e liberar cadastros | Passou com rotina administrativa sintética | Pendente |
| Preservar cadastros/histórico | Invariantes locais passaram; produção 46 ativos/zero contas por leitura | Pendente após promoção |

## Decisão

Manter produção intacta enquanto o Quality gate obrigatório não passa. Não há
aceite de publicação, janela de observação produtiva nem exceção de segurança
registrada. A auditoria das dependências corrigidas passou; os gates restantes e
a homologação em runtime exclusivo precisam concluir antes de afirmar que o fluxo
completo passou. Resultados finais serão vinculados ao SHA em recibo externo.
