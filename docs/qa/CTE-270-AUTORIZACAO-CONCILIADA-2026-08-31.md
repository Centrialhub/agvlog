# CT-e 270 — autorização conciliada em 31/08/2026

## Falha e evidência

A emissão c12e1c44-436b-46e8-b7de-6cfeb2bb0cc8 foi criada às 16:07:01 UTC, para NF 447165, em produção. O Hub devolveu success=true, status=authorized e documento 33cc3a4a-bab0-4623-96b2-b0fb73841088, número 270, série 1. O recibo persistiu, mas a transação de conciliação foi revertida: o trigger tentou inserir source_type=fiscal_documents numa restrição que só aceitava period/loads. Havia ainda incompatibilidades seguintes: lote com status issued (a tabela aceita generated) e CT-e com authorized (a restrição antiga só aceitava draft/issued/cancelled).

Os testes anteriores extraíam CREATE TABLE do baseline, omitindo CHECKs definidos em ALTER TABLE. A fixture agora instala as restrições reais do catálogo antes das migrations fiscais, impedindo que a mesma incompatibilidade fique invisível nos testes.

## Correção

Migration 20260831160938_reconcile_authorized_cte_catalog mantém os valores legados, admite explicitamente a origem fiscal_documents e os estados fiscais authorized/transmitting/rejected no catálogo. Não remove a validação de valores arbitrários. O trigger grava o lote como generated. Papéis, RLS e permissões das funções não foram ampliados.

A resposta inicial usava o lote 79280092 no campo authorizationProtocol. A resposta ManagerSaaS de consulta contém chave,AUTORIZADA,100,motivo,131264829388436,270,1. A conciliação recupera o protocolo de 15 dígitos dessa estrutura somente quando chave, número e série correspondem ao documento autorizado. O recibo bruto é preservado.

## Recuperação real

Polling autenticado existente, pg_net 41121, somente GET no Hub: HTTP 200, checked=1, outcome=issued. Ledger authorized/recorded; fiscal_documents authorized; cte_documents authorized; lote generated. Protocolo 131264829388436 nos três registros. NF 447165 vinculada ao outbound e1fa8c7e-90f9-4322-9b95-59e06c49e79f e marcada emitida. Nenhum POST adicional de emissão; um único registro desta operação e um único CT-e no catálogo. A função de elegibilidade fiscal confirmou liberação para faturamento.

## Testes

Cinco testes novos verificam autorização com CHECKs reais, recuperação depois da falha do trigger antigo, protocolo correto, consulta repetida sem duplicar catálogo/lote, recusa de protocolo de outra chave e manutenção da restrição contra estados arbitrários. Os cinco passaram, assim como os 36 testes fiscais direcionados. Verificação final: 2.735 testes em 232 arquivos passaram; TypeScript e lint sem erros. Advisor sem apontamentos relacionados às funções alteradas.
