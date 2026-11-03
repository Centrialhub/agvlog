# Preparação — importação do CT-e da contratante

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
