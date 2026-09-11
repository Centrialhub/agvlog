# Consulta de reparação do título da descarga

211740 expõe somente a consulta por empresa e descarga. O helper autorizado remove `_evidence` e mantém `can_execute=false`; a função de contexto bruto e o comando de reparação permanecem sem permissão de execução para authenticated. O wrapper público usa SECURITY INVOKER, com autorização no helper privado.

O cliente valida empresa, ator, descarga, destino derivado da origem e coerência de elegibilidade. O schema estrito recusa evidências internas expostas, códigos de execução inesperados e destino que não corresponda ao fornecedor/valor preservados. Não existe cliente de confirmação nesta etapa.

Quatro testes do cliente passaram. O teste SQL público passou com o schema de produção e uma descarga criada pelo comando real de gastos em lote, com custo/pagável associados. O título foi alterado antes da instalação dos guards; depois da instalação, a consulta mostrou R$170 atuais e R$150 como destino, sem bloquear o custo consistente. Comprovou ausência de `_evidence`, permissões somente de leitura e rejeição após revogação de acesso.

Primeira execução do teste público falhou porque a preparação não abriu a transação exigida pelo helper de sessão; corrigido o teste, sem alteração do produto. A execução às18:21:12 terminou com um caso aprovado. A fixture continua restrita, com evidências e metadados Storage sintéticos; não representa Supabase completo nem implantação remota.

TSC71657 terminou com diagnóstico de função `receive` não usada em teste SQL ainda em construção. Não foi declarado typecheck final desta etapa. A validação nativa do comando privado e a promoção da confirmação permanecem separadas.

Às18:24:59, a rodada integrada de root concluiu21 testes aprovados em cinco arquivos, incluindo este teste público e os sete testes do comando privado. 211740 congelada em SHAdf7590dceae582bddf72f86008a62de2f083d2c41642a2ec3993155b0abd9e25. Suplemento nativo12909 em execução; confirmação ainda não promovida.
