# F05 — download fiscal autorizado do motorista — 2026-10-06

## Identidade e estado

Responsável: CodexFiscalF05. Task `driver-fiscal-file-f05-20261006`, worktree `F:/AGVLOG/work/driver-fiscal-file-f05-20261006`. Base de revisão: `61adbbb997667396541244da147b224defb22e94`, tree `328f33f69c352720574b24deebaa9d19bde7faaf`. A integração confirmou a adoção desta base e a reserva pelo coordenador; o checkout criado inicialmente sobre deda foi preservado e reconciliado pela integração antes das edições. Fonte congelada, AGENTS, índice do Vault e réplica do revisor não editados.

Estado: correção local preparada; sem enqueue/integrate, push/deploy, SQL aplicado, credenciais produtivas ou serviços externos. Commit/tree final e evidência do reteste no SHA constam no pacote de handoff externo à árvore, para evitar auto-referência de SHA. Este log não aprova publicação.

## Estado anterior e contrato corrigido

F05 é indisponibilidade, sem vazamento confirmado. `DriverLoadNotes` abria diretamente o `pdf_url/xml_url` retornado pela RPC, incluindo o endpoint privado `hub_documents_file`; a navegação não transportava autenticação Hub. O proxy geral continua restrito e byte-idêntico à base.

Agora a UI faz POST autenticado à nova Edge `driver-fiscal-file`, solicitando somente tenant/carga/kind/id local/format. A Edge verifica usuário via Auth e contexto de tenant assinado + header; chama `driver_get_load_fiscal_file` com JWT do motorista, sem service_role para autorização de carga/documento. A RPC existente preserva motorista e membership ativos, tenant, atribuição/carga/documento, estados fiscais, PDF/XML e rejeição de acesso cruzado. Nenhuma migration, grant ou RLS foi alterado.

Para URL privada Hub: GET somente no path exato configurado `/hub_documents_file?id=...&kind=pdf|xml`; id/format vêm do resultado autorizado, não do browser. Antes da autenticação upstream exige vínculo único e congruente local-documento→emissão Hub→emitente→tenant→ambiente, e credencial habilitada de escopo exato ou `all` no mesmo ambiente. Reutiliza o mecanismo existente de ciphertext/secret server-only, sem chave global de fallback. Emitente inativo com documento já vinculado mantém a mesma regra de leitura histórica do proxy existente; existência/binding continuam obrigatórios.

Revalida usuário, RPC, kill switch e credencial/binding após I/O antes de liberar bytes. Desabilitação da credencial ou troca de emitente durante o fetch descarta o arquivo. URLs, chaves e erros brutos upstream não entram em resposta/log. A chave só acompanha o GET exato do Hub no header servidor. Redirecionamentos são recusados, sem emissão, entrega on-demand, refresh fiscal ou escrita.

XML inline autorizado continua disponível sem acesso ao Hub. PDF/XML retornam bytes validados, MIME fixo, filename sanitizado, `Cache-Control: private, no-store` e `nosniff`. Limite de arquivo 10 MiB, leitura upstream com teto de wire para base64 e timeout 15 s incluindo corpo. JSON upstream pode conter base64 ou URL de storage; URL só é consumida no servidor de origem explicitamente permitida e SEM credencial Hub. Resposta binária que acidentalmente ecoe a credencial também é recusada.

A UI usa apenas JWT do usuário em header para a Edge; nunca recebe token Hub ou navega à URL do provedor. Timeout 35 s; valida bytes/MIME/filename; descarta respostas por alteração de ator/tenant/carga/sessão; cancela ao trocar contexto ou desmontar. Downloads usam Blob URL local, revogada imediatamente após o clique. Erro de transporte é finito e visível, com botão disponível para nova tentativa.

## Dependências, limites e ordem de instalação futura

1. RPC `driver_get_load_fiscal_file(uuid,uuid,text,uuid,text)` e helper privado da migration `20260902004250_add_driver_fiscal_file_reader.sql` existentes no alvo, com assinatura/grants/isolamento reconciliados. A migration histórica não foi editada.
2. `assert_tenant_integration_capability_v1`, política fiscal enabled/kill-switch e contexto assinado já existentes. Guard service-only é executado por admin somente após autorização do motorista. Não ampliar grants para driver.
3. Nova Edge e stanza `verify_jwt=true` antes do frontend. Import map da nova função segue pin `@supabase/supabase-js@2.108.2` já usado pelo proxy, sem alteração do lockfile/dependências gerais.
4. Credenciais, encryption key, Hub base/API-version/CORS no servidor, correspondência de tenant/emitente/ambiente e vínculo único de emissão/cache id local. Sem binding disponível, falha fechada com `FILE_CREDENTIAL_UNAVAILABLE`; reconciliar vínculo, nunca escolher primeiro emitente/tenant.
5. Para URLs de storage retornadas pelo Hub ou URLs externas armazenadas, configurar `AGVLOG_DRIVER_FISCAL_FILE_ORIGINS` com origens HTTPS exatas separadas por vírgula, aprovadas pela operação. Default vazio: bloqueado. Não aceitar origem do browser. Não definir domínio global/wildcard. Não encaminhar token Hub. URLs contendo parâmetros explícitos de credencial permanente são recusadas.
6. Homologação autorizada do GET cache e formatos reais ainda pendente. Nenhuma alteração no FiscalHub externo necessária para este delta; se GET/cache/binding externo exigir mudança, apresentar plano mínimo antes de ampliar escopo.

Não foram usados Auth/Hub reais. Fixtures de Auth/client DB/transporte da nova Edge são mocks locais; verificação criptográfica real do JWT/CORS no gateway Deno, catálogo completo/baseline Supabase, dados reais, semântica externa Hub e navegador nativo não são comprovados por essas fixtures. A suíte SQL existente executa a RPC e RLS reais em PGlite com schema/seed sintéticos parciais, não na réplica. Expiração é validada via getUser/gateway; Auth signOut não garante invalidação instantânea de JWT já emitido até sua expiração. Esta correção preserva esse limite existente e revalida revogação operacional driver/membership/carga em toda requisição. Bytes já baixados não podem ser revogados retroativamente; nenhuma URL reutilizável ou grant persistente novo é criado.

## Verificação local

Ambiente: Windows, Node v24.19.0, dependências copiadas para node_modules próprio da fonte61ad sem modificar a fonte; versões do lockfile preservadas. Repo requer Node22/npm10.9.4: repetição no runtime oficial e quality gate completo permanecem com integração/revisor.

- Quatro suítes focadas: `driverFiscalFileTransport.test.ts`, `driverFiscalFileDownload.test.ts`, `driverLoadFiscalCatalogFrontend.test.tsx`, `driverLoadFiscalCatalogDatabase.test.ts`: 67 testes PASS na rodada completa após correções; pacote de handoff registra rodada final no SHA.
- Typecheck global: PASS. Edge syntax: 105/105 arquivos PASS. ESLint delta com `--max-warnings 0`: PASS. Supabase release contract: 744 migrations, 50 funções PASS, sem aplicação.
- Negativas: outro tenant/carga/documento/ator, anonymous/expired, forged tenant header, proxy action/URL/token extras, revogação durante fetch, credencial desabilitada/ambiente/escopo/emitente divergente/ambiguidade/ciphertext inválido, kill switch, Hub401/403/404/503/redirect, timeout/rede, HTML/JSON/não-PDF, arquivos grandes, token ecoado, origem não permitida e troca de contexto UI. Fixtures são CT-e329 sintético PDF/XML e XML NFS-e sintético, sem arquivos reais.
- Build e scanners públicos: resultado final e limitações no pacote de handoff. Quality gate completo/CI/Supabase gateway/Hub real/UX nativa não executados nesta frente.

## Retorno e preservação

Sem dados novos ou schema/grants persistentes. Retorno futuro: restaurar componente e remover nova Edge/configuração mediante coordenação; o comportamento antigo volta a sofrer F05 para URLs Hub privadas, portanto não alegar retorno funcional aprovado. Nenhum mecanismo de emissão foi alterado; shared helpers e proxy permanecem na base. Nunca fazer deploy de todas as funções sem reconciliação.

O congelamento da frente é commit local com árvore limpa, delta e hashes, sem novas edições após entrega. Coordenador não oferece comando standalone freeze: status da task continua working/reservada até integração registrar congelamento; isso não autoriza editar durante revisão nem enfileirar.
