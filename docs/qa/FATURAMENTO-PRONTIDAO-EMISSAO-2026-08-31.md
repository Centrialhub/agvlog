# Prontidão do faturamento para testes de emissão fiscal

> Continuação: as correções e o preflight hospedado foram realizados após esta auditoria. Consulte [Pacote de homologação](FATURAMENTO-HOMOLOGACAO-PACOTE-2026-08-31.md) para o estado atualizado; o texto abaixo preserva as evidências da inspeção inicial.

Data: 31/08/2026, America/Sao_Paulo. Inspeção concluída por volta de 09:34.

**Parecer: não liberar emissão fiscal com o cliente no estado inspecionado.** Há implementação e testes locais aprovados, mas foram encontrados defeitos no ambiente de NFS-e, na recuperação de CT-e e na confirmação de persistência. A configuração publicada não pôde ser verificada. Testes internos com transporte simulado podem continuar; a homologação integrada requer as correções e verificações abaixo.

## Escopo e limites

- Inspecionados: faturamento/CT-e Hub, emissão de CT-e e NFS-e, geradores de payload, seleção de credenciais por ambiente, proxy, polling, ligação com faturas e recebíveis, testes e runbook. MDF-e teve seus testes existentes executados, mas não recebeu homologação funcional completa.
- Analisada a árvore local, que já continha numerosas alterações não commitadas, inclusive no fiscal. HEAD: `af802aa3577fb0932fdca0281884e3397c91c19e`. O HEAD sozinho não identifica o código auditado.
- Nenhuma emissão, cancelamento, envio de e-mail, alteração de flag, cadastro de credencial, migração ou deploy foi executado. Nenhuma correção de código foi aplicada nesta auditoria.
- O projeto configurado é `qcvnsdrbcchaxvawcngk`. A listagem do conector Supabase não expôs esse projeto, e uma consulta somente de leitura de `tenant_feature_policy` retornou falta de permissão. Não foram consultados dados do outro projeto disponível nem tentado contornar essa restrição.
- Por isso, flags efetivas, emitentes, credenciais, certificado no provedor, migrations, versões publicadas, filas, crons e webhooks do AGVLog permanecem **não verificados**, não presumidos ausentes.
- Não foi executado E2E autenticado nem chamada ao Hub/SEFAZ/prefeitura. Os testes SQL usam banco local PGlite; os testes de Edge usam transporte simulado. Não equivalem à emissão fiscal integrada.

## Bloqueios encontrados

### 1. P1 — NFS-e de homologação contém indicação interna de produção

Evidência: `src/lib/fiscal/nfseBuilder.ts:224-228,284`; `src/hooks/useNFSe.tsx:325-366`.

O gerador aceita `sandbox`, `homologation` e `production`, mas só converte `sandbox` para `payload.ambiente = homologacao`; qualquer outro ambiente vira `producao`. O hook passa a seleção de homologação ao gerador e o proxy encaminha o payload NFS-e sem corrigir esse campo.

Reprodução executada com o gerador real e dados sintéticos, sem rede:

| Seleção | Ambiente do envelope | `payload.ambiente` |
|---|---|---|
| sandbox | sandbox | homologacao |
| homologation | homologation | **producao** |
| production | production | producao |
| omitida | production | producao |

O fallback para produção é um risco adicional do gerador; o hook atual exige ambiente explícito. A divergência foi comprovada localmente, **não uma emissão real em produção**. Sem conferir o contrato efetivo do provedor, não é seguro presumir que ele ignore o campo conflitante.

Antes do teste: alinhar envelope, payload e credencial; rejeitar ambiente ausente; adicionar cobertura dos três ambientes e da ausência de seleção.

### 2. P1 — Nova tentativa de CT-e troca a identidade após resultado incerto

Evidência: `src/hooks/useIssueCTe.tsx:60-67,113-134`; `supabase/functions/hub-fiscal-proxy/index.ts:414-425`.

Cada execução gera um `externalId` com data/aleatoriedade e insere outro documento local antes de chamar o Hub. Uma falha de comunicação é tratada como rejeição local. A tentativa seguinte não recupera necessariamente a primeira e fornece outra identidade ao mecanismo de deduplicação do proxy/provedor.

Reprodução executada com o hook real, builder/transporte/banco simulados: duas tentativas sobre a mesma nota de entrada, ambas com erro de comunicação, criaram dois registros locais e enviaram dois `externalId` diferentes. Isso demonstra o risco de duplicidade se o provedor tiver aceitado a primeira chamada antes da perda da resposta; não foi alegada duplicação fiscal real.

NFS-e também gera `doc.id-r1`, `doc.id-r2` a partir da contagem de tentativas (`useNFSe.tsx:339-354`, `nfseBuilder.ts:224`). Essa política precisa distinguir rejeição definitiva de resposta incerta antes de gerar outra identidade.

Antes do teste: persistir uma operação com identidade estável, recuperar/consultar resultado incerto antes de reenviar e impedir duas operações concorrentes sobre as mesmas origens. Gerar nova identidade apenas em um fluxo explícito de nova emissão após resultado conciliado.

### 3. P1 — CT-e pode aparecer como sucesso apesar de falha nas gravações locais

Evidência: `src/hooks/useIssueCTe.tsx:155-171`; `supabase/functions/hub-fiscal-proxy/index.ts:431,451-495`; `supabase/functions/cte-status-poll/index.ts:111-145`.

O hook não verifica o `error` retornado pelo Supabase na atualização do CT-e e na marcação das notas consumidas. O `try/catch` da marcação não captura erros retornados como `{ error }`. O diálogo contabiliza a resolução do hook como transmissão bem-sucedida (`CteEmissionPreviewDialog.tsx:913-926`).

Reprodução executada com o hook real e transporte/banco simulados: o Hub retornou autorizado, todas as atualizações locais retornaram erro `42501`, mas o hook resolveu com sucesso. A divergência de persistência não foi apresentada ao chamador.

Há uma lacuna adicional no proxy: ele chama o provedor antes de inserir `hub_fiscal_emissions`; se a inserção falha, apenas registra um aviso e devolve sucesso conforme o HTTP do Hub. O polling procura exatamente essa referência para reconciliar. Uma autorização pode ficar sem vínculo local recuperável pelo fluxo atual.

Antes do teste: registrar a intenção antes do efeito externo, conferir todas as gravações e apresentar resultado pendente de reconciliação quando o provedor aceitou mas a persistência falhou. Não incentivar nova emissão nesse caso.

### 4. P1 para teste no ambiente do cliente — Cobrança não exige autorização nem separação de ambiente fiscal

Evidência: `src/hooks/useClientInvoices.tsx:121-189`; `supabase/migrations/20260830192908_audit_client_invoice_lifecycle.sql:207-214`.

Os seletores de CT-e/NFS-e e a validação SQL excluem cancelados, inutilizados/prévias conforme o tipo, mas não exigem CT-e autorizado/NFS-e emitida e não filtram ambiente. Portanto, esse trecho não impede selecionar rascunhos, rejeitados ou documentos de teste que atendam aos demais critérios. A observação também consta no relatório anterior `FATURAS-CICLO-AUDITADO-2026-08-30.md` como política ainda pendente.

Essa é uma lacuna de política e isolamento, não uma conclusão sobre a legalidade de cobrança antecipada. Fatura comercial e emissão fiscal são operações distintas; o assistente de fatura explicita que não emite documento fiscal nem envia externamente.

Antes do teste: definir a regra comercial de elegibilidade e impedir que homologação gere cobrança real por acidente. Preferir tenant/ambiente isolado e verificar a passagem documento autorizado → fatura → recebível.

## Publicação e habilitação ainda não comprovadas

O `docs/production-runbook.md:3-5,34` estabelece fiscal desativado até homologação. As rotas usam `CapabilityGate` e o backend aplica `requireIntegrationCapability`. O E2E fiscal existente em `e2e/capabilities-and-idor.spec.ts:7` verifica a tela de integração desativada, não uma emissão bem-sucedida.

O relatório de faturas de 30/08 descreve o ciclo financeiro como candidato local não publicado. Há também mudanças locais no proxy e nos hooks. Isso exige comparar banco, Edge e frontend do release pretendido; não comprova, por si só, que a produção esteja desatualizada ou desabilitada hoje.

## Verificações executadas nesta auditoria

| Verificação | Resultado |
|---|---|
| Vitest focal — 18 arquivos | **174 testes aprovados**, saída 0 |
| TypeScript — `npm run typecheck` | Aprovado, saída 0 |
| Edge — `npm run edge:syntax` | **42/42 arquivos aceitos**, saída 0 |
| Gerador NFS-e real, três ambientes + omissão | Divergência reproduzida |
| CT-e real com dependências simuladas — reenvio incerto | Identidades diferentes reproduzidas |
| CT-e real com dependências simuladas — erro nas gravações | Resolução indevida como sucesso reproduzida |
| Configuração hospedada AGVLog | Não verificada: conector sem permissão |
| Emissão integrada e E2E autenticado | Não executados |
| Build completo, lint completo e suíte integral | Não executados nesta auditoria |

Comando focal executado:

```powershell
npm run test -- src/test/cteBuilder.test.ts src/test/ctePayload.test.ts src/test/fiscalEnvironment.test.ts src/test/FiscalEnvironmentSelect.test.tsx src/test/hubFiscalProxyRuntime.test.ts src/test/fiscalPollPolicy.test.ts src/test/nfseBuilder.insurance.test.ts src/lib/fiscal/mdfeBuilder.test.ts src/test/insuranceValidation.test.ts src/test/emitterSelection.test.ts src/test/ssxFiscalRecoveryContract.test.ts src/test/clientInvoices.test.ts src/test/clientInvoiceLifecycleDatabase.test.ts src/test/clientInvoiceLifecycleFrontendDatabase.test.tsx src/test/clientInvoiceOutbox.test.ts src/test/receivableFinancialDatabase.test.ts src/test/receivableFinancialAmounts.test.ts src/test/integrationCapabilitiesContract.test.ts
```

Os 174 testes cobrem partes relevantes de construção de payload, isolamento de credenciais, polling, seguro, ciclo de faturas e recebíveis. A aprovação não cobre os defeitos reproduzidos nem atesta conformidade tributária.

## Roteiro mínimo para liberar homologação

1. Corrigir os itens 1–3 e estabelecer a separação entre documentos de teste e cobranças reais do item 4. Adicionar regressões para timeout após aceite, falha de persistência, reenvio e concorrência.
2. Validar o lote exato de frontend, migrations e Edge em ambiente isolado; executar os gates completos e conferir as versões implantadas.
3. Com acesso autorizado ao projeto correto, verificar as flags e o kill switch do tenant piloto. Não ligar o fiscal globalmente nem alterar políticas de acesso para viabilizar o ensaio.
4. Conferir emitente ativo, cadastro/endereço/IBGE, inscrição aplicável, série/numeração, parâmetros fiscais com o responsável contábil, credencial específica de homologação e certificado/cadastro exigido pelo provedor. Conferir secrets, URL do Hub, autenticação, callback/webhook e crons sem expor credenciais.
5. Realizar diagnóstico autenticado de credencial e um único documento sintético de homologação por fluxo necessário. Conferir ambiente efetivo na resposta e no XML, autorização, chave/protocolo, PDF/XML e persistência após nova sessão.
6. Exercitar rejeição corrigível, resposta incerta, reenvio sem duplicidade, callback repetido/fora de ordem, polling, cancelamento e liberação de origens. Verificar fatura/recebível e impedir cobrança real de documento de teste.
7. Registrar os resultados e só então liberar uma sessão de teste acompanhada com o cliente. Emissão real exige uma decisão de liberação separada.

## Identificação dos arquivos auditados

SHA-256 do conteúdo local no momento da inspeção:

| Arquivo | SHA-256 |
|---|---|
| `src/lib/fiscal/nfseBuilder.ts` | `0458472DEF25E464A75C8856D10DDC4E57BC3CEF0F3C4374B4EDE907313C2556` |
| `src/hooks/useIssueCTe.tsx` | `A0023DA1D6E67F121DF4772590AD9114DCCC6040B2C70F19927BBDD5751F8B30` |
| `src/hooks/useNFSe.tsx` | `97577897794CCCC1545AB0C7E935C801FCDCC3417CF76503F5F6686C5623C49D` |
| `supabase/functions/hub-fiscal-proxy/index.ts` | `EBDB4E4444B8AF2091F9032BE101E61F1473671BF398050553AA63863B830C0C` |
| `supabase/migrations/20260830192908_audit_client_invoice_lifecycle.sql` | `E345E26F41D2CCC4C2B21D3F5450983EB41CA359856D61DC29AFD11472AE5CCF` |
