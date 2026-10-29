const planKey = 'campwell-plan-v1';
const planStatus = document.querySelector('#planning-status');
const planFields = [...document.querySelectorAll('[data-save]')];
let savedPlan = {};
try {
  const stored = JSON.parse(localStorage.getItem(planKey) || '{}');
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) savedPlan = stored;
} catch {
  planStatus.textContent = 'Browser storage is unavailable. Changes may be lost when you leave. Print a copy to keep your plan.';
}
planFields.forEach(field => {
  const key = field.dataset.save;
  if (Object.hasOwn(savedPlan, key)) {
    if (field.type === 'checkbox' && typeof savedPlan[key] === 'boolean') field.checked = savedPlan[key];
    else if (field.type !== 'checkbox' && typeof savedPlan[key] === 'string') field.value = savedPlan[key].slice(0, field.maxLength > 0 ? field.maxLength : 150);
  }
  field.addEventListener('input', () => {
    const values = Object.fromEntries(planFields.map(input => [input.dataset.save, input.type === 'checkbox' ? input.checked : input.value]));
    try { localStorage.setItem(planKey, JSON.stringify(values)); }
    catch { planStatus.textContent = 'Unable to save in this browser. Print a copy before leaving to keep your plan.'; }
  });
});
document.querySelector('#print-plan').addEventListener('click', () => window.print());
