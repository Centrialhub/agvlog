# Consulta e integração da associação de pagamento antigo

Migration `20260910143920_finance_legacy_payable_association_options.sql`, local e sem aplicação remota.

A consulta usa o mesmo diagnóstico de elegibilidade da associação43833. Retorna pagamento normalizado, revisão do snapshot de origem, saídas da mesma conta/data/beneficiário motorista quando aplicável, capacidade restante compartilhada e histórico de vínculos. Não escolhe automaticamente por semelhança; a seleção é explícita. Pagina candidatos e histórico em vinte itens; o vínculo ativo é informado independentemente da página.

Seis testes reais em `legacyPayableAssociationOptions.test.ts` passaram com o helper da associação: compatibilidade de origem/valor/data, capacidade já usada por outro pagamento, reversão/reassociação, paginação, data inválida, autorização e distinção entre vínculos canônicos e legados. Respostas são validadas pelo contrato real do cliente. A fixture usa definições reais de baseline/candidatos, omite algumas relações de recebíveis e permite semear pagamentos antigos; o ensaio nativo separado cobre o bloqueio do escritor antigo.

`LegacyAdoptionInventory` oferece o fluxo na linha de pagamento de pagável. Após sucesso, atualiza pendências e mantém mensagem explícita de preservação do pagamento/dinheiro. O histórico de pagamentos oferece a correção adequada à origem; associação antiga nunca chama a reversão canônica de baixa.

O teste anterior `financePayableMovementLinks` continua verificando o schema histórico até003529, sem exigir o campo posterior `link_origin` de uma migration que sua fixture não instala. O teste moderno acima valida esse campo obrigatório com43833real. O contrato de produção não foi relaxado.

Rodada integrada:54 testes passaram em7arquivos (core15,consulta6,UI8,cliente4,vínculoUI3,regressão histórica15,inventárioUI3). Core final43833 foi validado também em12testes PG17.11 com hash2948e859d766cbff838a170ab288b543bf0d133412e9ba526d1f7fdb3125e529; coordenador confirmou log e encerramento. Nova revisão da fonte bancária durante espera impede associação com SQLSTATE40001, sem registro parcial.

Esta etapa não adota recebimentos antigos, fontes sem conta/data ou adiantamentos inconsistentes. Não confirma extrato, carteira de abertura nem fechamento; essas exigências permanecem separadas.
