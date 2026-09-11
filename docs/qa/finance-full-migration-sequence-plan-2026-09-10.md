# Ensaio integral de migrations — plano e preflight 2026-09-10

## Resultado executado

**Ensaio integral ainda não passou.** PostgreSQL 17.11 descartável, handle 83907, exit 1 intencional de preflight; servidor encerrado. **0 de 259 migrations tentadas**, todas explicitamente `not_attempted`. Não é falha comprovada de SQL do produto e não autoriza deployment.

Manifesto integral: `docs/qa/finance-full-migration-sequence-manifest-2026-09-10.json`. Registra cada arquivo, bytes, SHA256 e estado; não filtra por nome financeiro nem limita quantidade. Hash da sequência ordenada: `6cbf6a2ef1b880dfaaf9b682f99ba864f50f159e62a9a00f87490d1548649221`.

Harness: `scripts/test-full-migration-sequence-native.mjs`, selector central `finance-full-sequence`. Log: `node_modules/.cache/qa-postgres/finance-full-migration-sequence-native-2026-09-10.log`. Executa somente banco novo do servidor local criado pelo runner; não aceita URL remota.

## Impedimento comprovado

A baseline 20260824224152 exige postgis, pg_net, pg_cron e supabase_vault, ausentes de `pg_available_extensions` no runtime instalado. Também faltam auth.users/auth.uid(), storage.objects/storage.buckets e papéis anon/authenticated/service_role. A baseline representa o schema do aplicativo; depende do bootstrap Supabase, não cria uma plataforma Supabase do zero.

CLI disponível pelo caminho `node_modules/.bin/supabase`, versão 2.116.0. A consulta local `status` retorna Docker e Podman indisponíveis. Docker Desktop não encontrado no caminho padrão; WSL informa não instalado. Não foram baixados binários, instalado runtime ou tocado remoto.

O harness para no preflight e não remove CREATE EXTENSION, funções, triggers, FKs, ACLs ou arquivos para obter sucesso. Fixtures anteriores exercitam SQL real em grafos reduzidos; não substituem este ensaio.

## Plano executável da baseline completa

1. Em workspace descartável com Docker/Podman e CLI do lockfile, congelar a lista integral de migrations e hashes. O manifesto atual deve ser regenerado se algum arquivo mudar; mudanças durante execução são falha.
2. Executar o caminho já definido em `.github/workflows/quality.yml`: `node_modules/.bin/supabase start`, depois `node_modules/.bin/supabase db reset --local`. Isso instala bootstrap real, baseline integral, migrations ordenadas e seed. Não usar `--linked` nem URL de produção.
3. Registrar saída completa, versão do PostgreSQL/extensões e cada versão aplicada. Comparar a lista aplicada com os 259 arquivos do manifesto, sem interpretar ausência de erro como contagem conferida. Parar no primeiro erro e identificar arquivo/linha/SQLSTATE; corrigir produto apenas com coordenação do autor.
4. Executar `node_modules/.bin/supabase db lint --local --level error`, `supabase/verify/baseline_contract.sql` via psql local e `node_modules/.bin/supabase test db`, conforme workflow existente. Registrar falhas e hashes; não limitar testes para simular aprovação global.
5. Sobre o schema integral aprovado, sem substituir funções ou retirar FKs, adicionar dados sintéticos para smoke financeiro: movimento, lote, pagável, folha/acerto, recebível/fiscal, extrato/abertura/cobertura e reversões. Os fixtures estreitos atuais devem ser adaptados para **semear**, não reinstalar definições sobre o schema completo.
6. Encerrar a stack descartável e preservar logs/manifestos/resultados. O runner PG puro serve ao preflight estrito atual; mudar PG_QA_BIN sozinho não cria Auth/Storage, portanto não resolve o impedimento.

O harness contém aplicação sequencial integral quando todos os pré-requisitos reais estão presentes em banco novo. Ele não é substituto do bootstrap oficial. Timeouts do runner são falhas explícitas, nunca itens pulados. A aplicação completa não foi alcançada nesta máquina.

## Diferença para a implantação no banco existente

Segundo leitura remota comunicada pelo coordenador (não realizada por esta frente), o projeto possui **406 versões históricas**, de 20260306135129 a 20260909221751; extensões postgis 3.3.7, pg_cron 1.6.4, pg_net 0.20.0 e vault 0.3.1. As novas tabelas e RPCs financeiras consultadas estavam ausentes. A baseline local consolida histórico: seus **259 arquivos não equivalem à lista remota de 406**.

Não aplicar baseline no banco remoto existente. Não presumir que versão ausente local está pendente no remoto, nem que `latest` remoto prova execução dos bytes atuais de uma migration local. Antes de implantação, construir mapa entre versões históricas aplicadas, baseline consolidada, arquivos posteriores e definições efetivas do catálogo. Versões iguais com conteúdo divergente precisam resolução explícita. Ensaio de banco vazio prova apenas instalação fresca; upgrade deve ser ensaiado também em clone descartável com catálogo/histórico representativos, respeitando privacidade e autorização.

## Conflitos entre frentes

Nenhum conflito de execução SQL entre migrations foi demonstrado por este preflight, pois parou antes da baseline. Os conflitos de **ordem de fixture** observados em outra suite (crédito fiscal11121 antes da projeção24438; inventário/auditoria após24438) foram corrigidos somente no harness daquela suite e não provam defeito da sequência cronológica completa. Não houve edição de migrations de outras frentes.
