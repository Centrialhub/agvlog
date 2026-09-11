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


## Comparação matemática implementada

cashForecastComparison recebe a projeção original preservada e um pacote monetário validado. Exige mesma empresa, contas e período. Compara saldo inicial, entradas brutas, saídas brutas e saldo final separadamente e conserva a equação das diferenças. Saldos finais iguais não significam concordância quando saldo inicial e entradas diferem entre si. Não determina automaticamente causa ou fraude, não reescreve a previsão e não substitui valores desconhecidos por zero.

Cinco testes da comparação passaram junto aos12 do cálculo; ESLint passou. Abrangem diferenças de fluxo, saldo final igual com componentes divergentes, escopo/empresa/período incompatíveis, previsão/realizado incompletos e total original adulterado. Trata-se de núcleo puro, ainda sem captura persistida ou tela. A atribuição por título/movimento (atraso, antecipação, valor alterado, nova movimentação e entrada não identificada) permanece necessária além da comparação agregada.


## Base por conta e problemas por cen�rio � atualiza��o2026-09-11

A calculadora aceita agora basisv2 (CashForecastCompanyBasis) com componentes individuais bank/cash e preserva cada source_table/id/revision. Exige todas as contas exatamente uma vez, soma compat�vel e confirma��o consolidada derivada: mixed_confirmed para banco+caixa provados; provisional se alguma base provis�ria; unverified e saldo null se alguma desconhecida. N�o fabrica UUID ou zero para conta sem prova. Basisv1 continua aceito para compatibilidade.

source_issues admite scope confirmed/expanded/all. Problema exclusivo do frete a faturar impede o expandido e conserva o confirmado quando suas fontes est�o �ntegras; problema confirmado impede ambos. Omiss�o de scope conserva o comportamento restritivo anterior. Base desconhecida e cr�dito sem destina��o continuam impedindo conclus�o.

17 testes de proje��o,5 de componentes e6 de compara��o passaram (28 distintos; rodada27 seguida de11 ap�s acrescentar compara��o multicontas). Lint dos arquivos de proje��o/componentes passou; compara��o teve apenas novo teste. TSC77233 n�o concluiu verde: acusou vari�vel n�o usada no novo teste WIP de complemento de outro agente, informado ao autor. Nenhuma nova interface/RPC/coleta persistida � afirmada por esta mudan�a. Coletor autorizado separado em implementa��o.

Tipo de conta legado desconhecido permanece `unsupported`, nunca convertido em banco. S� � aceito como componente unverified com saldo null. Sexto teste de componentes passou; cat�logo conta29 testes distintos de proje��o/componentes/compara��o. TSC posterior38329 encontrou somente incompatibilidade de tipo no novo teste de seletor de outro agente, encaminhada ao autor.
