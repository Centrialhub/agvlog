# Hotfix de frete para emissão — 29/09/2026

## Pacote isolado

- Publicação solicitada pelo usuário para emissão imediata.
- Base: versão pública e `main` confirmadas em `17a7592dca01f31b1aa7b63340fbaf28bb116347`.
- Fonte da correção: diff de `4492eb78b454faaa9b11aabfaf81a060e92dfbb0`, aplicado sem conflitos; excluída a tipagem de teste de chat que pertence à outra branch.
- Escopo: 18 arquivos de frontend/testes de frete e pré-emissão. Sem migrações, Edge Functions, infraestrutura ou outras correções do PR #3.
- Retorno disponível: deployment `dpl_HSmXs2XdmKBJA6SxHEP15kosqzoo`, URL `agvlogistica-d1utmy01m-centrialhubs-projects.vercel.app`. Não apagar reservas fiscais ao retornar.

## Evidência

- 133 testes em 26 arquivos passaram na base isolada, início 14:06:09 UTC, duração 10,34 s, Node 22.23.2/npm 10.9.4. Usados URL local e chave fictícia para inicializar o SDK; consultas relevantes são simuladas. Primeira tentativa não tinha URL configurada e falhou ao inicializar um teste; repetição configurada passou.
- Regra confirmada: tabela pelo fornecedor/remetente da NF-e; destinatário separado para contexto de entrega. As correções da prévia preservam edição manual, sincronizam composição e conferem snapshot despachado com transporte simulado.
- Consultas somente de leitura confirmaram `cte_defaults_for_group(uuid[])` e `prepare_cte_issue(uuid,uuid,text,uuid[],jsonb)` existentes com EXECUTE para authenticated.
- As RPCs preexistentes `get_load_freight_context_v1`, `create_fiscal_document_with_freight_v1` e `update_fiscal_document_with_freight_v1` continuam ausentes em produção. Esse hotfix não restaura os outros fluxos dependentes dessas funções; sua recuperação pertence ao trabalho de estabilidade SQL.
- Smoke autenticado, emissão real e Quality gate completo não estão comprovados neste registro. O requisito de gate consta no AGENTS da branch de estabilidade. A promoção exige concluí-lo ou obter uma exceção explícita para este pacote emergencial.

## Estado

Pacote em preparação/validação, ainda não promovido. Registrar SHA final, deployment, testes e eventual exceção antes da promoção. Não usar o build local com configuração fictícia como artefato de produção; a Vercel deve reconstruir com as configurações do projeto.
