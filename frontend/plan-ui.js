// Shared display helpers. Required fields follow the server's collection order.
const PicnicUI = (() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const currency = value => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(value);
  const fields = [
    {key:'budget', label:'Budget', question:'What is your total picnic budget?', type:'number', min:1, max:100000, step:'0.01', placeholder:'1000', format:currency, message:v => `My total picnic budget is $${v}.`},
    {key:'guests', label:'Guests', question:'How many people are coming?', type:'number', min:1, max:500, step:'1', placeholder:'30', format:v => `${v} people`, message:v => `There will be ${v} guests at the picnic.`},
    {key:'food_category', label:'Food', question:'What food would you like?', type:'select', options:['Vegetarian','Vegan','Mixed'], format:v => v, message:v => `My picnic food category is ${v}.`},
    {key:'location', label:'Location', question:'What city or area are you starting from?', type:'text', maxlength:200, placeholder:'San Ramon, CA', format:v => v, message:v => `My picnic starting location is ${v}.`},
    {key:'date', label:'Date', question:'What date would you like the picnic?', type:'date', format:v => v, message:v => `My picnic date is ${v}.`},
    {key:'distance_miles', label:'Distance', question:'How far are you willing to travel, in miles?', type:'number', min:5, max:100, step:'1', placeholder:'20', format:v => `${v} miles`, message:v => `My maximum picnic travel distance is ${v} miles.`},
  ];
  const hasValue = (details, key) => details[key] !== null && details[key] !== undefined && String(details[key]).trim() !== '';
  const nextMissing = details => fields.find(field => !hasValue(details, field.key));
  const drawings = {
    budget:'<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 8V6a2 2 0 0 1 2-2h12v2M16 12h5v4h-5a2 2 0 0 1 0-4Z"/>',
    guests:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5v1"/>',
    food_category:'<path d="M20 3C9 2 3 7 5 14c2 6 13 7 15-11ZM4 21 15 10M7 18v-6M10 15h6"/>',
    location:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    date:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2"/>',
    distance_miles:'<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h10a4 4 0 0 1 0 8H7a2 2 0 0 0 0 4h10"/>',
  };
  function steps(details, selected) {
    const next = nextMissing(details);
    return fields.map((field, index) => {
      const done = hasValue(details, field.key);
      const current = selected ? selected === field.key : next?.key === field.key;
      return `<li class="${done ? 'complete' : ''} ${current ? 'current' : ''}"><button type="button" data-detail="${field.key}" ${current ? 'aria-current="step"' : ''}><span class="detail-card-top"><span class="detail-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${drawings[field.key]}</svg></span><span class="detail-number" aria-hidden="true">${done ? '✓' : String(index + 1).padStart(2,'0')}</span></span><span class="detail-card-copy"><strong>${field.label}</strong><small>${done ? escape(field.format(details[field.key])) : 'Add your detail'}</small></span><span class="sr-only">${done ? 'Collected. Edit detail.' : 'Required. Add detail.'}</span></button></li>`;
    }).join('');
  }
  const list = (values, empty) => Array.isArray(values) && values.length ? `<ul class="menu">${values.map(value => `<li>${escape(value)}</li>`).join('')}</ul>` : `<p>${empty}</p>`;
  const pair = (name, value) => `<div><dt>${escape(name)}</dt><dd>${escape(value ?? 'Not specified')}</dd></div>`;
  function foodSummary(plan) {
    const selections = {...plan.food_selections};
    if (plan.food_selection) selections[plan.food_selection.mode] ??= plan.food_selection;
    return `<div class="food-choice-summary food-choice-pair">${['shop', 'order'].map(mode => {
      const choice = selections[mode];
      let link = '';
      try {const url = new URL(choice?.business?.source_url); if (['https:', 'http:'].includes(url.protocol)) link = `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${mode === 'shop' ? 'Visit store' : 'View menu / ordering source'} ↗</a>`;} catch {}
      return `<section class="food-choice-tile ${mode}"><p><strong><span aria-hidden="true">${mode === 'shop' ? '🛒' : '🍽'}</span> ${mode === 'shop' ? 'Grocery store · Shop for ingredients' : 'Restaurant · Order prepared food'}</strong></p><p>${escape(choice?.business?.name || (choice ? 'Business to be chosen later' : 'Not selected yet'))}</p>${link}${mode === 'order' && choice ? '<p class="food-choice-note">Confirm dishes, quantities and dietary needs with the restaurant.</p>' : ''}</section>`;
    }).join('')}</div>`;
  }
  function savedSections(plan) {
    const request = plan.request;
    const venue = plan.venues.find(v => v.id === plan.selected_venue) || plan.venues[0];
    const source = (() => {try {const url = new URL(venue.source_url); return ['https:', 'http:'].includes(url.protocol) ? url.href : null;} catch {return null;}})();
    const status = {approved:'Approved', needs_revision:'Budget revision required', pending_approval:'Awaiting approval'}[plan.status] || 'Saved draft';
    const dietary = plan.dietary_preferences || request.dietary_preferences || [];
    return [
      {id:'overview', title:'Overview', body:`<span class="status">${status}</span><dl>${pair('Date', request.date)}${pair('Guests', request.guests)}${pair('Starting location', request.location)}${pair('Total budget', currency(request.budget))}${pair('Maximum distance', request.distance_miles ? `${request.distance_miles} miles` : 'Not specified')}</dl>${request.notes || request.request ? `<p class="saved-notes">${escape(request.notes || request.request)}</p>` : ''}`},
      {id:'place', title:'Place', body:`<h3>${escape(venue.name)}</h3><p>${escape(venue.features)}</p><dl>${pair('Distance', venue.distance_miles == null ? 'Not verified' : `${venue.distance_miles} miles`)}${pair('Capacity', venue.capacity ?? 'Not verified')}${pair('Venue fee', venue.fee == null ? 'Not verified' : currency(venue.fee))}</dl>${source ? `<a class="source-link" href="${escape(source)}" target="_blank" rel="noopener noreferrer">View venue source ↗</a>` : ''}<p class="form-note">Confirm availability, fees and travel details with the venue.</p>`},
      {id:'food', title:'Food & dietary needs', body:`${foodSummary(plan)}<p><strong>${escape(request.food_category || 'Food category not specified')}</strong></p><p>Dietary preferences: ${escape(dietary.join(', ') || 'None specified')}</p>${list(plan.menu, 'No menu saved.')}<p>${escape(plan.food_source || '')}</p><p class="form-note">Confirm ingredients and dietary suitability before serving.</p>`},
      {id:'budget', title:'Budget', body:`${Object.entries(plan.budget).map(([label, amount]) => `<div class="budget-row"><span>${escape(label)}</span><span>${currency(amount)}</span></div>`).join('')}<div class="budget-row total"><span>Estimated total</span><span>${currency(plan.total)}</span></div><div class="budget-row"><span>Budget remaining</span><span>${currency(plan.remaining)}</span></div><p class="form-note">Planning allowances, not confirmed quotes.</p>`},
      {id:'schedule', title:'Schedule & activities', body:`${list(plan.schedule, 'No schedule saved.')}<h3>Activities</h3>${list((plan.activities || []).map(a => `${a.name} — ${a.owner}`), 'No separate activities saved.')}`},
      {id:'shopping', title:'Shopping list', body:list(plan.shopping_list, 'No shopping list saved.')},
      {id:'people', title:'People & assignments', body:list(plan.guest_assignments, 'No assignments saved.')},
      {id:'backup', title:'Backup & reminders', body:`<p>${escape(plan.backup_plan || 'No backup plan saved.')}</p>${list(plan.warnings, 'No additional reminders saved.')}`},
    ];
  }
  return {fields, hasValue, nextMissing, steps, savedSections, foodSummary};
})();
