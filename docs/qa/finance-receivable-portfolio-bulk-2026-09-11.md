# Carteira de recebÃƒÂ­veis: agregaÃƒÂ§ÃƒÂ£o bulk

Candidata local `20260911113458_finance_receivable_portfolio_bulk_evidence.sql`, criada via CLI. Altera exclusivamente `finance_private.receivable_portfolio_summary(uuid,date,date,uuid)`. MantÃƒÂ©m assinatura, ACL, SECURITY DEFINER, STABLE, search_path vazio, autorizaÃƒÂ§ÃƒÂ£o e DTO. NÃƒÂ£o altera dados, tabelas, snapshots, comandos, pÃƒÂ¡ginas ou wrapper pÃƒÂºblico. Nenhuma aplicaÃƒÂ§ÃƒÂ£o remota nesta tarefa.

## EquivalÃƒÂªncia

O agregado anterior chama `_receivable_financial_snapshot` por tÃƒÂ­tulo. Esse snapshot monta pagamentos, contas, evidÃƒÂªncia documental e revisÃƒÂµes, alÃƒÂ©m de calcular novamente evidÃƒÂªncia de dinheiro/crÃƒÂ©dito apÃƒÂ³s o ledger combinado. O patch04429 da carteira apenas extrai composiÃƒÂ§ÃƒÂ£o do snapshot materializado; ele nÃƒÂ£o adiciona um segundo loop da carteira. As pÃƒÂ¡ginas continuam com seu comportamento anterior.

A candidata seleciona a empresa e os filtros uma vez, conserva os cancelados na contagem e separa os tÃƒÂ­tulos ativos. RelaÃƒÂ§ÃƒÂµes de fatura/fechamento sÃƒÂ£o agrupadas com contagem e escolha do menor ID, incluindo referÃƒÂªncias inversas. Os mesmos predicados estruturais e de estado sÃƒÂ£o avaliados com tratamento explÃƒÂ­cito dos NULLs. Pagamentos sÃƒÂ£o agrupados por tÃƒÂ­tulo com as condiÃƒÂ§ÃƒÂµes originais de banco, conta, duplicidade global, reversÃƒÂ£o e exclusÃƒÂµes por correÃƒÂ§ÃƒÂ£o/crÃƒÂ©dito. EvidÃƒÂªncia monetÃƒÂ¡ria de tÃƒÂ­tulos numericamente invÃƒÂ¡lidos permanece ignorada, como no CASE original.

AplicaÃƒÂ§ÃƒÂµes/liberaÃƒÂ§ÃƒÂµes sÃƒÂ£o agrupadas por tÃƒÂ­tulo. `customer_credit_position` completo ÃƒÂ© avaliado uma vez por crÃƒÂ©dito distinto, preservando validaÃƒÂ§ÃƒÂ£o de vÃƒÂ­nculo imutÃƒÂ¡vel, auditoria, capacidade e devoluÃƒÂ§ÃƒÂµes04822. NÃƒÂ£o foi substituÃƒÂ­do por uma soma sem prova. Esse ramo ainda pode construir histÃƒÂ³rico por fonte de crÃƒÂ©dito; a otimizaÃƒÂ§ÃƒÂ£o evita sua repetiÃƒÂ§ÃƒÂ£o por tÃƒÂ­tulo e nÃƒÂ£o promete tempo constante quando hÃƒÂ¡ muitos crÃƒÂ©ditos histÃƒÂ³ricos.

A validaÃƒÂ§ÃƒÂ£o fiscal original ÃƒÂ© mantida para tÃƒÂ­tulos com CTe ou origem fiscal; sem ambos o helper retorna NULL por contrato exato pinado. A carteira anterior nÃƒÂ£o usa `source_issue` de descarga para decidir totais vÃƒÂ¡lidos, somente `requires_reconciliation` e `fiscal_block_reason`; o patch conserva esse contrato, sem acrescentar exclusÃƒÂµes silenciosas. Uma inconsistÃƒÂªncia invalida os totais globais e de todos os grupos de status. Filtros de criaÃƒÂ§ÃƒÂ£o, inclusÃƒÂ£o de datas invÃƒÂ¡lidas para diagnÃƒÂ³stico, dias SÃƒÂ£o Paulo, saldo vencido e contagem de cancelados permanecem iguais.

## PrecondiÃƒÂ§ÃƒÂµes e provas

Sete pins verificam corpo normalizado, volatilidade, SECURITY DEFINER/INVOKER, search_path e ACL dos predecessores finais: carteira, snapshot, cash ledger, crÃƒÂ©dito por tÃƒÂ­tulo, posiÃƒÂ§ÃƒÂ£o de crÃƒÂ©dito e fiscal issue. Uma concessÃƒÂ£o inesperada de EXECUTE aborta antes de substituir a carteira.

Dois testes prÃƒÂ³prios passaram sobre o hash final inicial ÃƒÂ s08:40:46, saÃƒÂ­da0; lint0. Comparam DTO inteiro e filtros com o orÃƒÂ¡culo anterior, conferem snapshots/pÃƒÂ¡gina byte-equivalentes e rejeitam alteraÃƒÂ§ÃƒÂ£o de ACL. O orÃƒÂ¡culo existe apenas na fixture independente, sem criar funÃƒÂ§ÃƒÂ£o de produto adicional. A revisÃƒÂ£o independente jÃƒÂ¡ comparou sete casos com parser de produÃƒÂ§ÃƒÂ£o:10mil tÃƒÂ­tulos/cancelados, datas/NULL global, recebimento e estorno reais, crÃƒÂ©dito com devoluÃƒÂ§ÃƒÂ£o/aplicaÃƒÂ§ÃƒÂ£o reais, grafo/fiscal invÃƒÂ¡lidos, empresa/misto/filtros e valores legados invÃƒÂ¡lidos. Benchmark nativo posterior e casos adicionais serÃƒÂ£o registrados pelo revisor em documento prÃƒÂ³prio; o baseline14,89s permanece evidÃƒÂªncia anterior, sem atribuir seus buffers temporÃƒÂ¡rios a um CTE especÃƒÂ­fico.

## Medição nativa e limite de rastreabilidade

Benchmark independente3295 terminou com saída0 e PostgreSQL17 encerrado. Em10mil títulos pendentes, o agregado otimizado teve p95 de142,38ms (20 amostras); o controle escalar no mesmo banco levou15,53s. O baseline anterior havia medido p95 de14,89s. EXPLAIN da nova consulta:119,58ms,185 shared hits, zero buffers temporários. Isso descreve ambiente local isolado, sem concorrência ou rede, e não uma garantia de latência hospedada. Muitas faturas ou históricos de crédito não foram representados nessa população de10mil títulos.

O benchmark instalou a versãof6b52860bb86ecf320b0c7780226a0135487ef1a21c2a02042ec176bcf4e3e22. Enquanto executava, uma mensagem de coordenação chegou após a inclusão de um sétimo pin para o ledger combinado. A versão final e948a5d8592dbfc5fb8b559b9adccefec7eb456b5c302e9657a8971f3ec84a3a difere somente por essa precondição adicional, validada pelos testes locais subsequentes. O corpo da consulta permaneceu MD5cd10de42b2e3a1567dc2de034048e7f0. Não se atribui ao ensaio nativo a instalação do novo pin.
