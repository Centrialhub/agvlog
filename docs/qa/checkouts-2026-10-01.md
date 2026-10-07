# Checkouts and active work — 2026-10-01

The canonical source base is main a0c9771cf7db2d6a65819a2252cd8fb2344dd869.
Active stabilization: `codex/stability-integrated-20261001`. It integrates PR3
0660cbd70ccb961e5e78cb446f1e8941c25eb01b and main in merge 3c476eb1e18f1936199afe123919cdcf65d66aa8.
It is local only and is not approved for deployment. Read the
[current execution log](release-log-2026-10-01-stability-consolidation.md) before
continuing; completed test SHAs and later source changes are recorded separately.

| Purpose | Exact checkout | Branch / identity |
| --- | --- | --- |
| Canonical editing on Windows | `C:/Users/Thomaz/Documents/Codex/2026-10-01/task/canonical` | `codex/stability-integrated-20261001`; verify `git rev-parse HEAD` and status |
| Canonical Node22/npm10/Linux validation | `/home/agvqa/agvlog-stability-20261001` in WSL Ubuntu-24.04, user `agvqa` | Same branch; synchronize reviewed commits by local bundles, never assume file copies succeeded |
| Separate billing on Windows | `C:/Users/Thomaz/Documents/Codex/2026-10-01/task/billing` | `codex/cte-billing-isolated-20261001`, clean `de45d927f79aa03e43d0b89266b059f30a3a5361` at this inventory |
| Separate billing Linux validation | `/home/agvqa/agvlog-billing-20261001` | Same billing branch and SHA; 46 focused tests passed separately |
| Original synthetic application staging | Canonical `.local-staging`, project `agvlog-local-staging` | Loopback API55321/DB55322,7synthetic users, 2 tenants; preserve linked evidence/audit, do not reset for another test |
| Independent pristine restore/return proof | `/home/agvqa/agvlog-pristine-restore-20261001` | Project of same name, separate loopback ports56320-56329; see execution log |

F:/agvlog-main is a legacy workspace with 1,601 status entries. Do not reset,
clean, publish, or use it as the default working directory. The three
F:/agvlog-main-release-* directories and the 20 registered worktrees remain
intact. Release-check contains an exclusive commit e5c2ded4. Geofence and
load-creation branches also contain commits outside current main; clean status
does not establish that a checkout is disposable.

The legacy `cte-billing-prod` checkout still contains its original uncommitted
tomador-based billing package. It was preserved, then made reviewable in the new
separate billing checkouts above. Migration 20260929202823, wizard, hooks and
rollout scripts are excluded from stabilization. Do not integrate that package
or change its SQL while carrying out this stabilization scope.

Preservation is stored outside this repository in preservation-20261001,
with restricted Windows ACLs, complete history bundles, binary index/worktree
patches, file copies, and a private SHA-256 inventory for 22 checkouts.
Private files are not committed. Generated dependency/build directories are
rebuildable and are not claimed as preserved artifacts. Additional ignored
recovery directories require classification before any deletion. Preservation
contains 65 refs, 22 HEADs, 1,740 pending files and 20,470 ignored recovery files verified
by private hashes. Permission-denied baseline capture paths remain denied;
restoration used the separately reviewed private artifact, never bypassed ACLs.

The existing PR3 hosted preview points to production Supabase. Do not run
mutating tests there. Use only verified local isolated services and synthetic
fixtures; confirm release SHA and backend origin before browser tests.

For future agents: read AGENTS.md, production-stability-playbook-2026-09-26.md,
local-staging-guide.md, and the stabilization execution log. Never infer
publication, SQL parity, or successful journeys from Vercel READY alone.

The four driver-expense E2E failures are an explicit contract decision pending
with the owner: the operational UI invokes APIs deliberately denied to drivers
by the current financial boundary. Preserve those failing assertions and existing
permissions until that decision is authorized. SQL lint bruto (31 erros) remains blocked;
the [current triage](local-database-lint-triage-2026-10-01.md) identifies retained
APIs and the external consumer evidence still required. The
[hosted CI prerequisites](ci-private-baseline-handoff-2026-10-01.md) describe
review/authorization steps without transferring a dump or adding credentials.
