drop policy if exists "tenant members insert driver direct messages"
  on public.driver_direct_messages;
drop policy if exists "tenant members read driver direct messages"
  on public.driver_direct_messages;

create policy "Internal roles read driver direct messages"
  on public.driver_direct_messages
  for select
  to authenticated
  using (public.is_user_internal_role(tenant_id));

create policy "Drivers read own direct messages"
  on public.driver_direct_messages
  for select
  to authenticated
  using (driver_id = public.current_driver_id(tenant_id));

create policy "Internal roles send driver direct messages"
  on public.driver_direct_messages
  for insert
  to authenticated
  with check (
    public.is_user_internal_role(tenant_id)
    and sender_id = (select auth.uid())
    and sender_role in ('owner', 'admin', 'operator')
  );

create policy "Drivers send own direct messages"
  on public.driver_direct_messages
  for insert
  to authenticated
  with check (
    driver_id = public.current_driver_id(tenant_id)
    and sender_id = (select auth.uid())
    and sender_role = 'driver'
  );

drop policy if exists "tenant members insert event messages"
  on public.operational_event_messages;
drop policy if exists "tenant members read event messages"
  on public.operational_event_messages;

create policy "Internal roles read event messages"
  on public.operational_event_messages
  for select
  to authenticated
  using (public.is_user_internal_role(tenant_id));

create policy "Drivers read own event messages"
  on public.operational_event_messages
  for select
  to authenticated
  using (
    exists (
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

create policy "Internal roles send event messages"
  on public.operational_event_messages
  for insert
  to authenticated
  with check (
    public.is_user_internal_role(tenant_id)
    and sender_id = (select auth.uid())
    and sender_role in ('owner', 'admin', 'operator')
  );

create policy "Drivers send own event messages"
  on public.operational_event_messages
  for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and sender_role = 'driver'
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
  );
