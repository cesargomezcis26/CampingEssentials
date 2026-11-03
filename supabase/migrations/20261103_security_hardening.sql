-- For an existing Starcamp installation: run once in Supabase SQL Editor.
-- No tables or user data are deleted. Refresh grants, identity checks, and policies.
begin;

-- Restore enforcement even if RLS was accidentally switched off in the dashboard.
alter table public.campwell_trips enable row level security;
alter table public.campwell_members enable row level security;
alter table public.campwell_invitations enable row level security;
alter table public.campwell_fields enable row level security;
alter table public.campwell_personal_fields enable row level security;

-- Resolve identity from the current account, not a stale JWT email claim.
-- SECURITY DEFINER is required to inspect only the caller's auth.users row.
create or replace function public.campwell_verified_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(email) from auth.users
  where id = auth.uid() and email_confirmed_at is not null
    and not coalesce(is_anonymous, false) and email is not null;
$$;


create or replace function public.campwell_is_owner(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.campwell_verified_email() is not null and exists (select 1 from public.campwell_trips where id = target and owner_id = auth.uid());
$$;

create or replace function public.campwell_is_member(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.campwell_verified_email() is not null and (public.campwell_is_owner(target) or exists (
    select 1 from public.campwell_members where trip_id = target and user_id = auth.uid()
  ));
$$;

create or replace function public.campwell_join_trip(target uuid) returns void
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

drop policy if exists trips_read on public.campwell_trips;
create policy trips_read on public.campwell_trips for select to authenticated using (public.campwell_verified_email() is not null and (owner_id = auth.uid() or public.campwell_is_member(id)));

drop policy if exists trips_create on public.campwell_trips;
create policy trips_create on public.campwell_trips for insert to authenticated with check (owner_id = auth.uid() and public.campwell_verified_email() is not null);

drop policy if exists members_read on public.campwell_members;
create policy members_read on public.campwell_members for select to authenticated using (public.campwell_verified_email() is not null and (public.campwell_is_owner(trip_id) or user_id = auth.uid()));

-- Explicit grants: no anonymous data access or broad default table privileges.
revoke all on public.campwell_trips, public.campwell_members, public.campwell_invitations, public.campwell_fields, public.campwell_personal_fields from public, anon, authenticated;
grant select, insert on public.campwell_trips to authenticated;
grant select, delete on public.campwell_members to authenticated;
grant select, insert, delete on public.campwell_invitations to authenticated;
grant select, insert, update on public.campwell_fields, public.campwell_personal_fields to authenticated;
revoke all on function public.campwell_verified_email(), public.campwell_is_owner(uuid), public.campwell_is_member(uuid), public.campwell_valid_field(text,text), public.campwell_join_trip(uuid) from public, anon;
grant execute on function public.campwell_verified_email(), public.campwell_is_owner(uuid), public.campwell_is_member(uuid), public.campwell_valid_field(text,text), public.campwell_join_trip(uuid) to authenticated;

commit;
