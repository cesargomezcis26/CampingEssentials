-- Run once in Supabase SQL Editor. Uses only new campwell_* objects.
-- No changes to Storage, existing tables, or authentication settings.
begin;

create table public.campwell_trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 150),
  created_at timestamptz not null default now()
);
create table public.campwell_members (
  trip_id uuid not null references public.campwell_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (trip_id, user_id)
);
create table public.campwell_invitations (
  trip_id uuid not null references public.campwell_trips(id) on delete cascade,
  email text not null check (email = lower(trim(email)) and char_length(email) between 3 and 254 and email like '%@%'),
  primary key (trip_id, email)
);

-- Definer helpers avoid recursive membership policies. No caller-supplied user ID.
-- Resolve identity from the current account, not a stale JWT email claim.
-- SECURITY DEFINER is required to inspect only the caller's auth.users row.
create or replace function public.campwell_verified_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(email) from auth.users
  where id = auth.uid() and email_confirmed_at is not null
    and not coalesce(is_anonymous, false) and email is not null;
$$;

create function public.campwell_is_owner(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.campwell_verified_email() is not null and exists (select 1 from public.campwell_trips where id = target and owner_id = auth.uid());
$$;
create function public.campwell_is_member(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.campwell_verified_email() is not null and (public.campwell_is_owner(target) or exists (
    select 1 from public.campwell_members where trip_id = target and user_id = auth.uid()
  ));
$$;

create function public.campwell_valid_field(field_key text, field_value text) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if field_key like '%-packed' then return field_value in ('true','false'); end if;
  if field_key like '%-quantity' or field_key = 'trip-guests' then
    return field_value = '' or (field_value ~ '^[0-9]{1,3}$' and field_value::int between case when field_key = 'trip-guests' then 1 else 0 end and 999);
  end if;
  if field_key in ('trip-start','trip-end') then
    if field_value = '' then return true; end if;
    if field_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
    perform field_value::date;
    return true;
  end if;
  return char_length(field_value) <= case when field_key like '%-owner' then 80 else 150 end;
exception when others then return false;
end;
$$;
create table public.campwell_fields (
  trip_id uuid not null references public.campwell_trips(id) on delete cascade,
  key text not null check (key in ('trip-location', 'trip-start', 'trip-end', 'trip-guests', 'shared-0-packed', 'shared-0-owner', 'shared-0-quantity', 'shared-1-packed', 'shared-1-owner', 'shared-1-quantity', 'shared-2-packed', 'shared-2-owner', 'shared-2-quantity', 'shared-3-packed', 'shared-3-owner', 'shared-3-quantity', 'shared-4-packed', 'shared-4-owner', 'shared-4-quantity', 'shared-5-packed', 'shared-5-owner', 'shared-5-quantity', 'shared-6-packed', 'shared-6-owner', 'shared-6-quantity', 'shared-7-packed', 'shared-7-owner', 'shared-7-quantity', 'shared-8-packed', 'shared-8-owner', 'shared-8-quantity', 'shared-9-packed', 'shared-9-owner', 'shared-9-quantity', 'optional-0-packed', 'optional-0-owner', 'optional-0-quantity', 'optional-1-packed', 'optional-1-owner', 'optional-1-quantity', 'optional-2-packed', 'optional-2-owner', 'optional-2-quantity', 'optional-3-packed', 'optional-3-owner', 'optional-3-quantity', 'needed-0-packed', 'needed-0-owner', 'needed-0-quantity', 'needed-1-packed', 'needed-1-owner', 'needed-1-quantity', 'needed-2-packed', 'needed-2-owner', 'needed-2-quantity', 'needed-3-packed', 'needed-3-owner', 'needed-3-quantity', 'needed-4-packed', 'needed-4-owner', 'needed-4-quantity', 'needed-5-packed', 'needed-5-owner', 'needed-5-quantity', 'needed-6-packed', 'needed-6-owner', 'needed-6-quantity')),
  value text not null,
  check (public.campwell_valid_field(key, value)),
  primary key (trip_id, key)
);
create table public.campwell_personal_fields (
  trip_id uuid not null references public.campwell_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  key text not null check (key in ('personal-0-packed', 'personal-1-packed', 'personal-2-packed', 'personal-3-packed', 'personal-4-packed', 'personal-5-packed')),
  value text not null check (value in ('true','false')),
  primary key (trip_id, user_id, key)
);

alter table public.campwell_trips enable row level security;
alter table public.campwell_members enable row level security;
alter table public.campwell_invitations enable row level security;
alter table public.campwell_fields enable row level security;
alter table public.campwell_personal_fields enable row level security;

create policy trips_read on public.campwell_trips for select to authenticated using (public.campwell_verified_email() is not null and (owner_id = auth.uid() or public.campwell_is_member(id)));
create policy trips_create on public.campwell_trips for insert to authenticated with check (owner_id = auth.uid() and public.campwell_verified_email() is not null);
-- Owners cannot be reassigned through the browser API.
create policy members_read on public.campwell_members for select to authenticated using (public.campwell_verified_email() is not null and (public.campwell_is_owner(trip_id) or user_id = auth.uid()));
create policy members_remove on public.campwell_members for delete to authenticated using (public.campwell_is_owner(trip_id));
create policy invitations_read on public.campwell_invitations for select to authenticated using (public.campwell_is_owner(trip_id));
create policy invitations_create on public.campwell_invitations for insert to authenticated with check (public.campwell_is_owner(trip_id));
create policy invitations_remove on public.campwell_invitations for delete to authenticated using (public.campwell_is_owner(trip_id));
create policy fields_read on public.campwell_fields for select to authenticated using (public.campwell_is_member(trip_id));
create policy fields_create on public.campwell_fields for insert to authenticated with check (
  public.campwell_is_member(trip_id) and (key not like 'trip-%' or public.campwell_is_owner(trip_id))
);
create policy fields_update on public.campwell_fields for update to authenticated using (
  public.campwell_is_member(trip_id) and (key not like 'trip-%' or public.campwell_is_owner(trip_id))
) with check (public.campwell_is_member(trip_id) and (key not like 'trip-%' or public.campwell_is_owner(trip_id)));
create policy personal_read on public.campwell_personal_fields for select to authenticated using (user_id = auth.uid() and public.campwell_is_member(trip_id));
create policy personal_create on public.campwell_personal_fields for insert to authenticated with check (user_id = auth.uid() and public.campwell_is_member(trip_id));
create policy personal_update on public.campwell_personal_fields for update to authenticated using (user_id = auth.uid() and public.campwell_is_member(trip_id)) with check (user_id = auth.uid() and public.campwell_is_member(trip_id));

-- Knowing a trip ID is insufficient: the signed-in email must be invited.
create function public.campwell_join_trip(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.campwell_verified_email() is null then raise exception 'Sign in with a verified email first'; end if;
  if public.campwell_is_member(target) then return; end if;
  delete from public.campwell_invitations
    where trip_id = target and email = public.campwell_verified_email();
  if not found then raise exception 'No invitation for this account'; end if;
  insert into public.campwell_members (trip_id,user_id) values (target,auth.uid()) on conflict do nothing;
end;
$$;

-- Explicit grants: no anonymous data access or broad default table privileges.
revoke all on public.campwell_trips, public.campwell_members, public.campwell_invitations, public.campwell_fields, public.campwell_personal_fields from public, anon, authenticated;
grant select, insert on public.campwell_trips to authenticated;
grant select, delete on public.campwell_members to authenticated;
grant select, insert, delete on public.campwell_invitations to authenticated;
grant select, insert, update on public.campwell_fields, public.campwell_personal_fields to authenticated;
revoke all on function public.campwell_verified_email(), public.campwell_is_owner(uuid), public.campwell_is_member(uuid), public.campwell_valid_field(text,text), public.campwell_join_trip(uuid) from public, anon;
grant execute on function public.campwell_verified_email(), public.campwell_is_owner(uuid), public.campwell_is_member(uuid), public.campwell_valid_field(text,text), public.campwell_join_trip(uuid) to authenticated;
commit;
