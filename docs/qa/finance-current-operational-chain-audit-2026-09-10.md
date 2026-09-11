# Auditoria da cadeia operacional mínima — 2026-09-10

## Estabilização imediata

A migration214012 de versões da descarga tinha zero bytes: só havia sido criada pela CLI. Foi removida, após conferir que continuava vazia. Nenhuma estrutura de versões foi implementada/aplicada, nenhum writer novo foi iniciado e nenhum processo deste agente permanece ativo. O contrato enviado anteriormente é proposta, não dependência instalada.211156/211740 e212550 permanecem completos, sem alteração nesta rodada.

## Caminho backend necessário

1. Autorização/empresa/conta e registro da saída:212104 ledger foundation;213020 movement queries. Movimento é dinheiro registrado, nunca execução de PIX. Lista ativa/guards posteriores de movimentos inválidos também precisam estar instalados no estado final.
2. Lote de custos:213959 expense_batches, com dependência212514 descarga quando categoria pertinente;220020 options,221405 histórico e124716 totais por centro. Uma saída pode ser repartida em várias categorias sem recriar dinheiro; valor não coberto vira payable de complemento pelo beneficiário explicitamente escolhido.220941 preserva/verifica objetos de comprovantes. Cancelamento175641 e leitor175733 preservam histórico e totais ativos; não são necessários para inventar novo gasto, mas fazem parte do estado final de código.
3. Extrato original:222851 intake,223737 verificação de fonte,230507 consultas,231643 revisão de identidade,020543 OFX,021404 conta nativa. Original recebido deve chegar ao armazenamento e ao worker/verificação reais; cadastrar linhas pelo navegador não constitui prova bancária.142923 revalida acesso após espera.
4. Conciliação:013543 grupos,014238 workspace,015331 histórico;022059/023208 referências automáticas/estado. Não soma extrato com movimento como duas saídas.83442 impede movimento invalidado;84543 restringe candidatos ativos.233625 audit preserva intervenção manual; auditoria posterior mantém novos eventos.
5. Conferência de período pode complementar o uso (023911 e abertura/cobertura/fechamento posteriores), mas não deve ser pré-requisito fictício para lançar despesa ou visualizar extrato. Pacote193723 prova saldos só com cobertura necessária, sem esconder pendência sob saldozero.

Os números são sufixos de migrations reais, não uma lista segura para implantar seletivamente. As migrations posteriores alteram corpos efetivos; validar toda a cadeia aplicável e grants/Storage/worker do ambiente é obrigatório antes de alegar disponibilidade operacional.

## Evidência existente versus lacuna

- `financeExpenseBatchDatabase.test.ts`: comandos SQL reais de movimento+lote, categorias sem duplicar saída, sobra20 após custos480, complemento30 ao motorista, overbooking com rollback, histórico/totais por centro e isolamento. Fixture é estreita e recorta tabelas dependentes: não instala extrato/worker/conciliação completos.
- `financeStatementIntake.test.ts` + `setupFinanceStatementIntakeDatabase`: leitor original/OFX e SQL de conciliação/identidade/referência automática incluindo142923; testa sobreposição, referência exata e revisita de saída registrada depois. Não é o lote de custos na mesma jornada.
- `financeReconciliationVoidedMovements.test.ts` e QA nativo correspondente: seleção ativa, rejeição de stale, automática e isolamento sob guards atuais. Históricos brutos são preservados.
- `periodUnloadingBankPackage.test.ts` e nativo203516: cobrança e recebimento reais, PIX300 dividido100descarga/200frete, extrato/conciliação/fechamento/reabertura e vínculo de cobertura. É o ramo de entrada; não demonstra sozinho saída ao motorista→gastos em lote→extrato.
- `unloadingProjectionRepair.test.ts` prova lote real com custo/payable intactos e7casos privados; native211156/211740 aprovado5casos pelo agente dono. Promoção212550 passou3PGlite públicos. Não é nova prova da jornada operacional inteira.
- `expenseBatchDialog`, `expenseBatchEntryUx` e `statementReconciliation` verificam interface; ao menos a conciliação de UI usa mocks de cliente. Não equivalem a uma sessão real no ambiente conectado com upload/worker/permissões.

Não foi identificado um teste único que faça, com todas as definições finais e sessão real: registrar saída500 ao motorista → lote de combustível/alimentação480 vinculado à mesma saída → manter20sem classificação inventada → importar/verificar OFX com saída500 → conciliar uma vez → mostrar custo480 e dinheiro500 sem duplicação. Esse é o próximo ensaio de usabilidade a executar, acompanhado do caso complemento530/saída500/payable30 e navegação para recibos/pendências. Testar também papel misto negado, resposta perdida/replay e erro de upload legível.

## Ausências a verificar no ambiente antes de chamar utilizável

Migrações realmente aplicadas; RPCs e ACL atuais; conta/empresa/sessão selecionadas; bucket de comprovantes e upload/leitura; caminho efetivo de envio do original e execução do worker; grants exclusivos do worker; entradas visíveis na navegação; seleção real de viagem concluída/movimento; atualização das listas após comando; mensagem clara quando há20nãoalocados ou complementoaberto. Esta rodada não consultou nem escreveu remoto, não executou PG/TSC nem repetiu suites: é inventário estático e síntese de evidências existentes.
