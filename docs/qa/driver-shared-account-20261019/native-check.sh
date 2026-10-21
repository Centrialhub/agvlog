#!/bin/sh
set -eu
name=agvlog-driver-shared-20261019
root=/mnt/f/AGVLOG/work/driver-shared-account-20261019
docker start "$name" >/dev/null
for i in 1 2 3 4 5; do
  docker exec "$name" pg_isready -h /tmp -U postgres >/dev/null 2>&1 && break
  sleep 1
done
psql() { docker exec -i "$name" psql -X -h /tmp -U postgres -v ON_ERROR_STOP=1 "$@"; }
if [ "$(psql -Atc "select count(*) from pg_namespace where nspname='auth'")" = 0 ]; then
  psql < /mnt/f/AGVLOG/checks/driver-shared-account-native-fixture-20261019.sql
fi
psql < "$root/supabase/migrations/20261019171216_driver_shared_workspace_account_creation.sql"
psql < "$root/docs/qa/driver-shared-account-20261019/native-check.sql"
psql -c "set role service_role;select public.prepare_driver_access_v1('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000005','qa.concurrent.first@usuario.com','driver-access-synthetic-nonce-at-least-32-characters-0001');"
psql -c "set role service_role;select public.prepare_driver_access_v1('21000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000006','qa.concurrent.second@usuario.com','driver-access-synthetic-nonce-at-least-32-characters-0002');"
docker exec -i -e PGAPPNAME=driver_shared_first "$name" psql -X -h /tmp -U postgres -v ON_ERROR_STOP=1 < "$root/docs/qa/driver-shared-account-20261019/native-first-session.sql" > /mnt/f/AGVLOG/checks/driver-shared-native-first.log 2>&1 &
first=$!
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleeping=$(psql -Atc "select count(*) from pg_stat_activity where application_name='driver_shared_first' and wait_event='PgSleep'")
  [ "$sleeping" = 1 ] && break
  sleep 0.1
done
[ "$sleeping" = 1 ]
if psql < "$root/docs/qa/driver-shared-account-20261019/native-second-session.sql" > /mnt/f/AGVLOG/checks/driver-shared-native-second.log 2>&1; then
  echo 'Second identity unexpectedly committed'; exit 1
fi
wait "$first"
grep 'driver_unavailable_or_already_linked' /mnt/f/AGVLOG/checks/driver-shared-native-second.log
psql -c "do \$test\$ begin if (select count(*) from auth.users where id='11000000-0000-4000-8000-000000000007')<>1 or exists(select 1 from auth.users where id='11000000-0000-4000-8000-000000000008') or (select count(*) from drivers where user_id='11000000-0000-4000-8000-000000000007')<>2 then raise exception 'native_concurrent_creation_failed';end if;end;\$test\$;"
echo 'Native MVCC: competing AGV/LIRA creation rejected, one account and two links committed'
psql -Atc "select n.nspname||'.'||p.proname||' '||md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in('prepare_driver_access_v1','enforce_invite_only_auth_user','attach_invited_user_access_v1','guard_driver_account_scope_v1','driver_workspace_creation_scope_v1') order by p.proname"
