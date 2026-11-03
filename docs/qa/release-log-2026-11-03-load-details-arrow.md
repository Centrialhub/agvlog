# Log de release — acesso aos detalhes da carga, 03/11/2026

## Identidade e estado

- Responsável: Codex; usuário autorizou correção local, commit, push e publicação após resolver bloqueios nesta conversa.
- PR: https://github.com/Centrialhub/agvlog/pull/12 (o head identifica o candidato combinado).
- Base conferida no Git e no `/release.json` de `https://agvlogistica.vercel.app`: `9fc43eddef9a71f41179f4fc08035d172abf3a8a`.
- Correção inicial: `3988b405922d994dc3d00d19e05211c2d077978c`.
- Estado deste registro: preparação; resultados hospedados e identidade final serão registrados na PR antes da promoção.
- Destino existente: projeto Vercel `centrialhubs-projects/agvlogistica`, alias `agvlogistica.vercel.app`.
- Backend observado no release publicado: `https://qcvnsdrbcchaxvawcngk.supabase.co`.
- Postgres e Edge: nenhum SQL, migration, bundle ou configuração de serviços alterado por este release.

## Estado anterior e plano de retorno

A seta na lista era um SVG sem ação; número da carga e menu de detalhes já navegavam corretamente.
O candidato transforma a seta em botão com nome acessível, preservando o modo de seleção.
Retorno: restaurar o deployment Vercel anterior que contém a base acima. Não há alteração persistida a compensar.

O primeiro gate falhou na auditoria de dependências, antes de typecheck e banco/E2E:
https://github.com/Centrialhub/agvlog/actions/runs/41658225815 . Os oito shards passaram nesse SHA.
DOMPurify passou a 3.4.17, Zod a 4.6.7, resolver React Hook Form a 5.2.2 e Vitest/coverage a 4.1.12.
A migração de Zod explicita chaves de records e reconstrói objetos sem refinamentos somente nos locais que antes usavam `innerType()`;
preserva os refinamentos de negócio existentes nos schemas finais.

Os erros anteriores de TypeScript também exigiram corrigir o contrato de inserção de `workspace_id`
(derivado e conferido pelo trigger em `20260910132428_shared_master_data_foundation.sql`),
parâmetros SQL anuláveis, projeção de paradas offline, fixture de viagem e hints de relações PostgREST ambíguas.
Os tipos não substituem autorização: RLS, CAS e os triggers permanecem intactos.
Os casts existentes de RPC foram movidos para antes de `bind(supabase)` para evitar
instanciação excessiva do tipo genérico do SDK. O receiver continua vinculado;
os dois testes desse contrato agora executam as expressões transpiladas com um cliente sintético
(16 casos passaram), em vez de exigir uma única grafia de TypeScript. O detector global
agora reconhece casts antes do binding por AST e continua rejeitando calls destacadas e receiver incorreto.

O run `41661698848`, no candidato `ae89a66848b9837af541f1710c96b2c6e84e3241`,
aprovou `validate` (auditoria, tipos, lint, cobertura e build). Os shards identificaram
as diferenças de Zod 4 em UUIDs PostgreSQL sem versão RFC e records com enum esparsos.
Foram preservadas as regras anteriores usando `guid()` e `partialRecord`, respectivamente,
sem mudar os geradores de UUID ou reduzir assertions financeiras. Os testes focados de
comparação, paginação SQL, conciliação, intake e recuperação passaram (73 casos).
Uma comparação dos ASTs do JavaScript emitido confirmou 93 arquivos sem alteração de runtime após os ajustes de casts.

## Gates e evidências

| Verificação local | Resultado antes do push da revisão |
| --- | --- |
| `npm audit --audit-level=high` | Passou; achados moderados permanecem declarados pelo npm |
| `npm run lockfile:check` | Passou, incluindo os backports existentes |
| `npm run lint:errors` | Passou |
| `npm run lint:critical-types` | Passou |
| `npm run quality:baseline` | Passou: 99/113 avisos, sem novos arquivos acima de 500 linhas |
| `npm run build:check` | Passou: build, orçamento e inspeção do artefato público |
| Typecheck em Node 22 | Em execução; resultado final na PR |
| Testes sintéticos em Node 22/Vitest | Em execução; resultado final na PR |
| CI completo e banco/E2E | Exigir novo run do head da PR; não dispensados pelo build local |
| Smoke autenticado | Pendente; o preview inicial retornou HTML do Vercel ao consultar `/release.json` anonimamente |

## Linha do tempo (UTC)

- 2026-11-03 14:53: PR aberta; preview Vercel gerado.
- 2026-11-03 14:55: auditoria hospedada bloqueou o gate inicial.
- 2026-11-03 15:06: dependências atualizadas, auditoria alta/crítica, lint e build locais aprovados; demais validações em andamento.

## Orientação operacional após publicação

Entre em **Planejamento e cargas → Cargas**, localize a carga desejada e clique na **seta à direita**.
Os detalhes serão abertos diretamente. Número da carga e menu **⋮ → Abrir detalhes** continuam disponíveis.
Só anunciar disponibilidade depois de conferir o SHA no alias público.
