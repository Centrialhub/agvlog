alter table public.positions_last
  add constraint positions_last_valid_coordinates_check
  check (lat between -90 and 90 and lng between -180 and 180)
  not valid;

comment on constraint positions_last_valid_coordinates_check on public.positions_last is
  'Rejects new non-finite or out-of-range latest positions without blocking cleanup of legacy invalid rows.';
