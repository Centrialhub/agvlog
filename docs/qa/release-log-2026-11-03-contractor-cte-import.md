# Release — importação do CT-e da contratante

## Escopo final autorizado e candidato de publicação

O usuário decidiu explicitamente em 03/11/2026: **liberar a importação e deixar a emissão de subcontratação pendente**. O restante deste registro preserva o histórico da preparação. O candidato final adiciona importação XML/PDF/DACTE, revisão manual de PDF, lista por empresa/chave e download do original. Não altera builders, reserva, numeração, transmissão fiscal, frete ou financeiro.

Persistência candidata: migration incremental `20261103174106_import_contractor_cte_sources.sql`, tabela `contractor_cte_sources`, RPC `register_contractor_cte_source_v1(uuid,jsonb,text,integer,text)` e bucket privado `contractor-cte-originals`. RLS exige empresa ativa e membership operacional owner/admin/operator. Sem leitura de anon/motorista, alteração/exclusão pelo navegador ou substituição de originais. Cadastro só confirma após verificar objeto, tamanho e MIME no Storage. Repetição idêntica retorna o mesmo ID; conflito de conteúdo/metadados é recusado. XML e PDF da mesma chave podem coexistir como dois originais.

Os arquivos são recebidos como originais privados e não executados. A validação de extensão/assinatura e o hash no cliente não constituem antivírus, validação de assinatura XML nem consulta à SEFAZ. Download confere bytes/hash com o registro recebido. Arquivo enviado sem confirmação de cadastro pode permanecer órfão privado; não se exclui automaticamente após erro ambíguo, para não apagar um cadastro confirmado no servidor.

O CI restaura primeiro seu baseline/forwards congelados e aplica **somente a nova migration** no PostgreSQL descartável em `127.0.0.1:55322`. Os manifests e lotes congelados permanecem intocados. E2E novo usa arquivos sintéticos, compara o download, recarrega a página, chama a RPC simultaneamente e verifica bloqueio de outra empresa e motorista. Nenhuma emissão fiscal faz parte desses testes.

Validação local até a preparação do PR: TypeScript, lint dos arquivos novos e 30 testes focados passaram; seis cenários E2E foram descobertos em desktop/tablet/mobile. CI completo, execução nativa integrada e publicação seguem pendentes até suas evidências no PR. O build/lint global em execução terá o resultado registrado no PR.

Dependência deliberadamente fora deste release: em `ThomazNT/Fiscal-hub`, SHA `e344ba3e4886c113e3b242c65dba0ce9d459e9f3`, `normalizeCteBusinessPayload` fixa `tpServ_26='0'` e o catálogo comum não inclui `docAnt`. O painel dessa conta redireciona ao inventário com apenas AGV LOG ao tentar o projeto `rvgcsmuyvesusbxsqevr`. Não foram alterados repo/deploy/credenciais do Hub. A interface informa que a emissão/vínculo automático de subcontratação continua pendente.

Retorno: promover o frontend anterior `638f863284b3aee4098a69209ee9970901f80a82`, mantendo tabela e originais privados preservados. O release é aditivo e não muda os formatos consumidos pelo frontend anterior. Não remover dados, bucket ou histórico para retornar a interface. Se for necessário conter novas gravações, revisar uma revogação específica da RPC e uma política restritiva de INSERT apenas no bucket novo.

Não executar `db push` nem replay histórico no alvo público. Após CI completo verde, reconferir ledger e dependências, aplicar apenas o SQL incremental revisado em transação, registrar versão/SQL no ledger, conferir grants/RLS e então promover o frontend. Nenhuma Edge Function será publicada neste release.

Orientação operacional após disponibilidade verificada: abra **Planejamento e cargas → Importação de documentos → CT-e da contratante**, selecione XML ou PDF/DACTE de até 10 MB e confira os dados. No PDF, preencha os campos e marque a conferência. Clique **Importar CT-e de origem** e aguarde a confirmação. Use a busca por chave e **Baixar original** para consultar. A emissão/vínculo na subcontratação será liberada separadamente.

## Histórico da preparação inicial (anterior à implementação da persistência)

O primeiro run `41688230044` recusou o arquivo novo no inventário fechado antes dos gates de aplicação. Foi adicionado `contractor-cte-release-manifest.json`, separado dos três manifests preservados e vinculado ao hash do suplemento anterior e aos bytes da única migration nova. A verificação admite essa adição apenas após validar a identidade/hash; as migrações desconhecidas continuam recusadas. O plano de restauração permanece com 46 forwards; a migration de CT-e roda em etapa posterior e isolada. Os 50 testes focados de integridade dos manifests passaram; pipeline completo: 233 passaram, um skip preexistente, zero falhas.

A revisão posterior alinhou também a forma JSON no servidor (chaves fechadas, tipos e endereço), com 33 testes focados aprovados. O SQL candidato continua não aplicado ao banco público; hash final desta revisão: `59a2a1cf643ef5d8f643ead9abedc90cc3a92900af32f36ad07365ffba8ea82d`. A revisão anterior `06d6f164` aprovou `validate` no run `41688817858`; um novo run deve aprovar o head final antes da entrega.

Preflight de produção pelo painel em 03/11/2026: ledger com 942 versões, maior `20261021144313`; versão nova, schema de cadastro, RPC e bucket ainda ausentes. O ledger aceita `version`, `statements[]` e `name`, permitindo registrar atomicamente o único SQL aplicado. Nenhuma aplicação pública ocorreu nesse preflight.

## Identidade e estado

- Branch: `feat/import-contractor-cte-20261103`.
- Base: `638f863284b3aee4098a69209ee9970901f80a82`, release anterior conferido no alias público.
- Responsável: Codex. Pedido: importar XML e PDF/DACTE para vínculo posterior ao CT-e de subcontratação.
- Estado: preparação local; funcionalidade incompleta, sem publicação.
- Backend esperado: `qcvnsdrbcchaxvawcngk`. A listagem do conector em 03/11/2026 contém somente `irptozxzfxlpcuhlilap` (Centrialhub). O usuário informou que conectará a conta do AGVLog.

## Contrato e limites deste candidato

Leitor XML com namespace CT-e, identidade modelo 57 e dígito verificador, consistência de chave/emitente/número/série e protocolo declarado no arquivo. Isso não valida assinatura digital nem consulta situação atual na SEFAZ.

Componente de revisão independente, ainda sem montagem na página de importação. PDF/DACTE requer preenchimento e conferência manual; não há OCR nem autorização fiscal presumida. A chave deriva CNPJ, número e série. O original é entregue ao callback de persistência e o sucesso depende da confirmação desse callback. Alterações de empresa/ator limpam a revisão.

Não existe persistência neste delta: nenhum bucket, tabela, RPC, migration ou Edge Function foi alterado. Não registrar estes documentos como NF-e recebida ou CT-e próprio emitido. O contrato efetivo do Hub para subcontratação ainda precisa ser conferido antes de alterar o payload fiscal.

## Gates e evidências locais

- TypeScript: `tsc --noEmit -p tsconfig.app.json` em Node 22 passou.
- Testes sintéticos: `contractorCteXml.test.ts` e `ContractorCteReview.test.tsx`; 18 casos passaram.
- Lint dos quatro arquivos: passou sem erros ou avisos.
- Persistência, permissões, isolamento no banco, concorrência, staging, CI completo e smoke: pendentes; testes do parser/interface não substituem esses gates.
- Nenhuma emissão fiscal, real ou de teste, foi executada.

## Trabalho restante antes da entrega

1. Acessar o projeto correto e conferir contratos, esquema, RLS e versões efetivas sem alterar outros serviços.
2. Implementar armazenamento privado e metadados por empresa, confirmação durável e deduplicação; testar nativamente permissões, repetição, concorrência e isolamento.
3. Montar o fluxo na importação e selecionar o documento salvo na subcontratação, conferindo o contrato real do Hub e preservando reserva/idempotência da emissão.
4. Completar os gates do roteiro de estabilidade, publicar na ordem necessária e conferir o SHA no alias Vercel.

## Estado anterior e retorno

Nenhum comportamento público ou dado persistido mudou. O componente não foi integrado à rota. Não há compensação SQL nem retorno de deployment a executar nesta preparação.

## Comunicação operacional

Ainda não anunciar disponibilidade. Após homologação e publicação, fornecer os passos reais de importação e seleção do CT-e de origem, incluindo a conferência manual para PDF/DACTE.

## Acesso alternativo confirmado em 03/11/2026

O usuário autorizou o uso da aba autenticada do painel Supabase. O projeto visível é **PROJETO AGV LOG**, ref `qcvnsdrbcchaxvawcngk`, organização exibida **AGV LOG**. Consultas somente de catálogo foram executadas com sucesso no editor SQL do painel. Isso supera o bloqueio de leitura pelo conector; não comprova autorização técnica de DDL ou publicação nem conclui a funcionalidade.

Foram conferidas as colunas de `cte_batches`, `cte_documents` e `fiscal_documents`; nenhuma tabela específica de CT-e da contratante apareceu no inventário fiscal/importação. Também foram conferidas as definições efetivas de `private.request_tenant_id`, `private.is_request_tenant_member`, `public.is_tenant_operator_or_admin` e as políticas de `storage.objects`.

O contexto efetivo exige concordância entre o header e a claim assinada `active_tenant_id`; usuários autenticados sem a claim são rejeitados. A permissão operacional vigente exige membership ativa com papel owner/admin/operator. Armazenamento financeiro e quarentena possuem fronteiras específicas; não reutilizar buckets existentes para CT-e da contratante sem tratar seus contratos.

Nenhuma tabela, política, migration, arquivo operacional ou documento fiscal foi criado/alterado no ambiente público durante essa inspeção. Persistência, vínculo fiscal e gates de entrega continuam pendentes.
