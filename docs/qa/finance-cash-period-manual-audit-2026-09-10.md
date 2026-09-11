# Auditoria manual do fechamento de caixa

A migração74822 inclui `cash_period_count_recorded`, `cash_period_count_reversed` e `cash_period_closed` no filtro manual e na classificação `manual_intervention` da consulta existente. Reabertura usa o evento comum já incluído por65830. Os rótulos do frontend distinguem contagem, reversão e fechamento de caixa; reabertura e composição tardia usam o termo conta, pois atendem banco e caixa.

O teste `cashPeriodCountReaders` usa comandos reais: contagem inicial, reversão, contagem zero, abertura zero, revisão de fontes, fechamento e reabertura. A consulta de auditoria é validada pelo parser do frontend, preserva as duas contagens e identifica autor/intervenção manual. Nenhum movimento monetário é criado. A consulta de contagens desabilita reversão enquanto fechado e a habilita após reabrir, para a contagem ainda ativa.

Resultado: 4 testes de reader/auditoria e 10 testes do core passaram, 14 no agregado. ESLint passou nos arquivos alterados. A primeira tentativa de teste tentou reinstalar233625, já presente na factory, e falhou por índice duplicado; apenas o setup foi corrigido para usar a consulta real existente. Nenhum SQL de produto foi relaxado para o teste.

Esta rodada prova PGlite e integração de contratos; validação nativa74822 e homologação de tela completa ainda não foram executadas.73906/74142 permanecem congeladas para a rodada nativa em andamento;74822 é uma migração posterior separada.

Atualização:74822 incluída na rodada nativa finalcash18402, exit0/PGparado. Consulta manual_only com parserUI e eventos de contagem/fechamento/reabertura passou. Hash cef4cdafd97172a150bcf3c98d198ac10711b42afab992004506979737fc2c81; relatóriofinance-cash-period-native-2026-09-10.md. Homologação com sessão real e aplicação remota permanecempendentes.
