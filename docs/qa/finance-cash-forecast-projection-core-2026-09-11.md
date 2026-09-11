# Núcleo da previsão de caixa — 11/09/2026

Estado: cálculo puro implementado, sem rota, coletor autenticado, persistência nem publicação. Não é uma previsão financeira já liberada.

A consulta do catálogo de produção confirmou ausência de funções/tabelas de previsão financeira. O nome driver_arrival_forecasts refere-se a chegada operacional. Há public.finance_customer_credits, mas a consulta não encontrou tabelas nem funções de aplicação/reserva de crédito de cliente. Essa ausência impede supor que créditos pendentes já abatem títulos específicos.

cashForecastProjection recebe origens já verificadas pelo servidor, saldo-base identificado, data/captura, escopo de contas, valores nominais/cumpridos/reservados e movimentos ocorridos entre a base e a captura. Ele não autoriza nem verifica evidências bancárias: esta responsabilidade permanece no coletor. Exclui valores já cobertos da previsão futura; soma dinheiro registrado após a base separadamente; mantém confirmado e ampliado por frete a faturar separados. Datas passadas na captura exigem nova previsão. Pendências de fonte, crédito sem destinação e saldo-base desconhecido impedem apresentar saldo final completo. Totais conhecidos por data continuam identificados como parciais. Mantém proveniência de saldo provisório.

12 testes e ESLint passaram: parcial, crédito aplicado, título pago, vencido, data revisada, fora do período, crédito sem destinação, frete sem data, preservação por cópia, duplicidade econômica, data inválida, crédito excessivo, base desconhecida/provisória, ponte monetária posterior ao corte e vencimento posterior à base porém anterior à captura.

## Integração pendente para cumprir o plano

- Coletor autorizado por empresa/ator, exclusão de motorista/perfil misto, revisão consistente de todas as fontes. Não aceitar totais/evidências enviados pelo cliente como verdade financeira.
- Saldo-base/prova por contas selecionadas; ponte completa dos movimentos pós-corte até captura. Não usar saldo de ontem com saldos de títulos de hoje omitindo recebimentos/pagamentos de hoje.
- Revisões e datas esperadas auditadas, identificação de parcelas econômicas de faturamento parcial e exclusão NF/CT-e/NFS-e/fatura duplicadas. Reservas devem ter prova real, não campo inventado no frontend.
- Tratamento de crédito recebido e ainda não aplicado, para permitir reserva/aplicação auditada sem novo caixa; até lá manter diagnóstico explícito.
- Captura append-only no servidor, autoria/motivo/versão, recuperação idempotente e leitura por empresa. A cópia imutável em memória testada não substitui persistência histórica.
- Comparação com pacote monetário de mesmo escopo/período, original preservado, variações identificadas sem inferir automaticamente fraude/causa a partir de mera diferença. Recebimento não identificado deve permanecer visível.
- Interface e testes reais autenticados; publicar somente conjunto integrado.
