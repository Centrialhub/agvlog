# Privacidade do detalhe da entrega no portal

Estado: duas RPCs de leitura publicadas em 30/08/2026 11:52 UTC. Frontend correspondente ainda local. Isto não libera o aplicativo inteiro para produção.

## Defeito reproduzido

As duas versões do detalhe retornavam notas de `dispatch_events`, sem marcador público. Marcar a ocorrência como interna não removia uma nota paralela do histórico de parada. Uma ocorrência pública de outra nota/cliente na mesma parada também podia aparecer; o status público podia ser afetado por uma ocorrência de outra nota na mesma carga.

Cinco testes reproduzem esses comportamentos usando funções da migração baseline já versionada e dados inteiramente sintéticos. Não houve comprovação de acesso indevido histórico. A consulta de produção encontrou zero acessos ativos no portal no momento deste lote.

## Mudanças e compatibilidade

- `get_client_portal_shipment_detail(uuid)` conserva o contrato `events`, mas retorna array vazio. O canal público passa a ser somente a ocorrência explicitamente visível e corretamente relacionada.
- A versão v2 remove eventos internos da timeline e preserva marcos de documento, carga, início, chegada, saída e comprovantes.
- Escopo de ocorrência: nota explícita; ou, sem nota explícita, mesmo cliente e parada/carga compatíveis. Uma nota explicitamente diferente não é ampliada para a parada inteira.
- Seleção de parada considera a carga atual, relação canônica em registros legados, tenant e ordenação determinística. Pais e comprovantes são qualificados por tenant.
- Identidade ausente, documento excluído/inexistente e acesso não autorizado retornam a mesma negação. Helpers de autorização, permissões financeiras/contato e ACLs não foram alterados.
- Resposta adiciona `context` com ator, tenant e documento. É adição compatível com a página antiga. A nova página exige esse contexto, separa cache por sessão/empresa/documento, cancela consultas descartadas e só usa a versão anterior quando a RPC v2 está ausente (`PGRST202`). Negação, timeout ou falha de rede não provocam downgrade.
- A página local inclui estado de carregamento acessível e tentativa manual após falha. Não houve publicação de todo o frontend sujo, que depende de outras RPCs ainda ausentes em produção.

## Publicação e verificações

Migração: `supabase/migrations/20260830115234_harden_portal_shipment_detail_privacy.sql`. Guardas exigem cinco corpos anteriores conhecidos e ACLs esperadas das duas APIs; prazos de lock e execução de 3s/30s. Apenas os dois corpos de leitura são substituídos. Nenhuma tabela, linha de negócio, política RLS, configuração Auth, integração fiscal ou pagamento foi alterado pela migração.

| Função | Hash anterior | Hash publicado e confirmado |
| --- | --- | --- |
| Detalhe legado | `998fc3d8c047f0b944a9aa87dd33149c` | `600316cd5ffc139d090bad7da3a7ebc1` |
| Detalhe v2 | `d0c33a490f3eece9c4584191600092d4` | `7411ddff12475ee87930b317353db426` |

Pré/pós-publicação: execução negada a `anon`, mantida para `authenticated` e `service_role`. Três helpers de acesso/financeiro/download conservaram seus hashes. Assessores mantiveram 140 avisos de funções privilegiadas, três tabelas com RLS sem políticas e um aviso de proteção contra senhas vazadas; nenhuma redução desses avisos é alegada neste lote. [Orientação Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Teste pós-publicação no banco real, sob papel `authenticated` e identidade conhecida do motorista de teste, usando documento da carga 1012:

- Acesso viewer inserido somente dentro da transação do teste, com todas as capacidades sensíveis desabilitadas. Nenhuma conta Auth, sessão ou convite criado. O único trigger de usuário na tabela de acesso é de atualização de horário, sem trigger de INSERT.
- Duas leituras confirmaram contexto, vínculo atual carga/viagem/parada, campos financeiros/telefone/placa ocultos, ausência de eventos internos e escopo das ocorrências.
- As duas versões recusaram identidade ausente e, depois, acesso removido: seis cenários ao todo.
- Transação encerrada por `ROLLBACK`. Consulta independente confirmou zero vínculos de acesso do ator de teste, zero acessos ativos e helpers inalterados. Nenhuma permissão temporária ficou gravada.

Esse ensaio testa RPC/roles no banco hospedado; não representa login HTTP ou E2E autenticado no navegador.

Pós-deploy HTTP: os dois endpoints PostgREST recusaram requisições sem sessão com HTTP 401 / SQLSTATE 42501, sem exibir a chave pública no log. Os 46 testes específicos de SQL, tela e contenção passaram novamente após a aplicação e o alinhamento do nome local à versão remota.

## Ensaios locais

- 46 testes específicos: cinco reproduções do legado, 24 de SQL corrigido, 13 da página/hook reais integrados ao SQL local e quatro da contenção.
- Gate completo antes e novamente após a publicação: 1.501 testes em 132 arquivos, TypeScript, lint, baseline, sintaxe das 40 Edge Functions e build aprovados. Maior chunk 488,3 KiB; artefato público sem sourcemap/material secreto reconhecido. Diff final sem erros de whitespace.
- Cobertura somente do subconjunto configurado: 93,03% linhas/statements, 65,83% branches, 81,81% funções. Não extrapolar para o aplicativo inteiro.
- 141 testes PostgreSQL 17.11 nativos, incluindo oito novos do portal; cluster descartável encerrado. Os oito testes do portal usam um banco adicional dentro do mesmo cluster local, funções da baseline local e dados sintéticos, sem conexão de produção.
- Testes da tela simulam apenas transporte RPC/contexts/download; não equivalem a Auth, Storage e navegador reais. A fixture mínima não reproduz todo o schema/RLS hospedado.

## Contenção e limites

`docs/qa/PORTAL-DETAIL-CONTAINMENT-2026-08-30.sql` é uma contenção emergencial que exige hashes/ACLs publicados e deixa somente os dois detalhes temporariamente indisponíveis (`55000`), sem apagar dados. Não é rollback para a implementação vulnerável. Foi ensaiada em PGlite e PostgreSQL nativo, incluindo recusa diante de drift. Não foi executada em produção. Restauração funcional exige nova migração revisada a partir dos hashes contidos; não remover guardas para forçar reaplicação.

A revisão automática recusou exportar definições completas/metadados privados de produção para um arquivo de QA. O arquivo recusado não foi criado. A implementação e as fixtures usam exclusivamente os corpos já presentes na baseline local; este relatório guarda apenas evidências mínimas.

Pendências: publicação compatível do frontend; E2E autenticado; revisão dos outros endpoints/caches do portal; semântica histórica de comprovantes e horários na correção/reentrega. Não foi ligada a SSX, contratado serviço, enviado documento fiscal ou realizado pagamento.
