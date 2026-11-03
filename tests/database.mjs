import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, is_anonymous boolean default false); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email',current_setting('request.jwt.claim.email',true)) $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
await db.exec(fs.readFileSync(process.env.STARCAMP_SCHEMA_PATH || new URL('../supabase/setup.sql', import.meta.url),'utf8'));
if (!process.env.STARCAMP_SCHEMA_PATH || process.env.STARCAMP_APPLY_HARDENING === 'true') {
  // Also exercise the existing-installation upgrade twice: it must preserve data and be repeatable.
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261103_security_hardening.sql', import.meta.url),'utf8'));
}
const owner='11111111-1111-4111-8111-111111111111', friend='22222222-2222-4222-8222-222222222222', outsider='33333333-3333-4333-8333-333333333333';
await db.exec(`insert into auth.users(id,email,email_confirmed_at) values ('${owner}','owner@example.invalid',now()),('${friend}','friend@example.invalid',now()),('${outsider}','outsider@example.invalid',now());`);
async function as(id,email){ await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`,[id,email]);await db.exec('set role authenticated'); }
async function denied(fn,label){await assert.rejects(fn,label);console.log('PASS:',label)}
await as(owner,'owner@example.invalid');
const {rows:[trip]}=await db.query("insert into public.campwell_trips(name) values ('Test camp') returning id");
await db.query("insert into public.campwell_fields values ($1,'trip-location','Test canyon'),($1,'shared-0-owner','Organizer')",[trip.id]);
await db.query("insert into public.campwell_invitations values ($1,'friend@example.invalid')",[trip.id]);
await as(outsider,'outsider@example.invalid');
assert.equal((await db.query('select * from public.campwell_trips')).rows.length,0);
assert.equal((await db.query('select * from public.campwell_fields')).rows.length,0);
await denied(()=>db.query("insert into public.campwell_fields values ($1,'shared-1-owner','Intruder')",[trip.id]),'outsider writes denied');
await denied(()=>db.query('select public.campwell_join_trip($1)',[trip.id]),'uninvited join denied');
await denied(()=>db.query('insert into public.campwell_members values ($1,$2)',[trip.id,outsider]),'direct self-enrollment denied');
// An older still-valid JWT may contain the previous email after an account changes it.
await db.exec('reset role');
await db.query("update auth.users set email='new-address@example.invalid' where id=$1",[friend]);
await as(friend,'friend@example.invalid');
await denied(()=>db.query('select public.campwell_join_trip($1)',[trip.id]),'stale JWT email cannot accept invitation for previous address');
await db.exec('reset role');
await db.query("update auth.users set email='friend@example.invalid' where id=$1",[friend]);
await as(friend,'friend@example.invalid');await db.query('select public.campwell_join_trip($1)',[trip.id]);
assert.equal((await db.query('select * from public.campwell_trips')).rows.length,1);
await db.query("update public.campwell_fields set value='Friend' where trip_id=$1 and key='shared-0-owner'",[trip.id]);
assert.equal((await db.query("select value from public.campwell_fields where key='shared-0-owner'")).rows[0].value,'Friend');
assert.equal((await db.query("update public.campwell_fields set value='Hijacked' where key='trip-location' returning *")).rows.length,0);
await denied(()=>db.query("insert into public.campwell_fields values ($1,'trip-guests','5')",[trip.id]),'member trip-detail creation denied');
await denied(()=>db.query("insert into public.campwell_invitations values ($1,'outsider@example.invalid')",[trip.id]),'member invitations denied');
await db.query("insert into public.campwell_personal_fields values ($1,$2,'personal-0-packed','true')",[trip.id,friend]);
await denied(()=>db.query("insert into public.campwell_personal_fields values ($1,$2,'personal-1-packed','true')",[trip.id,owner]),'writing another person’s checks denied');
await as(owner,'owner@example.invalid');
assert.equal((await db.query('select * from public.campwell_personal_fields')).rows.length,0);
assert.equal((await db.query('select * from public.campwell_invitations')).rows.length,0);
await denied(()=>db.query("insert into public.campwell_fields values ($1,'shared-0-quantity','-2')",[trip.id]),'invalid quantity denied');
await denied(()=>db.query("insert into public.campwell_fields values ($1,'trip-start','2026-02-31')",[trip.id]),'invalid date denied');
await denied(()=>db.query("insert into public.campwell_fields values ($1,'unknown-key','x')",[trip.id]),'unknown field denied');
// SQL-looking payloads stay literal values, and UUID function arguments remain typed.
const payload = "Robert'); DROP TABLE public.campwell_trips;--";
await db.query("update public.campwell_fields set value=$1 where key='shared-0-owner'",[payload]);
assert.equal((await db.query("select value from public.campwell_fields where key='shared-0-owner'")).rows[0].value,payload);
assert.equal((await db.query('select * from public.campwell_trips')).rows.length,1);
await denied(()=>db.query('select public.campwell_join_trip($1)',["x'); DROP TABLE public.campwell_trips;--"]),'malformed UUID/SQL injection rejected');
await denied(()=>db.query('update public.campwell_trips set owner_id=$1',[friend]),'trip ownership cannot be overwritten');
await denied(()=>db.query("insert into public.campwell_fields values ($1,'shared-1-owner',$2)",[trip.id,'x'.repeat(81)]),'oversized field rejected');
await denied(()=>db.query("insert into public.campwell_fields values ($1,'shared-1-packed','yes')",[trip.id]),'nonboolean packing value rejected');
await denied(()=>db.query("insert into public.campwell_fields values ($1,'shared-1-quantity','0;delete from auth.users')",[trip.id]),'SQL text in numeric field rejected');
// Updating a primary key must check the destination trip and user too.
await as(outsider,'outsider@example.invalid');
const {rows:[otherTrip]}=await db.query("insert into public.campwell_trips(name) values ('Private other trip') returning id");
await db.query("insert into public.campwell_fields values ($1,'shared-0-owner','Other owner')",[otherTrip.id]);
await as(friend,'friend@example.invalid');
await denied(()=>db.query("update public.campwell_fields set trip_id=$1 where trip_id=$2 and key='shared-0-owner'",[otherTrip.id,trip.id]),'cross-trip row reassignment rejected');
await denied(()=>db.query("update public.campwell_personal_fields set user_id=$1 where trip_id=$2",[owner,trip.id]),'personal record ownership reassignment rejected');
assert.equal((await db.query('select * from public.campwell_fields where trip_id=$1',[otherTrip.id])).rows.length,0);
// An account cannot bypass email confirmation by using the authenticated role.
await db.exec('reset role');
await db.query('update auth.users set email_confirmed_at=null where id=$1',[outsider]);
await as(outsider,'outsider@example.invalid');
assert.equal((await db.query('select * from public.campwell_trips')).rows.length,0);
await denied(()=>db.query("insert into public.campwell_trips(name) values ('Unverified')"),'unverified account cannot create trips');
await db.exec('reset role');
await db.query('update auth.users set email_confirmed_at=now(),is_anonymous=true where id=$1',[outsider]);
await as(outsider,'outsider@example.invalid');
assert.equal((await db.query('select * from public.campwell_trips')).rows.length,0);
await denied(()=>db.query("insert into public.campwell_trips(name) values ('Anonymous')"),'anonymous authenticated account cannot create trips');
await as(owner,'owner@example.invalid');
if (!process.env.STARCAMP_SCHEMA_PATH || process.env.STARCAMP_APPLY_HARDENING === 'true') {
  await db.exec('reset role');
  // Simulate accidental dashboard changes; the migration must restore RLS.
  await db.exec('alter table public.campwell_fields disable row level security');
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261103_security_hardening.sql', import.meta.url),'utf8'));
  await as(owner,'owner@example.invalid');
  assert.equal((await db.query('select count(*)::int as count from public.campwell_trips')).rows[0].count,1);
  console.log('PASS: repeated hardening migration preserves existing private records');
}
await db.query('delete from public.campwell_members where trip_id=$1 and user_id=$2',[trip.id,friend]);
await as(friend,'friend@example.invalid');
assert.equal((await db.query('select * from public.campwell_fields')).rows.length,0);
await denied(()=>db.query('select public.campwell_join_trip($1)',[trip.id]),'consumed invitation cannot restore revoked membership');
await db.exec('reset role;set role anon');
await denied(()=>db.query('select * from public.campwell_trips'),'anonymous reads denied');
for (const table of ['campwell_trips','campwell_members','campwell_invitations','campwell_fields','campwell_personal_fields']) {
  await denied(()=>db.query(`select * from public.${table}`),`anonymous reads denied: ${table}`);
  await denied(()=>db.query(`truncate public.${table} cascade`),`anonymous truncate denied: ${table}`);
}
await denied(()=>db.query('select public.campwell_verified_email()'),'anonymous identity helper execution denied');
await denied(()=>db.query('select public.campwell_join_trip($1)',[trip.id]),'anonymous join function execution denied');
await db.exec('reset role');
const {rows:tables}=await db.query("select relname,relrowsecurity from pg_class where relname in ('campwell_trips','campwell_members','campwell_invitations','campwell_fields','campwell_personal_fields')");
assert.equal(tables.length,5);assert(tables.every(t=>t.relrowsecurity));
await db.exec('create role unrelated_role; set role unrelated_role');
await denied(()=>db.query('select * from public.campwell_trips'),'PUBLIC does not inherit table access');
await denied(()=>db.query('select public.campwell_verified_email()'),'PUBLIC does not inherit definer function execution');
console.log('PASS: schema executed on PostgreSQL-compatible PGlite; private-trip reads, shared updates, personal isolation, invitation consumption, and revocation verified.');
await db.close();
