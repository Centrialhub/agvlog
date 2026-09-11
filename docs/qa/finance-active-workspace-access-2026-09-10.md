# Financeiro e workspace ativo — hardening local 2026-09-10

Migration criada via CLI: `20260910224136_finance_active_workspace_access.sql`. Não aplicada remotamente. Quatro testes PGlite e lint passaram (último executor5118 saída0); nenhum PostgreSQL nativo ou TSC.

A fundação212104 autoriza membership financeira e nega driver/misto, mas não liga o tenant solicitado ao workspace ativo. Usuário membro de dois tenants poderia solicitar o outro tenant diretamente. O client envia contexto, porém o cliente não é barreira de autorização.

Correção mínima da instalação fresca: manter a expressão financeira original e acrescentar claimactive_tenant_id presente + private.is_request_tenant_member(_tenant). Helperreal140823 exige claimassinado para authenticated e rejeita header divergente; helper131125 verifica membershipativa. Não reimplementar o parserclaim no financeiro nem usar metadata editável.

Migration exige helperexistente, função stable/securitydefiner e corpooriginal conhecido. Preserva OID/defaults/ACL via pg_get_functiondef. Corpo desconhecido falha. Corpo staged constantefalse é reconhecido e mantido byteporbyte, incluindoACL: **não é comando de ativação**. Quando aplicado ao staged, o aviso indica que a liberação final ainda precisa usar definição consciente do workspace; não restaurar original212104 posteriormente.

Teste real SETROLEauthenticated: claimausente comheadertenant não libera; headermismatchnega; claimtenantB não permitetenantA mesmo usuário membroduplo; claimcorreto permiteoperator/admin; membershipinativa, roleadicionaldriver e drivers.user_id ativo negam. Testes usam extrações integrais doshelpersworkspace131125+140823 e fundaçãofinanceiraoriginal, Authmínimo apenasparaJWT/uid. Não simulam is_request_tenant_member retornandotrue. ACLstagedpreservada e definição desconhecida recusada.

Falta declaim/mismatch pode produzir42501/22023 do helperemvezdebooleanfalse; isso é negação, jamaisfallbackdepermissão. Endpointexistente deve continuartratarerrocomoacessoinconfirmado. Ativação final epostconditions remotas são propriedade do coordenador.
