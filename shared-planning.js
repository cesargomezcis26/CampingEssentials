/* Shared mode uses authenticated requests; SQL policies enforce all permissions. */
(() => {
  const $ = selector => document.querySelector(selector);
  const fields = [...document.querySelectorAll('[data-save]')];
  const byKey = new Map(fields.map(field => [field.dataset.save, field]));
  const status = $('#shared-status');
  const config = window.CAMPWELL_SUPABASE;
  const dirty = new Map();
  let user = null;
  let trip = null;
  let busy = false;
  let email = '';
  let client;
  const message = text => { status.textContent = text; };
  const check = result => { if (result.error) throw result.error; return result.data; };
  const personal = key => key.startsWith('personal-');
  const valueOf = field => field.type === 'checkbox' ? String(field.checked) : field.value;
  function applyValue(field, value) {
    if (field.type === 'checkbox') field.checked = value === true || value === 'true';
    else field.value = String(value ?? '').slice(0, field.maxLength > 0 ? field.maxLength : 150);
  }
  function lockFields() {
    fields.forEach(field => { field.disabled = busy || Boolean(trip && field.dataset.save.startsWith('trip-') && trip.owner_id !== user?.id); });
  }
  async function run(action) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('.shared-panel button').forEach(button => { button.disabled = true; });
    lockFields();
    try { await action(); }
    catch (error) { message(`Could not complete the request: ${error.message || 'Check your connection and try again.'}`); }
    finally {
      busy = false;
      document.querySelectorAll('.shared-panel button').forEach(button => { button.disabled = false; });
      lockFields();
    }
  }
  function confirmDiscard() { return dirty.size === 0 || window.confirm('Discard unsaved shared-plan changes?'); }
  function localMode() {
    trip = null;
    dirty.clear();
    window.campwellSharedMode = false;
    let values = {};
    try { values = JSON.parse(localStorage.getItem('campwell-plan-v1') || '{}') || {}; } catch { /* Defaults still work. */ }
    fields.forEach(field => applyValue(field, Object.hasOwn(values, field.dataset.save) ? values[field.dataset.save] : planDefaults.get(field.dataset.save)));
    $('#shared-trip').hidden = true;
    $('#planning-status').textContent = 'Local mode: changes save only in this browser and are not shared with friends.';
    lockFields();
  }
  async function listTrips() {
    const trips = check(await client.from('campwell_trips').select('id,name,owner_id').order('created_at', { ascending: false }));
    $('#trip-select').replaceChildren(new Option('Choose a trip', ''));
    trips.forEach(item => $('#trip-select').add(new Option(item.name, item.id)));
    if (trip) $('#trip-select').value = trip.id;
  }
  async function loadTrip(id) {
    // Read everything before replacing the current plan, so failures preserve edits.
    const selected = check(await client.from('campwell_trips').select('id,name,owner_id').eq('id', id).single());
    const shared = check(await client.from('campwell_fields').select('key,value').eq('trip_id', id));
    const own = check(await client.from('campwell_personal_fields').select('key,value').eq('trip_id', id).eq('user_id', user.id));
    trip = selected;
    window.campwellSharedMode = true;
    dirty.clear();
    fields.forEach(field => {
      const key = field.dataset.save;
      applyValue(field, key.startsWith('shared-') && key.endsWith('-owner') ? 'Organizer' : planDefaults.get(key));
    });
    [...shared, ...own].forEach(row => { if (byKey.has(row.key)) applyValue(byKey.get(row.key), row.value); });
    $('#shared-trip').hidden = false;
    $('#active-trip-name').textContent = trip.name;
    $('#trip-id-label').textContent = `Trip ID: ${trip.id}`;
    $('#invite-form').hidden = $('#invite-help').hidden = trip.owner_id !== user.id;
    $('#planning-status').textContent = 'Shared mode: click Save changes after editing. Your personal checks are private to your account. Only the organizer can edit trip details.';
    lockFields();
    message('Shared trip loaded. No unsaved changes.');
  }
  if (!config?.publishableKey) {
    message('Shared mode is not configured yet. Complete supabase/README.md; local planning below still works.');
    return;
  }
  // Reject obvious privileged keys; only a publishable key belongs in browser config.
  if (!config.publishableKey.startsWith('sb_publishable_') || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(config.url)) {
    message('Use a Supabase HTTPS project URL and a public sb_publishable_ key in supabase-config.js. Never use a secret key.');
    return;
  }
  try {
    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, detectSessionInUrl: false, autoRefreshToken: true }
    });
  } catch { message('Could not initialize Supabase. Local planning is still available.'); return; }
  $('#shared-signin').hidden = false;
  message('Sign in by email to create or join a private trip. Reloading the page requires signing in again.');
  fields.forEach(field => field.addEventListener('input', () => {
    if (!trip) return;
    dirty.set(field.dataset.save, valueOf(field));
    message(`${dirty.size} unsaved field change${dirty.size === 1 ? '' : 's'}. Click Save changes.`);
  }));
  $('#email-form').addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      email = $('#signin-email').value.trim().toLowerCase();
      check(await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }));
      $('#code-form').hidden = false;
      message('Check your email for a sign-in code. Enter it below.');
    });
  });
  $('#code-form').addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      const data = check(await client.auth.verifyOtp({ email, token: $('#signin-code').value.trim(), type: 'email' }));
      user = data.user;
      $('#signin-code').value = '';
      $('#shared-signin').hidden = true;
      $('#shared-account').hidden = false;
      $('#account-label').textContent = `Signed in as ${user.email}`;
      await listTrips();
      message('Signed in. Create a trip, open a trip, or accept your organizer’s invitation.');
    });
  });
  $('#create-trip-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!confirmDiscard()) return;
    run(async () => {
      const name = $('#new-trip-name').value.trim();
      if (!name) throw new Error('Enter a trip name.');
      const created = check(await client.from('campwell_trips').insert({ name, owner_id: user.id }).select('id').single());
      // Refresh the list first so a failed detail load still leaves the new trip accessible.
      await listTrips();
      $('#trip-select').value = created.id;
      await loadTrip(created.id);
    });
  });
  $('#open-trip').addEventListener('click', () => {
    const id = $('#trip-select').value;
    if (id && confirmDiscard()) run(() => loadTrip(id));
  });
  $('#join-trip-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!confirmDiscard()) return;
    run(async () => {
      const id = $('#join-trip-id').value.trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Enter the complete trip ID.');
      check(await client.rpc('campwell_join_trip', { target: id }));
      await listTrips();
      await loadTrip(id);
    });
  });
  $('#invite-form').addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      const inviteEmail = $('#invite-email').value.trim().toLowerCase();
      const result = await client.from('campwell_invitations').insert({ trip_id: trip.id, email: inviteEmail });
      if (result.error?.code !== '23505') check(result);
      message('Email allowed. Share the page and trip ID privately with your friend; no invitation email was sent.');
      $('#invite-email').value = '';
    });
  });
  $('#save-trip').addEventListener('click', () => {
    if (fields.some(field => !field.disabled && !field.reportValidity())) return;
    run(async () => {
    const start = $('#trip-start').value, end = $('#trip-end').value;
    if (start && end && end < start) throw new Error('Departure must be on or after arrival.');
    // Save only edited fields, preserving other people’s changes to unrelated fields.
    // Successful fields leave the queue; failures retain the remaining edits for retry.
    for (const [key, value] of [...dirty]) {
      const own = personal(key);
      const row = { trip_id: trip.id, key, value, ...(own ? { user_id: user.id } : {}) };
      const table = own ? 'campwell_personal_fields' : 'campwell_fields';
      const result = await client.from(table).upsert(row, { onConflict: own ? 'trip_id,user_id,key' : 'trip_id,key' }).select('key');
      check(result);
      if (result.data.length !== 1) throw new Error('A field was not saved. Check trip access and retry.');
      dirty.delete(key);
    }
    message('All changes saved to Supabase. Friends can refresh to see shared updates.');
    });
  });
  $('#refresh-trip').addEventListener('click', () => { if (trip && confirmDiscard()) run(() => loadTrip(trip.id)); });
  $('#local-mode').addEventListener('click', () => {
    if (confirmDiscard()) { localMode(); message('Using your local plan. Shared data remains in Supabase.'); }
  });
  $('#signout').addEventListener('click', () => {
    if (!confirmDiscard()) return;
    run(async () => {
      check(await client.auth.signOut({ scope: 'local' }));
      user = null;
      localMode();
      $('#shared-account').hidden = true;
      $('#shared-signin').hidden = false;
      $('#code-form').hidden = true;
      $('#trip-select').replaceChildren(new Option('Choose a trip', ''));
      $('#account-label').textContent = '';
      message('Signed out. Local planning is available.');
    });
  });
  window.addEventListener('beforeunload', event => {
    if (dirty.size) { event.preventDefault(); event.returnValue = ''; }
  });
  client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT' && user) {
      user = null;
      localMode();
      $('#shared-account').hidden = true;
      $('#shared-signin').hidden = false;
      message('Session ended. Sign in again to access shared trips.');
    }
  });
})();
