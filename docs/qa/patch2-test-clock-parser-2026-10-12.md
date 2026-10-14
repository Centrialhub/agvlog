# Fixtures de calendário e parser — PATCH2 12/10

Base013c1858c78ded26ae0a81bff91a6c06de9c5d0b/tree5e9bf2fbfdab139d87d24842936090757a27b540. Primeiro full unit:8422PASS/2FAIL/1SKIP,1393arquivos; dados/SQL/produção não alterados. Resultado preservado, não convertido retroativamente em PASS.

Financeiro: cenário de parcelas futuras usava10/10 fixo e esperava overdue0; em12/10 retornou20000 corretamente. Fixture usa calendário do próprio banco para parcelas futuras/revisadas e janela de forecast, conserva todos os cálculos/replay/ACL/history/reversões/sem duplicações. Nova contraprova usa a API versionada real para revisão com uma parcela passada, exige20000 overdue/open40000 e rollback do savepoint restaura a situação futura/overdue0, sem desabilitar triggers ou editar tabelas imutáveis. Negativa de motorista usa data válida futura. Nenhuma lógica/migration financeira foi editada.

Parser: diagnóstico no código013, mesmo teste:single_runtrueFAIL/single_runfalsePASS. Biblioteca8.48 trata a segunda parse do mesmo filePath em modoCI como autofix e cria programa isolado. Os testes com mudança de configuração declaram sessão contínua pelo option suportado; a negativa aquecida original permanece. CI fixo ganha caso separado, com programa/strict/inclusão e exclusão exigidos. Não se afirma que alterar configuração durante autofixCI passou; nenhuma versão/peers/regra/parser produtivo alterada.

19JSONs QA foram escritos emLF idêntico aoHEAD pelos helpers; core.autocrlf=true esperaCRLF no checkout. Antes de restaurar somenteEOL, houve prova de igualdade de bytes e preservação emC, claims/preflight explícitos; nenhumreset/rewrite/alteração semântica. Próximos testes terão captura do checkout anterior/restauração estritamenteEOL, recusando qualquer delta de conteúdo.

Fixtures e contraprovas emPGliteRAM/SDK/jsdom não equivalem aNative/Auth/PostgREST/Deno. Revisão independente antesenqueue/integrate; gates e suíte completa no próximoSHA combinado. Nova autorização de provisionamentoNative foi recebida16:59, com orçamento/isolamento próprios; semstartup/produção neste delta.

QA dirigido:11PASS/0FAIL/0SKIP nas duas fixtures; types e lintPASS. Primeira correção teve aliasSQLsecond reservado(42601); falha preservada, alias citado corrigido e11reexecutadosPASS. Metadata/EOL não foi alterada nesses testes focados. Testes workingtree ligados a diffSHA256e225c92400054a3985dd2a75e101adad361868c01f560678bbb6f552da1579f4; seloGit segue nohandoff. Nenhuma integração/publição automática.
