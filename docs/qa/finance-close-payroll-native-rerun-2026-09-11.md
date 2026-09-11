# Fechamento e folha — nova execução PostgreSQL nativa

11/09/2026. PostgreSQL17.11, loopback, fixture descartável. Duas execuções independentes e sequenciais do runner existente, sem modificar SQL/scripts e sem acesso remoto. A primeira terminou com exit0 e servidor parado antes de iniciar a segunda.

| Seletor PG_QA_SUITE | Resultado | Encerramento |
|---|---|---|
| finance-account-period-close | 9 PASS, exit0 | Disposable PostgreSQL stopped |
| finance-payroll-lifecycle | 9 PASS, exit0 | Disposable PostgreSQL stopped |

Logs completos: finance-account-period-close-native-rerun-2026-09-11.log e finance-payroll-lifecycle-native-rerun-2026-09-11.log. Hashes de logs, scripts, helper e referências SQL estão no JSON homônimo deste relatório. O inventário de referências SQL não significa instalação integral de cada arquivo: o harness extrai tabelas e funções indicadas nos scripts.

## Cobertura real

Fechamento: dinheiro registrado conciliado contra escrita retroativa; integridade do snapshot/dependências após reabertura e replay; fechamento concorrente com revisão de origem; revogação enquanto espera; mesmo pedido concorrente produzindo um fechamento; capacidade congelada disputada por pagamentos tardios reais; cadeia completa de recebimento/movimento/banco; rollback diferido de pagamentos sem vínculo ou de outra conta; próximo mês contíguo e bloqueio da reabertura de seu predecessor.

Folha: geração/aprovação em ambas as ordens; ajuste manual antes/depois da aprovação; recálculo/aprovação sem deadlock; revogação durante espera impedindo título; ACL de escrita direta e proteção de totais aprovados; entrada cancelada preservada. As verificações confirmam ausência de movimentos e pagamentos de acerto novos nesse ciclo.

## Limites que permanecem

O fechamento instala a cadeia selecionada até64942, com fontes da baseline e funções/DDL reais selecionados. Não incorpora automaticamente todas as ampliações posteriores de caixa, correções e resolução de origens. A comprovação de extrato é semeada como rows_match; não exercita upload real, autenticidade de Storage ou leitor Edge. A suíte prova concorrência dos comandos testados e não a jornada completa do navegador.

A folha instala000731,132406 e133352 atuais. Seu active_payable_payments é uma view simples da tabela de pagamentos; auxiliares is_tenant_admin/is_tenant_operator_or_admin usam can_access da fixture. Isso não prova as políticas finais completas de função/claim nem a cadeia produtiva de estorno de pagamentos. Os bloqueios reais da migração133352 e sua reautorização foram exercitados nas disputas descritas.

Ambos os servidores foram encerrados pelo runner. Nenhum SQL, script, migração remota ou dado de produção foi alterado.
