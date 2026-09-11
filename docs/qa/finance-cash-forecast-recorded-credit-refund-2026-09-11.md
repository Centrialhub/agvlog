# Integração independente previsão × devolução de crédito

Teste src/test/cashForecastRecordedCreditRefund.test.ts: PASS08:13:51, saída0; ESLint0. Nenhum SQL/helper congelado alterado nesta subtarefa e nenhuma execução remota.

Ordem ensaiada: fixturefinanceira completa+01312, depois02519publicada, depois04822candidata. O teste usa o wrapperforecast_customer_credit_evidence publicado por02519 através da coleta integral e parseia o DTO real. Projeção SQL integral é igual ao adaptador/calculador TypeScript de produção.

Crédito600 gerado por recebimento real+liberação fiscal com fatos de documento existente. Saída canônica200 registrada ANTES da vinculação. Coleta antesdevolução: crédito disponível600, saída200 presente uma vez. Vínculo refund200 muda disponibilidade para400 e revisão; não muda recorded_after_cutoff. Aplicação400 ao título500 deixa disponibilidade0, cashfulfilled0, creditreserved400 e previsão de entrada100. Saída projetada continua200, sem linha financeira extra.

Posição final original600/aplicado400/devolvido200/disponível0; história contém o mesmo refund_id. Banco, pagamentos e crédito original permanecem byte-idênticos. Captura preservada antesdo vínculo permanece byte-idêntica apósdevolução+aplicação. Constraints diferidas executadas.

Limite: o teste verifica projeção e movimentos pela coleta real, sem fabricar abertura bancária ou afirmar saldo final confirmado onde a base da fixture estiver não verificada. Não é ensaio de execução de transferência, emissão fiscal, produção ou concorrência nativa. A saída já existe antes da operação testada.
