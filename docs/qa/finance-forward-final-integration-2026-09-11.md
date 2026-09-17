# Integração financeira final até212550

A cadeia financeira inteira atual instala até212550 sem exclusão de guards e sem substituir writers por stubs. Manifesto completo finance-forward-final-block-manifest-2026-09-11.json, delta E–G finance-forward-final-delta-2026-09-11.json.

## Defeito reproduzido e correção

190516 exigia token payables_payments no corpo check_payable_payment_insert, porém03529 já havia trocado essa fonte para active_payable_payments. A instalação inteira abortou finance_movement_correction_installation_incomplete. A fixture isolada reinstalava helper02244 antigo, ocultando incompatibilidade. Evidência do corpo efetivo e diagnóstico em finance-forward-readiness-failure-2026-09-11.json.

Original arquivada SHA aefa6e937c708cf31e983c7bf6bdfef8a2e788ed68bcf0683a67b4c256367b32; fresh pendente corrigida SHA fbffac3208c08250d6aabc82b91b3d127f3f3c0e675f2b6dd958a3ffb0d6bcfc. Nenhuma versão aplicada foi sobrescrita. A correção exige o trecho exato da soma ativa e prosrc MD5 8dffa1b366291f565e438b07803bab8d. Não aceita fallback para pagamento raw nem bypass de readiness. Fixture isolada agora aplica substituição exata do predecessor03529 antes de190516.

## Testes

- financeForwardFinalBlockIntegration + diagnóstico arquivado:2 PASS/7,26s. Todos arquivos inteiros até212550; readinesstrue final; drift no corpo do guard torna readinessfalse; restauração exata recupera true.
- financeMovementCorrectionContext9 + movementCorrectionPreview4 + publicManualMovementVoid8:21 PASS/7,93s, exit0.
- ESLint0 nos arquivos alterados. Nenhum TSC/PG nativo/remoto.

## Limites

Ensaio PGlite e fixtures selecionadas de schema operacional; não é reset completo Supabase. O teste de diagnóstico usa prefixo do arquivo arquivado exclusivamente para consultar causa, nunca contado como instalação bem-sucedida. Gates operacionais/realtime/SSX remoto não são simulados. Cron ausente segue ramo real sem jobs. Não houve emissão fiscal. Os cenários operacionais completos de E–G não foram todos repetidos; esta rodada prova compatibilidade de DDL/corpos reais e regressões específicas de preview/void/drift, enquanto as suítes próprias anteriores cobrem outros fluxos.
