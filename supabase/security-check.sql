-- READ ONLY: run in Supabase SQL Editor after applying the security migration.
-- These queries return configuration metadata, not passwords, tokens, or trip data.

-- Expect all five tables, each with row_security_enabled = true.
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as row_security_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in (
  'campwell_trips', 'campwell_members', 'campwell_invitations',
  'campwell_fields', 'campwell_personal_fields'
) order by c.relname;

-- Review the actual deployed policies. Unexpected extra permissive policies can
-- defeat the intended restrictions even if our own policies are present.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename like 'campwell\_%' escape '\'
order by tablename, policyname;

-- Expect anon privileges false. Authenticated access still depends on RLS.
select table_name, privilege_type,
       has_table_privilege('anon', 'public.' || table_name, privilege_type) as anon_allowed,
       has_table_privilege('authenticated', 'public.' || table_name, privilege_type) as authenticated_allowed
from (values ('campwell_trips'), ('campwell_members'), ('campwell_invitations'),
             ('campwell_fields'), ('campwell_personal_fields')) as tables(table_name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as privileges(privilege_type)
order by table_name, privilege_type;

-- Definer helpers must have search_path="". Expect anon_can_execute = false.
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer, p.proconfig as settings,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'campwell\_%' escape '\'
order by p.proname;

-- Storage is separate from planner RLS. Public images are intentional, but
-- uploads/updates/deletes should be restricted to authorized administrators.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'campsitePictures';
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'storage' and tablename = 'objects'
order by policyname;
