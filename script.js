const checkboxes = [...document.querySelectorAll('[data-item]')];
const storageKey = 'campwell-packed-v1';
const saveNote = document.querySelector('.save-note');
let savedItems = [];
try {
  const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (Array.isArray(stored)) savedItems = stored;
} catch {
  saveNote.textContent = 'Progress available for this visit';
}
checkboxes.forEach(input => { input.checked = savedItems.includes(input.dataset.item); });
function updateProgress(save = false) {
  const packed = checkboxes.filter(input => input.checked);
  document.querySelector('#progress-text').textContent = `${packed.length} of ${checkboxes.length} essentials packed${packed.length === checkboxes.length ? ' — ready to go!' : ''}`;
  document.querySelector('#progress-fill').style.width = `${packed.length / checkboxes.length * 100}%`;
  document.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', packed.length);
  if (save) {
    try { localStorage.setItem(storageKey, JSON.stringify(packed.map(input => input.dataset.item))); }
    catch { saveNote.textContent = 'Progress available for this visit'; }
  }
}
checkboxes.forEach(input => input.addEventListener('change', () => updateProgress(true)));
document.querySelector('#reset').addEventListener('click', () => {
  checkboxes.forEach(input => { input.checked = false; });
  updateProgress(true);
});
document.querySelectorAll('[data-filter]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(filter => {
      const active = filter === button;
      filter.classList.toggle('active', active);
      filter.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-category]').forEach(card => {
      card.hidden = button.dataset.filter !== 'all' && card.dataset.category !== button.dataset.filter;
    });
  });
});
updateProgress();
