alter table public.positions_last
  add constraint positions_last_finite_captured_at_check
  check (isfinite(captured_at))
  not valid;

comment on constraint positions_last_finite_captured_at_check on public.positions_last is
  'Rejects new infinite latest-position timestamps while preserving legacy rows for controlled cleanup.';
