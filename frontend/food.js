const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const money = value => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(value);
const thread = location.hash.slice(1);
const endpoint = `/api/workflows/${encodeURIComponent(thread)}`;
let picnic = null, mode = 'shop', options = [], searchId = null, selected = null, busy = false, readonly = false;
const searches = new Map();
const drafts = new Map();
const areas = {shop:'venue', order:'venue'};
function savedSelections() {const choices={...picnic?.food_selections};if(picnic?.food_selection)choices[picnic.food_selection.mode]??=picnic.food_selection;return choices;}
function updateLineup() {
  const choices=savedSelections();
  $('#selected-food-summary').innerHTML=PicnicUI.foodSummary(picnic);
  $('#shop-choice-badge').textContent=choices.shop?(choices.shop.business?'✓ Store saved':'Store planned'):'Add a grocery store';
  $('#order-choice-badge').textContent=choices.order?(choices.order.business?'✓ Restaurant saved':'Restaurant planned'):'Add a restaurant';
  $('#review-food').disabled=busy||readonly||!Object.keys(choices).length||drafts.size>0;
}
const list = items => `<ul class="menu">${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
function safeLink(value) {try {const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? esc(url.href) : '#';} catch {return '#';}}
async function jsonResponse(response) {
  const result = await response.json();
  if (!response.ok) throw Error(typeof result.detail === 'string' ? result.detail : 'Please check your request and try again.');
  return result;
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('#food-content button, #food-near, #food-results input').forEach(el => el.disabled = value || readonly);
  $('#edit-food-copy').disabled = value;
  $('#use-food').disabled = value || readonly || !selected;
  $('#review-food').disabled = value || readonly || !Object.keys(savedSelections()).length || drafts.size>0;
  $('#food-panel').setAttribute('aria-busy', String(value));
}
function renderOptions() {
  $('#food-result-cards').innerHTML = options.map(option => `<article class="food-business"><label><input type="radio" name="food-business" value="${esc(option.id)}" ${option.id === selected ? 'checked' : ''}><span><strong>${esc(option.name)}</strong><small>${esc(option.description)}</small></span></label><a href="${safeLink(option.source_url)}" target="_blank" rel="noopener noreferrer">${mode === 'shop' ? 'View store / source' : 'View menu / ordering source'} ↗</a></article>`).join('');
  document.querySelectorAll('[name="food-business"]').forEach(input => input.onchange = () => {
    selected = input.value;
    drafts.set(`${mode}:${$('#food-near').value}`,{selected,searchId});
    updateLineup();
    $('#use-food').disabled = readonly || busy;
    $('#food-selection-status').textContent = `${options.find(option => option.id === selected).name} will be saved alongside your other food options.`;
  });
  $('#use-food').disabled = readonly || busy || !selected;
}
function renderMode(next) {
  mode = next; selected = null; searchId = null; options = [];
  $('#food-near').value=areas[mode];
  document.querySelectorAll('[data-mode]').forEach(tab => {tab.setAttribute('aria-selected', String(tab.dataset.mode === mode)); tab.tabIndex = tab.dataset.mode === mode ? 0 : -1;});
  $('#food-panel').setAttribute('aria-labelledby', `tab-${mode}`);
  $('#food-menu-title').textContent = mode === 'shop' ? 'Your picnic menu' : 'Menu inspiration for your order';
  $('#food-menu').innerHTML = list(picnic.menu);
  $('#food-list-title').textContent = mode === 'shop' ? 'Your ingredient shopping list' : 'Before you place an order';
  $('#food-list').innerHTML = mode === 'shop' ? list(picnic.ingredient_list || picnic.shopping_list) : list([
    `Confirm portions for ${picnic.request.guests} guests with the restaurant.`,
    `Ask about ${picnic.request.food_category} options and your dietary requirements.`,
    'Check the total price against your food allowance, including taxes and delivery.',
    'Arrange pickup or delivery and safe food storage for the picnic.',
  ]);
  $('#nearby-title').textContent = mode === 'shop' ? 'Find nearby grocery stores' : 'Find restaurants & caterers';
  $('#food-search-help').textContent = mode === 'shop' ? 'Find places to pick up the ingredients for your picnic.' : 'Explore local menus and contact the business to arrange your food.';
  $('#find-food').textContent = mode === 'shop' ? 'Find grocery stores →' : 'Find restaurants →';
  $('#use-food-later').textContent = mode === 'shop' ? 'Choose a store later' : 'Choose a restaurant later';
  $('#use-food').textContent=mode==='shop'?'Save grocery store +':'Save restaurant +';
  $('#food-selection-status').textContent = mode === 'shop' ? 'Choose a nearby business, or decide on a store later.' : 'Choose a nearby business, or decide on a restaurant later.';
  $('#food-search-status').textContent = 'Select Find to search for nearby options.';
  $('#food-search-error').hidden = true; $('#food-save-error').hidden = true;
  const venue = picnic.venues.find(item => item.id === picnic.selected_venue) || picnic.venues[0];
  $('#food-area').textContent = `Searching near: ${$('#food-near').value === 'start' ? picnic.request.location : `${venue.name}, ${picnic.request.location}`}`;
  const cached = searches.get(`${mode}:${$('#food-near').value}`);
  if (cached) {options = cached.options; searchId = cached.search_id; $('#food-search-status').textContent = options.length ? `${options.length} options found. Choose one below.` : 'No supported businesses found here. Try your other search location.';}
  const draft=drafts.get(`${mode}:${$('#food-near').value}`);
  if(draft&&draft.searchId===searchId)selected=draft.selected;
  renderOptions();
  updateLineup();
}
async function findFood() {
  if (busy || readonly) return;
  setBusy(true); $('#food-search-error').hidden = true;
  $('#food-search-status').textContent = 'Looking for nearby options…';
  try {
    const result = await jsonResponse(await fetch(endpoint + '/food-options', {method:'POST', headers:{'Content-Type':'application/json','X-BB-Request':'1'}, body:JSON.stringify({mode, near:$('#food-near').value})}));
    searches.set(`${mode}:${$('#food-near').value}`, result);
    options = result.options; searchId = result.search_id; selected = null;
    drafts.delete(`${mode}:${$('#food-near').value}`);
    renderOptions();
    $('#food-search-status').textContent = options.length ? `${options.length} options found. Choose one below.` : 'No supported businesses found here. Try your other search location, or choose a business later.';
  } catch (error) {
    $('#food-search-status').textContent = '';
    $('#food-search-error').textContent = error instanceof TypeError ? 'Cannot reach the planner. Check your connection and try again.' : error.message;
    $('#food-search-error').hidden = false;
  } finally {setBusy(false);}
}
async function saveChoice(later) {
  if (busy || readonly || (!later && !selected)) return;
  setBusy(true); $('#food-save-error').hidden = true;
  $('#food-selection-status').textContent = 'Saving your food choice…';
  try {
    const result=await jsonResponse(await fetch('/api/chat', {method:'POST', headers:{'Content-Type':'application/json','X-BB-Request':'1'}, body:JSON.stringify({
      thread_id:thread, today: (()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;})(), action:'food', food_mode:mode, food_near:$('#food-near').value,
      food_search_id:later ? null : searchId, food_option_id:later ? null : selected,
    })}));
    try {localStorage.setItem('picnic-thread', thread);} catch {}
    picnic=result.plan;
    for(const key of drafts.keys())if(key.startsWith(mode+':'))drafts.delete(key);
    renderMode(mode);
    const choices=savedSelections();
    const other=mode==='shop'?'restaurant':'grocery store';
    $('#food-selection-status').textContent=`${mode==='shop'?'Grocery store':'Restaurant'} option saved. ${choices.shop&&choices.order?'Both food options are in your plan.':`You can add a ${other} too.`} Review your picnic when you’re ready.`;
  } catch (error) {
    $('#food-save-error').textContent = error instanceof TypeError ? 'Cannot reach the planner. Your food choice has not been saved. Try again.' : error.message;
    $('#food-save-error').hidden = false;
    $('#food-selection-status').textContent = 'Your food choice has not been saved. Retry, or search again if the picnic changed.';
  } finally {setBusy(false);}
}
document.querySelectorAll('[data-mode]').forEach(tab => {
  tab.onclick = () => {if (!busy && !readonly) renderMode(tab.dataset.mode);};
  tab.onkeydown = event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key) || busy || readonly) return;
    event.preventDefault(); renderMode(event.key === 'Home' ? 'shop' : event.key === 'End' ? 'order' : mode === 'shop' ? 'order' : 'shop'); $(`#tab-${mode}`).focus();
  };
});
$('#food-near').onchange = () => {areas[mode]=$('#food-near').value;renderMode(mode);};
$('.skip-link').onclick = event => {event.preventDefault(); $(`#tab-${mode}`).focus();};
$('#find-food').onclick = findFood;
$('#use-food').onclick = () => saveChoice(false);
$('#use-food-later').onclick = () => saveChoice(true);
$('#review-food').onclick=()=>{if(!busy&&!readonly&&Object.keys(savedSelections()).length&&!drafts.size){try{localStorage.setItem('picnic-thread',thread);}catch{}location.href=`picnic.html${globalThis.BBPlanPicker?.current()?.id?"?plan="+BBPlanPicker.current().id:""}#${thread}`;}};
$('#edit-food-copy').onclick = async () => {
  if (busy || !readonly) return;
  setBusy(true);
  $('#food-copy-status').textContent = 'Creating an editable version with your picnic details…';
  try {
    const result = await jsonResponse(await fetch(endpoint + '/food-copy', {method:'POST',headers:{'X-BB-Request':'1'}}));
    try {localStorage.setItem('picnic-thread', result.thread_id);} catch {}
    location.href = `food.html#${result.thread_id}`;
    // A new workflow token changes only the fragment, so reload the page state.
    location.reload();
  } catch (error) {
    $('#food-copy-status').textContent = error instanceof TypeError ? 'Cannot reach the planner. Try creating a new version again.' : error.message;
    setBusy(false);
  }
};
async function load() {
  try {
    if (!/^[A-Za-z0-9_-]{32}$/.test(thread)) throw Error('Open Plan your food from a picnic plan to get started.');
    const result = await jsonResponse(await fetch(endpoint));
    if (!result.plan) throw Error('Choose a picnic place first, then open Plan your food.');
    picnic = result.plan; readonly = result.stage === 'shared';
    $('#picnic-nav').href=`picnic.html#${thread}`;
    $('#back-to-picnic').href=`picnic.html#${thread}`;
    document.body.classList.toggle('readonly', readonly);
    $('#food-page-status').textContent = '';
    $('#food-content').hidden = false;
    $('#food-readonly').hidden = !readonly;
    const facts = [['Guests', picnic.request.guests], ['Food allowance', money(picnic.budget['Food & drinks'])], ['Food preference', picnic.request.food_category], ['Dietary needs', (picnic.dietary_preferences || []).join(', ') || 'None specified'], ['Picnic venue', (picnic.venues.find(v => v.id === picnic.selected_venue) || picnic.venues[0]).name]];
    $('#food-facts').innerHTML = facts.map(([label, value]) => `<div><span>${label}</span><strong>${esc(value)}</strong></div>`).join('');
    const choices=savedSelections();
    areas.shop=choices.shop?.near||'venue';areas.order=choices.order?.near||'venue';
    renderMode(picnic.food_selection?.mode || 'shop');
    updateLineup();
    if (readonly) {$('.food-decision').hidden = true; $('.food-nearby-panel').hidden = true;}
    setBusy(false);
  } catch (error) {$('#food-page-status').textContent = error instanceof TypeError ? 'Cannot reach the planner. Check your connection and reload.' : error.message;}
}
load().then(async()=>{
  await globalThis.BBPlanPicker?.init({currentThread:thread,beforeSelect:()=>busy?'Please wait for your food request to finish.':drafts.size?'Save your selected food choices before switching picnics.':false,onSelect:async item=>{location.href=`food.html?plan=${item.id}#${item.thread_id}`;}});
  const selected=globalThis.BBPlanPicker?.current();
  if(selected)$('#back-to-picnic').href=`picnic.html?plan=${selected.id}#${thread}`;
});
