-- Allow three additional shared items without changing or deleting existing claims.
begin;

alter table public.campwell_claims
  drop constraint if exists campwell_claims_item_key_check;

alter table public.campwell_claims
  add constraint campwell_claims_item_key_check check (item_key in (
    'canopy', 'grill', 'tents', 'lights', 'chairs', 'cookware', 'cleaning',
    'speaker', 'bucket', 'water-dispenser', 'projector', 'hammocks',
    'inflatable-couch', 'heater', 'food-plan', 'grill-fuel', 'first-aid',
    'trash-bags', 'drinking-water', 'tableware', 'napkins', 'sodas',
    'desserts', 'bug-spray'
  ));

commit;
