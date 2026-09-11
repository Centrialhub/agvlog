# Agenda: review of source snapshot consistency (2026-09-11)

Root review identified an internal read race in the initial candidate writer: it checked cash_forecast_agenda_preview in one SQL statement and then collected the raw origin in a separate statement. The writer is VOLATILE; the two STABLE readers therefore can observe different calling-query snapshots. Company advisory locks do not prove that every direct source edit shares those locks.

An expected revision can consequently describe source A while the agenda event binds the raw revision of later source B. This would incorrectly display a non-stale manual date for an origin the operator never reviewed. Waiting-lock and stale-before-submit tests do not cover this internal interval.

Required proof before promotion: pause between the source readers, commit a direct source edit from a second PostgreSQL session, and show either rejection or a single internally consistent old snapshot whose agenda is immediately stale relative to the edited source. Never bind new-source evidence to the old expected revision.

A candidate fix reads preview and raw collection in one SQL statement, with both readers STABLE, then validates and writes from those returned values. Changes after that shared read may make the recorded expectation stale; this is truthful and does not mutate the financial origin. Source row locks can additionally serialize source edits but cannot replace coherent evidence for dependencies read from other tables.

Primary reference inspected: https://www.postgresql.org/docs/17/xfunc-volatility.html — STABLE readers use the snapshot of their calling query; VOLATILE functions obtain a fresh snapshot for each query executed. Native testing is still required to prove the actual writer and call graph, rather than treating documentation as proof of implementation.
