# Consumidores da origem versionada de descarga — UI, 2026-09-10

## Pontos concretos de integração

- `src/pages/Receivables.tsx:254` e `src/hooks/useReceivableUnloadingOrigin.ts:10`: a consulta por FK da charge identifica corretamente a origem, mas fornecedor/valor exibidos vêm do original. Quando houver versões, manter a FK e consultar original + vigente explicitamente; nunca renomear o valor original como vigente.
- `src/components/financial/ExpenseHistoryDetail.tsx:27`: hoje o reembolso exibe `row.amount_cents`, que é o custo, junto do recebível. É o ponto mais direto de risco após redução/cancelamento de cobrança. Substituir futuramente por cobrança vigente do resolver, mantendo o gasto acima intacto. O reader precisa entregar unloading_id e versão, não inferir vínculo pelo valor.
- `src/components/financial/RecordedCosts.tsx`: totais/linhas são custos preservados. Uma alteração do direito de cobrança não deve alterar esses valores ou indicar cancelamento de custo. Para abrir versões, o reader precisa fornecer charge_id pela relação do item; nunca usar payable_id como charge_id.
- `src/components/financial/ReceivableFinancialDialog.tsx:55`: source_issue já bloqueia novos recebimentos sem impedir devolução autorizada. O contexto deve validar contra a origem efetiva; histórico de pagamentos mantém seu fornecedor anterior.
- `src/components/financial/PeriodUnloadingFlowDetails.tsx` e `PeriodUnloadingFlowPanel.tsx`: eventos originais/recebimentos/devoluções precisam da extensão v2 de ajustes com sinal, duas pernas por troca de fornecedor e chave incluindo a perna. Líquido econômico da cobrança não é saldo devedor nem caixa.
- Carteira: resumo de recebíveis soma o título vigente do servidor; não somar original + versões. Cancelamento precisa continuar excluído dos totais ativos e preservado no histórico capturado.

## Apresentação isolada entregue

`UnloadingOriginVersions.tsx`, export `UnloadingOriginVersionsModel`, sem RPC, escrita ou integração em telas. Recebe IDs de charge/entrega/título; original; vigente resolvido; ajustes com fornecedor e delta com sinal; autoria/motivo/data econômica/data de registro; custo/pagável/favorecido separado; indicador de completude do histórico. Não calcula vigente somando páginas e não converte null em zero.

O modelo é de apresentação, não contrato público de transporte. O adaptador futuro deve validar escopo/revisão do reader e mapear o resolver confirmado pelo backend. Datas de registro não são prova de ordem de commit ou conhecimento histórico. Ajustes trocando fornecedor conservam ambas as pernas e identidades; recebimentos passados não são reatribuídos.

Aceite focal: redução 150→120 mantém custo150 e ajuste−30; cancelamento mantém original/custo e não cria recibo; dados desconhecidos e histórico parcial aparecem como indeterminados; região acessível e indicação manual permanente. Três testes passaram; não executado TSC. Integrações aguardam reader público, exceto o demonstrativo v2 autorizado separadamente pelo coordenador.
