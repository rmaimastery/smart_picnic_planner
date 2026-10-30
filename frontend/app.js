const $ = (selector) => document.querySelector(selector);
let plan = null;
const date = new Date();
date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7 || 7));
const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
$('#date').value = localDate(date);
$('#date').min = localDate(new Date());
const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('#toast').hidden = true; }, 3500); }
function state(name) { for (const id of ['empty', 'loading', 'plan', 'error']) $(`#${id}-state`).hidden = id !== name; }
function readSaved() { try { const value = JSON.parse(localStorage.getItem('gather-plan')); return value?.request && Array.isArray(value.venues) && value.budget && Array.isArray(value.warnings) ? value : null; } catch { return null; } }
$('#saved-count').textContent = readSaved() ? '1' : '0';
$('#travel').addEventListener('input', (e) => { $('#travel-value').textContent = `${e.target.value} minutes`; });
$('#planner-nav').addEventListener('click', () => { $('#planner-nav').classList.add('active'); $('#saved-nav').classList.remove('active'); $('#request').focus(); });
$('#saved-nav').addEventListener('click', () => { const saved = readSaved(); if (!saved) return toast('Create and save a plan to find it here.'); plan = saved; renderPlan(); $('#saved-nav').classList.add('active'); $('#planner-nav').classList.remove('active'); });
$('#picnic-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = { request: $('#request').value, date: $('#date').value, guests: Number($('#guests').value), location: $('#location').value.trim(), budget: Number($('#budget').value), travel_minutes: Number($('#travel').value), dietary_preferences: [...document.querySelectorAll('.chips input:checked')].map((input) => input.value) };
  if (!payload.location) { $('#location').focus(); return; }
  $('#generate').disabled = true; state('loading'); $('#progress').innerHTML = '';
  const steps = ['Reading your picnic details', 'Preparing sample venue options', 'Estimating food and supplies', 'Checking the proposed budget'];
  let index = 0;
  const tick = () => { if (index < steps.length) { const li = document.createElement('li'); li.textContent = steps[index++]; $('#progress').append(li); } };
  tick(); const timer = setInterval(tick, 450);
  try {
    const response = await fetch('/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(response.status === 422 ? 'Please check your date, guest count, budget, and location.' : 'The planner could not complete this request. Please try again.');
    plan = await response.json(); renderPlan();
  } catch (error) { state('error'); $('#error-state').textContent = error instanceof TypeError ? 'Cannot reach the planner. Start the FastAPI server using the README instructions, then reload this page.' : error.message; }
  finally { clearInterval(timer); $('#generate').disabled = false; }
});
function renderPlan() {
  state('plan');
  $('#result-subtitle').textContent = `${plan.request.guests} guests · ${plan.request.location} · ${plan.request.date}`;
  const approved = plan.status === 'approved';
  $('#plan-state').innerHTML = `<span class="status">${approved ? '✓ Approved locally' : plan.status === 'needs_revision' ? '↻ Budget revision needed' : '✦ Sample plan ready for review'}</span><p class="summary">A relaxed day outside, with room for everyone.</p><h3>Choose your spot</h3>${plan.venues.map((venue) => `<button class="venue ${venue.id === plan.selected_venue ? 'selected' : ''}" data-venue="${escapeHtml(venue.id)}" ${approved ? 'disabled' : ''}><strong>${venue.id === plan.selected_venue ? '◉' : '○'} ${escapeHtml(venue.name)}</strong><small>${venue.travel_minutes} min sample drive · ${venue.capacity} sample capacity</small><small>${escapeHtml(venue.features)}</small></button>`).join('')}<div class="result-section"><h3>On the menu</h3><ul class="menu">${plan.menu.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul><p class="form-note">Preferences: ${escapeHtml(plan.dietary_preferences.join(', ') || 'None specified')} · confirm ingredients before serving</p></div><div class="result-section"><h3>A budget that adds up</h3>${Object.entries(plan.budget).map(([label, value]) => `<div class="budget-row"><span>${escapeHtml(label)}</span><span>${money(value)}</span></div>`).join('')}<div class="budget-row total"><span>Estimated total</span><span>${money(plan.total)} / ${money(plan.request.budget)}</span></div><div class="budget-row"><span>Budget remaining</span><span>${money(plan.remaining)}</span></div></div><details class="result-section"><summary>Schedule, shopping & assignments</summary><ul class="menu">${[...plan.schedule, ...plan.shopping_list, ...plan.guest_assignments].map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul><p class="summary">Backup: ${escapeHtml(plan.backup_plan)}</p></details><div class="notice">${plan.warnings.map(escapeHtml).join('<br>')}</div><div class="actions"><button class="primary" id="approve" ${approved || plan.status === 'needs_revision' ? 'disabled' : ''}>${approved ? '✓ Plan approved' : 'Approve sample plan'}</button><button class="secondary" id="save">Save</button><button class="secondary" id="download">Export</button></div>`;
  document.querySelectorAll('[data-venue]').forEach((button) => button.addEventListener('click', () => { plan.selected_venue = button.dataset.venue; renderPlan(); }));
  $('#approve').addEventListener('click', () => { plan.status = 'approved'; renderPlan(); toast('Plan approved locally. No external actions were taken.'); });
  $('#save').addEventListener('click', () => { try { localStorage.setItem('gather-plan', JSON.stringify(plan)); $('#saved-count').textContent = '1'; toast('Plan saved in this browser.'); } catch { toast('Browser storage is unavailable. Use Export to keep your plan.'); } });
  $('#download').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'blanket-and-bites-picnic-plan.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
}
