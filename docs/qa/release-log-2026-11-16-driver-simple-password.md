# Senha simples de seis caracteres para motorista

Pedido explícito: permitir senha de seis caracteres, só letras ou só números, sem exigir maiúscula/minúscula/número combinados.

## Escopo e versões

- Base: `fb2103237e38f69c8f1219e68843580b139d6759`.
- Interface e validação compartilhada aceitam mínimo 6; senhas maiores continuam válidas. Rejeitar senha vazia/só espaços e excedente de 72 bytes do bcrypt. Não alterar senhas existentes.
- Configuração Auth do projeto: mínimo 6, requisitos de composição vazios. A política nativa é do projeto inteiro, não por papel; o formulário administrativo `SetPassword` mantém sua regra de 12 e composição. Não alegar que a regra nativa anterior permanece para administradores.
- Preservar proteção contra senhas vazadas, troca segura de senha/e-mail, sessões, rate limits, recuperação, signup desabilitado, tenant/role/workspace e comandos auditados.
- Sem SQL/migrações. Edge afetada exclusivamente `manage-driver-access`: versão ativa 9, JWT obrigatório, bundle SHA `db9dd2374e2ed6ea991a2573dcd14a48d52cfb374dd7953d0d1e1adf23c06a74`. Comparação completa: seis arquivos idênticos após normalizar LF; único delta em `_shared/driverCredentials.ts`. Snapshot integral de retorno preservado fora do cache, no recibo local do release.

## Validação

- Testes de validação: seis letras, seis dígitos, maiúsculas apenas e senha longa; negativos: cinco caracteres, espaços e overflow bcrypt.
- Handlers e formulário exercitam senhas simples mantendo os testes de reserva, recuperação e isolamento.
- Profile de aplicação isolada e hash vinculado atualizados para a mesma política. Bootstrap de infraestrutura histórica preservado.
- Novo teste nativo GoTrue roda por último na base descartável do CI: converte somente o motorista `.invalid` do seed pelo comando auditado, entra com seis letras, troca para seis dígitos, entra novamente, rejeita senha anterior e senha de cinco caracteres. URLs fora de `127.0.0.1:55321` e execução fora de CI são recusadas. Nenhum teste em credenciais reais de produção.
- Exigir Quality gate completo (validate, oito shards, database-and-e2e) e teste nativo novo antes de publicar. Guardar links/SHA/resultados no recibo final.

## Publicação e retorno

Antes de salvar a configuração global pelo navegador, confirmar seu alcance com o usuário conforme a política da ferramenta para redução de proteção de autenticação. Depois: configuração Auth, Edge somente reconciliada, frontend pelo Git/Vercel, conferir alias/SHA e regra exibida. Não publicar todas as Edge Functions.

Retorno compatível: manter a aceitação de login das senhas já escolhidas; restaurar a exigência anterior somente para novas definições não invalida hashes existentes. Retornar formulário/Edge pode voltar a exigir composição nas futuras trocas. Não resetar contas nem escrever hashes diretamente no banco.

Operação: ADM → Motoristas → cadastro → Acesso → Nova senha e Confirmar senha → Trocar senha. O administrador escolhe a senha na tela; não enviá-la no chat. Senhas comuns/vazadas podem continuar recusadas pelo serviço nativo.
