-- Add the Starcamp shared claim board to an existing installation.
-- This migration preserves existing trips, members, invitations, and checklist data.
begin;

create table if not exists public.campwell_claims (
  trip_id uuid not null references public.campwell_trips(id) on delete cascade,
  item_key text not null check (item_key in (
    'canopy', 'grill', 'tents', 'lights', 'chairs', 'cookware', 'cleaning',
    'speaker', 'bucket', 'water-dispenser', 'projector', 'hammocks',
    'inflatable-couch', 'heater', 'food-plan', 'grill-fuel', 'first-aid',
    'trash-bags', 'drinking-water', 'tableware', 'napkins', 'sodas',
    'desserts', 'bug-spray'
  )),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  display_name text not null check (
    display_name = btrim(display_name)
    and char_length(display_name) between 1 and 60
  ),
  claimed_at timestamptz not null default now(),
  primary key (trip_id, item_key)
);

create index if not exists campwell_claims_user_id_idx
  on public.campwell_claims (user_id);

alter table public.campwell_claims enable row level security;

drop policy if exists claims_read on public.campwell_claims;
create policy claims_read on public.campwell_claims for select to authenticated
  using (public.campwell_is_member(trip_id));

drop policy if exists claims_create on public.campwell_claims;
create policy claims_create on public.campwell_claims for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.campwell_verified_email() is not null
    and public.campwell_is_member(trip_id)
  );

drop policy if exists claims_remove on public.campwell_claims;
create policy claims_remove on public.campwell_claims for delete to authenticated
  using (
    (user_id = (select auth.uid()) or public.campwell_is_owner(trip_id))
    and public.campwell_is_member(trip_id)
  );

revoke all on public.campwell_claims from public, anon, authenticated;
grant select, insert, delete on public.campwell_claims to authenticated;

commit;
