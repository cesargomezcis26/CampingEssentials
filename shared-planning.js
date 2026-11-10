(() => {
  const ITEMS = [
    ['canopy', 'Canopy', 'Camp setup'],
    ['grill', 'Grill', 'Camp kitchen'],
    ['tents', 'Tents', 'Shelter'],
    ['lights', 'Camp lights', 'Camp setup'],
    ['chairs', 'Camp chairs', 'Camp setup'],
    ['cookware', 'Cookware', 'Camp kitchen'],
    ['cleaning', 'Cleaning supplies & soap', 'Camp kitchen'],
    ['speaker', 'Speaker', 'Optional comfort'],
    ['bucket', 'Bucket', 'Camp setup'],
    ['water-dispenser', 'Water dispenser', 'Camp kitchen'],
    ['projector', 'Projector', 'Optional comfort'],
    ['hammocks', 'Hammocks', 'Optional comfort'],
    ['inflatable-couch', 'Inflatable couch', 'Optional comfort'],
    ['heater', 'Outdoor heater, if permitted', 'Cold weather'],
    ['food-plan', 'Food & meal plan', 'Camp kitchen'],
    ['grill-fuel', 'Grill fuel & lighter', 'Camp kitchen'],
    ['first-aid', 'First-aid kit', 'Safety'],
    ['trash-bags', 'Trash bags', 'Leave no trace'],
    ['drinking-water', 'Drinking water', 'Camp kitchen'],
    ['tableware', 'Cups, plates & utensils', 'Camp kitchen'],
    ['bug-spray', 'Bug spray', 'Personal comfort']
  ];

  const $ = selector => document.querySelector(selector);
  const config = window.CAMPWELL_SUPABASE;
  const state = {
    client: null,
    user: null,
    trip: null,
    trips: [],
    claims: new Map(),
    busy: false,
    sessionGeneration: 0,
    requestGeneration: 0,
    refreshTimer: null
  };

  const login = $('#planner-login');
  const setup = $('#trip-setup');
  const board = $('#claim-board');
  const authStatus = $('#shared-status');
  const boardStatus = $('#board-status');

  function setAuthStatus(text) { authStatus.textContent = text; }
  function setBoardStatus(text) { boardStatus.textContent = text; }
  function validate(result) {
    if (state.requestGeneration !== state.sessionGeneration) throw new Error('Your session ended. Sign in again.');
    if (result.error) throw result.error;
    return result.data;
  }
  function show(view) {
    login.hidden = view !== 'login';
    setup.hidden = view !== 'setup';
    board.hidden = view !== 'board';
  }
  function setBusy(value) {
    state.busy = value;
    document.querySelectorAll('.planner-shell button, .planner-shell input').forEach(control => { control.disabled = value; });
  }
  async function run(action, statusTarget = 'auth') {
    if (state.busy) return;
    setBusy(true);
    state.requestGeneration = state.sessionGeneration;
    try { await action(); }
    catch (error) {
      if (state.requestGeneration !== state.sessionGeneration) return;
      const message = error?.message || 'Check your connection and try again.';
      if (statusTarget === 'board') setBoardStatus(`Could not update the board: ${message}`);
      else setAuthStatus(`Could not complete the request: ${message}`);
    } finally { setBusy(false); }
  }
  function storedName() {
    try { return localStorage.getItem('starcamp-display-name') || ''; }
    catch { return ''; }
  }
  function saveName(name) {
    try { localStorage.setItem('starcamp-display-name', name); }
    catch { /* The name still works for this visit. */ }
  }
  function normalizeName() {
    const name = $('#display-name').value.trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('Add your name before claiming an item.');
    if (name.length > 60) throw new Error('Keep your display name under 60 characters.');
    $('#display-name').value = name;
    saveName(name);
    return name;
  }
  function clearRefresh() {
    if (state.refreshTimer) window.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
  function startRefresh() {
    clearRefresh();
    state.refreshTimer = window.setInterval(() => {
      if (state.trip && !state.busy && document.visibilityState === 'visible') refreshClaims(true);
    }, 6000);
  }

  function itemElement(item, claim) {
    const [key, label, category] = item;
    const article = document.createElement('article');
    article.className = `claim-item${claim ? ' is-claimed' : ''}`;
    article.dataset.itemKey = key;

    const copy = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = label;
    const meta = document.createElement('p');
    meta.textContent = claim ? `Claimed by ${claim.display_name}` : category;
    copy.append(title, meta);

    const button = document.createElement('button');
    button.type = 'button';
    if (!claim) {
      button.textContent = 'I’ll bring it';
      button.addEventListener('click', () => claimItem(key));
    } else if (claim.user_id === state.user?.id || state.trip?.owner_id === state.user?.id) {
      button.textContent = claim.user_id === state.user?.id ? 'Release' : 'Remove claim';
      button.className = 'release-button';
      button.addEventListener('click', () => releaseItem(key, claim.user_id));
    } else {
      button.textContent = 'Covered';
      button.disabled = true;
    }
    article.append(copy, button);
    return article;
  }

  function renderBoard() {
    const needed = $('#needed-items');
    const claimed = $('#claimed-items');
    needed.replaceChildren();
    claimed.replaceChildren();
    let neededCount = 0;
    let claimedCount = 0;
    for (const item of ITEMS) {
      const claim = state.claims.get(item[0]);
      if (claim) {
        claimed.append(itemElement(item, claim));
        claimedCount++;
      } else {
        needed.append(itemElement(item, null));
        neededCount++;
      }
    }
    $('#needed-count').textContent = String(neededCount);
    $('#claimed-count').textContent = String(claimedCount);
    $('#needed-empty').hidden = neededCount !== 0;
    $('#claimed-empty').hidden = claimedCount !== 0;
  }

  async function refreshClaims(quiet = false) {
    if (!state.trip) return;
    const result = await state.client.from('campwell_claims')
      .select('item_key,user_id,display_name,claimed_at')
      .eq('trip_id', state.trip.id)
      .order('claimed_at', { ascending: true });
    const rows = validate(result);
    state.claims = new Map(rows.map(row => [row.item_key, row]));
    renderBoard();
    if (!quiet) setBoardStatus('The shared list is up to date. It refreshes automatically.');
  }

  async function claimItem(itemKey) {
    await run(async () => {
      const displayName = normalizeName();
      const result = await state.client.from('campwell_claims').insert({
        trip_id: state.trip.id,
        item_key: itemKey,
        user_id: state.user.id,
        display_name: displayName
      }).select('item_key,user_id,display_name,claimed_at').single();
      if (result.error?.code === '23505') {
        await refreshClaims(true);
        throw new Error('Someone else just claimed that item. The board has been refreshed.');
      }
      const claim = validate(result);
      state.claims.set(claim.item_key, claim);
      renderBoard();
      setBoardStatus(`${ITEMS.find(item => item[0] === itemKey)[1]} is now claimed by ${displayName}.`);
    }, 'board');
  }

  async function releaseItem(itemKey, claimantId) {
    await run(async () => {
      let query = state.client.from('campwell_claims').delete().eq('trip_id', state.trip.id).eq('item_key', itemKey);
      if (state.trip.owner_id !== state.user.id) query = query.eq('user_id', claimantId);
      const deleted = validate(await query.select('item_key'));
      if (deleted.length !== 1) throw new Error('That claim could not be released. Refresh and try again.');
      state.claims.delete(itemKey);
      renderBoard();
      setBoardStatus('The item is available again.');
    }, 'board');
  }

  function renderTrips() {
    const list = $('#trip-list');
    list.replaceChildren();
    if (!state.trips.length) {
      const note = document.createElement('p');
      note.className = 'empty-state';
      note.textContent = 'No trips yet. Start one below, or paste an invitation ID.';
      list.append(note);
      return;
    }
    for (const trip of state.trips) {
      const button = document.createElement('button');
      button.type = 'button';
      const name = document.createElement('strong');
      name.textContent = trip.name;
      const detail = document.createElement('span');
      detail.textContent = trip.owner_id === state.user.id ? 'You organize this trip' : 'Shared with you';
      button.append(name, detail);
      button.addEventListener('click', () => run(() => openTrip(trip.id)));
      list.append(button);
    }
  }

  async function listTrips(autoOpen = false) {
    state.trips = validate(await state.client.from('campwell_trips')
      .select('id,name,owner_id,created_at')
      .order('created_at', { ascending: false }));
    renderTrips();
    if (autoOpen && state.trips.length === 1) await openTrip(state.trips[0].id);
  }

  async function openTrip(id) {
    const trip = validate(await state.client.from('campwell_trips')
      .select('id,name,owner_id,created_at').eq('id', id).single());
    state.trip = trip;
    $('#board-title').textContent = trip.name;
    $('#trip-meta').textContent = trip.owner_id === state.user.id ? 'You’re the organizer' : 'Shared trip';
    $('#board-account-label').textContent = state.user.email;
    $('#display-name').value = storedName();
    $('#organizer-tools').hidden = trip.owner_id !== state.user.id;
    $('#trip-id-label').textContent = `Trip ID: ${trip.id}`;
    show('board');
    await refreshClaims();
    startRefresh();
  }

  async function signedIn(user) {
    state.user = user;
    $('#account-label').textContent = `Signed in as ${user.email}`;
    show('setup');
    await listTrips(true);
  }

  function endSession(message = 'Signed out. Your shared trips are no longer visible on this device.') {
    state.sessionGeneration++;
    clearRefresh();
    state.user = null;
    state.trip = null;
    state.trips = [];
    state.claims.clear();
    $('#trip-list').replaceChildren();
    $('#needed-items').replaceChildren();
    $('#claimed-items').replaceChildren();
    $('#board-title').textContent = '';
    $('#trip-meta').textContent = '';
    $('#board-account-label').textContent = '';
    $('#trip-id-label').textContent = '';
    $('#invite-email').value = '';
    $('#display-name').value = '';
    $('#signin-code').value = '';
    $('#signin-email').value = '';
    $('#code-form').hidden = true;
    show('login');
    setAuthStatus(message);
  }

  async function signOut() {
    await run(async () => {
      const result = await state.client.auth.signOut({ scope: 'local' });
      if (result.error) throw result.error;
      endSession();
    });
  }

  if (!window.isSecureContext) {
    setAuthStatus('Shared planning requires HTTPS. Localhost is supported for development.');
    return;
  }
  if (!config?.publishableKey || !config.publishableKey.startsWith('sb_publishable_')) {
    setAuthStatus('Shared planning is not configured yet.');
    return;
  }
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(config.url)) {
    setAuthStatus('The shared planning service is configured with an invalid project URL.');
    return;
  }

  try {
    state.client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, detectSessionInUrl: false, autoRefreshToken: true }
    });
  } catch {
    setAuthStatus('Shared planning could not start. Try again later.');
    return;
  }
  setAuthStatus('Enter your email and we’ll send a one-time sign-in code.');

  $('#email-form').addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      const email = $('#signin-email').value.trim().toLowerCase();
      validate(await state.client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }));
      $('#code-form').hidden = false;
      setAuthStatus('Check your email, then enter the sign-in code below.');
    });
  });

  $('#code-form').addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      const email = $('#signin-email').value.trim().toLowerCase();
      const token = $('#signin-code').value.trim();
      const data = validate(await state.client.auth.verifyOtp({ email, token, type: 'email' }));
      await signedIn(data.user);
    });
  });

  $('#create-trip-form').addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      const name = $('#new-trip-name').value.trim();
      if (!name) throw new Error('Enter a trip name.');
      const trip = validate(await state.client.from('campwell_trips')
        .insert({ name, owner_id: state.user.id }).select('id').single());
      $('#new-trip-name').value = '';
      await listTrips();
      await openTrip(trip.id);
    });
  });

  $('#join-trip-form').addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      const id = $('#join-trip-id').value.trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Enter the complete trip ID.');
      validate(await state.client.rpc('campwell_join_trip', { target: id }));
      $('#join-trip-id').value = '';
      await listTrips();
      await openTrip(id);
    });
  });

  $('#invite-form').addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      const email = $('#invite-email').value.trim().toLowerCase();
      const result = await state.client.from('campwell_invitations').insert({ trip_id: state.trip.id, email });
      if (result.error?.code !== '23505') validate(result);
      $('#invite-email').value = '';
      setBoardStatus('That email can now join with the trip ID.');
    }, 'board');
  });

  $('#save-display-name').addEventListener('click', () => {
    try {
      const name = normalizeName();
      setBoardStatus(`Your claimed items will show “${name}.”`);
    } catch (error) { setBoardStatus(error.message); }
  });
  $('#change-trip').addEventListener('click', () => {
    clearRefresh();
    state.trip = null;
    state.claims.clear();
    renderTrips();
    show('setup');
  });
  $('#signout').addEventListener('click', signOut);
  $('#setup-signout').addEventListener('click', signOut);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.trip && !state.busy) refreshClaims(true);
  });
  state.client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT' && state.user) endSession('Your session ended. Sign in again to view shared trips.');
  });
})();
