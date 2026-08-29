drop policy if exists "Internal roles read driver direct messages"
  on public.driver_direct_messages;
drop policy if exists "Drivers read own direct messages"
  on public.driver_direct_messages;
drop policy if exists "Internal roles send driver direct messages"
  on public.driver_direct_messages;
drop policy if exists "Drivers send own direct messages"
  on public.driver_direct_messages;

create policy "Authorized users read driver direct messages"
  on public.driver_direct_messages
  for select
  to authenticated
  using (
    public.is_user_internal_role(tenant_id)
    or driver_id = public.current_driver_id(tenant_id)
  );

create policy "Authorized users send driver direct messages"
  on public.driver_direct_messages
  for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and (
      (
        public.is_user_internal_role(tenant_id)
        and sender_role in ('owner', 'admin', 'operator')
      )
      or (
        driver_id = public.current_driver_id(tenant_id)
        and sender_role = 'driver'
      )
    )
  );

drop policy if exists "Internal roles read event messages"
  on public.operational_event_messages;
drop policy if exists "Drivers read own event messages"
  on public.operational_event_messages;
drop policy if exists "Internal roles send event messages"
  on public.operational_event_messages;
drop policy if exists "Drivers send own event messages"
  on public.operational_event_messages;

create policy "Authorized users read event messages"
  on public.operational_event_messages
  for select
  to authenticated
  using (
    public.is_user_internal_role(tenant_id)
    or exists (
      select 1
      from public.operational_events oe
      where oe.id = operational_event_messages.event_id
        and oe.tenant_id = operational_event_messages.tenant_id
        and (
          oe.driver_id = public.current_driver_id(oe.tenant_id)
          or (oe.dispatch_trip_id is not null and public.driver_owns_trip(oe.dispatch_trip_id))
          or (oe.dispatch_stop_id is not null and public.driver_owns_stop(oe.dispatch_stop_id))
        )
    )
  );

create policy "Authorized users send event messages"
  on public.operational_event_messages
  for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and (
      (
        public.is_user_internal_role(tenant_id)
        and sender_role in ('owner', 'admin', 'operator')
      )
      or (
        sender_role = 'driver'
        and exists (
          select 1
          from public.operational_events oe
          where oe.id = operational_event_messages.event_id
            and oe.tenant_id = operational_event_messages.tenant_id
            and (
              oe.driver_id = public.current_driver_id(oe.tenant_id)
              or (oe.dispatch_trip_id is not null and public.driver_owns_trip(oe.dispatch_trip_id))
              or (oe.dispatch_stop_id is not null and public.driver_owns_stop(oe.dispatch_stop_id))
            )
        )
      )
    )
  );
