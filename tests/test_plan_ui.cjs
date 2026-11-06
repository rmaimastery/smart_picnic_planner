// Run with: node --test tests/test_plan_ui.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({Intl, URL});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/plan-ui.js'), 'utf8'), context);
const ui = vm.runInContext('PicnicUI', context);
const fixture = () => ({
  request:{budget:1000, guests:30, date:'2027-06-12', location:'San Ramon', food_category:'Vegetarian', distance_miles:20},
  venues:[{id:'park', name:'A picnic park', features:'Shaded tables', distance_miles:null, capacity:null, fee:null, source_url:'https://example.org/park'}],
  selected_venue:'park', status:'pending_approval', menu:['Vegetable wraps'],
  budget:{Food:600, Supplies:120, Venue:100}, total:820, remaining:180,
  schedule:['Noon — lunch'], shopping_list:['30 wraps'], guest_assignments:['Host — setup'],
  backup_plan:'Reschedule if it rains.', warnings:['Check park availability.'],
});

test('progress follows missing fields even when details arrive out of order', () => {
  assert.equal(ui.nextMissing({location:'San Ramon', guests:30}).key, 'budget');
  const html = ui.steps({budget:1000, location:'San Ramon', guests:30});
  assert.equal((html.match(/class="complete /g) || []).length, 3);
  assert.match(html, /data-detail="food_category" aria-current="step"/);
  assert.equal(ui.hasValue({location:'   '}, 'location'), false);
});

test('all collected details have no missing step and selected details remain editable', () => {
  const details = fixture().request;
  assert.equal(ui.nextMissing(details), undefined);
  const html = ui.steps(details, 'budget');
  assert.equal((html.match(/Collected\. Edit detail\./g) || []).length, 6);
  assert.match(html, /data-detail="budget" aria-current="step"/);
});

test('saved plans separate shopping, assignments, schedule, and backup', () => {
  const sections = ui.savedSections(fixture());
  assert.equal(sections.length, 8);
  const byId = Object.fromEntries(sections.map(section => [section.id, section.body]));
  assert.match(byId.shopping, /30 wraps/);
  assert.doesNotMatch(byId.shopping, /Host — setup/);
  assert.match(byId.people, /Host — setup/);
  assert.match(byId.schedule, /Noon — lunch/);
  assert.match(byId.backup, /Reschedule if it rains/);
});

test('unknown venue details stay unknown and unsafe source links are omitted', () => {
  const plan = fixture();
  plan.venues[0].source_url = 'javascript:alert(1)';
  const body = ui.savedSections(plan).find(section => section.id === 'place').body;
  assert.equal((body.match(/Not verified/g) || []).length, 3);
  assert.doesNotMatch(body, /href=/);
});

test('older saved plans render without optional food, activity, or distance fields', () => {
  const plan = fixture();
  delete plan.request.food_category;
  delete plan.request.distance_miles;
  const sections = ui.savedSections(plan);
  assert.match(sections.find(s => s.id === 'food').body, /Food category not specified/);
  assert.match(sections.find(s => s.id === 'schedule').body, /No separate activities saved/);
});

test('user details and generated content are escaped before rendering', () => {
  const plan = fixture();
  const malicious = '<img src=x onerror=alert(1)>';
  plan.request.location = malicious;
  plan.menu = [malicious];
  plan.backup_plan = malicious;
  const html = ui.savedSections(plan).map(section => section.body).join('');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(ui.steps({location:malicious}), /<img/);
});

test('food selections render in saved plans with safe business links', () => {
  const plan = fixture();
  plan.food_selection = {mode:'order', business:{name:'<script>bad</script>', source_url:'javascript:alert(1)'}};
  const html = ui.savedSections(plan).find(section => section.id === 'food').body;
  assert.match(html, /Order prepared food/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|href=/);
  plan.food_selection.business.source_url = 'https://example.org/menu';
  assert.match(ui.foodSummary(plan), /https:\/\/example.org\/menu/);
});

test('plan summaries show both grocery and restaurant slots including legacy choices',()=>{
  const plan=fixture();
  plan.food_selection={mode:'shop',business:{name:'Legacy Grocery',source_url:'https://example.org/store'}};
  let html=ui.foodSummary(plan);
  assert.match(html,/Legacy Grocery/);
  assert.match(html,/Restaurant/);
  assert.match(html,/Not selected yet/);
  plan.food_selections={shop:plan.food_selection,order:{mode:'order',business:{name:'Picnic Restaurant',source_url:'https://example.org/menu'}}};
  html=ui.savedSections(plan).find(section=>section.id==='food').body;
  assert.match(html,/Legacy Grocery/);
  assert.match(html,/Picnic Restaurant/);
  assert.match(html,/https:\/\/example.org\/store/);
  assert.match(html,/https:\/\/example.org\/menu/);
});
