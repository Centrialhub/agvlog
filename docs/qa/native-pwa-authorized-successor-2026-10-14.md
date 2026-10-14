# Authorized PWA successor

Isolated task native-pwa-authorized-successor-20261014, owner CodexMerge, based on frozen416b3c6e with PWA ebf1a31bf373a00f5513a15598ca35c58ade93ff. Previous commits/checkouts/evidence, SQL/Storage and Native data remain preserved. No integration or publication.

Specific authorization14Oct13:37UTC covers local previously confirmed driver UI context bound to actor/session/company, no password/token storage, expiry limited by original JWT/SDK and seven days, logout/online denial invalidation. Offline decoding does not verify JWT signature or observe disconnected server revocation. Server authorization is unchanged. Legacy explicit navigator=false bootstrap is unchanged; new guarantees describe only the new transport fallback.

Normal approval review accepted the same six-path draft after the original rejected command could not be recovered; no bypass. Associated input QA131tests/11suites and5gates PASS. Nine extra boundary cases exposed five failures then fixed, including mounted expiry and immediate binding loss during pending read.

This note precedes exact-successor QA. Root must test combined SHA and real transport outage with navigator.onLine=true, reload/cold restart/online return preserving existing expense/PDF. Original416b CI/Native results retain their original SHA; full successor CI/device acceptance and publication remain separate gates.
