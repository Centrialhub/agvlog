# Estado remoto confirmado após reconexão — 10/09/2026

Leitura pelo conector Supabase no projeto `qcvnsdrbcchaxvawcngk`, PROJETO AGV LOG. Status retornado ACTIVE_HEALTHY, PostgreSQL17.6.1.084.

Histórico:406 migrations, primeira20260306135129, última20260909221751. A consulta das versões desde20260909000000 retornou apenas `prepare_durable_nfse_issue_batches` (20260909221751). O número de arquivos locais não equivale ao histórico remoto: há baseline consolidado e trabalho local de outras frentes.

Inspeção direta do catálogo confirmou ausência de `public.finance_movements`, `public.finance_account_openings`, `public.finance_expense_items`, `public.get_finance_receivables_page(uuid,text,text,uuid,date,date,integer)` e `public.get_finance_unbilled_freight_summary(uuid,date,date,uuid)`. Portanto, os testes locais não comprovam disponibilidade remota do novo módulo.

Extensões presentes: uuid-ossp1.1, pgcrypto1.3, supabase_vault0.3.1, postgis3.3.7, pg_cron1.6.4, pg_net0.20.0. O ensaio integral precisa contemplar essas dependências reais; fixtures parciais não substituem a aplicação sequencial.

Todas as chamadas desta inspeção foram somente leitura de metadados. Nenhuma migration, registro financeiro ou configuração remota foi alterada. Ensaio integral da cadeia local atribuído ao agente responsável pelo PostgreSQL nativo; resultado ainda pendente.

Nova confirmação após a mensagem de reconexão: o conector respondeu com o mesmo projeto ACTIVE_HEALTHY, 406 migrations e última versão20260909221751. A consulta confirmou que finance_movements e finance_manual_expense_cancellations continuam ausentes. Essa reconexão comprova acesso ao remoto, não implantação do código local. Nenhuma escrita remota foi realizada nesta confirmação.
