// Run with: node --test tests/test_food_ui.cjs
// Exercise the page's event handlers without a browser or provider calls.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../frontend');
const html = fs.readFileSync(path.join(root, 'food.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'food.js'), 'utf8');
const plan = () => ({
  request:{guests:12, location:'San Ramon', food_category:'Vegetarian'},
  venues:[{id:'park', name:'Park'}], selected_venue:'park',
  budget:{'Food & drinks':360}, dietary_preferences:['Vegetarian'],
  menu:['Wraps'], shopping_list:['12 wraps'],
});

async function page({failSearch=false, stage='food',picker=null}={}) {
  const elements = new Map(), calls = [], storage = new Map();
  const serverPlan=plan();
  let radios = [];
  class Element {
    constructor(id) {this.id=id; this.value=''; this.dataset={}; this.hidden=false; this.disabled=false; this.attributes={}; this.classList={toggle(){}};}
    setAttribute(key, value) {this.attributes[key]=value;}
    focus() {this.focused=true;}
    set innerHTML(value) {
      this.markup=value;
      if(this.id==='food-result-cards') radios=[...value.matchAll(/name="food-business" value="([^"]+)"/g)].map(match=>{const radio=new Element('radio');radio.value=match[1];return radio;});
    }
    get innerHTML() {return this.markup||'';}
  }
  for(const match of html.matchAll(/id="([^"]+)"/g)) elements.set('#'+match[1],new Element(match[1]));
  for(const name of ['.food-decision','.food-nearby-panel','.skip-link']) elements.set(name,new Element(name));
  elements.get('#food-near').value='venue';
  const tabs=[elements.get('#tab-shop'),elements.get('#tab-order')];
  tabs[0].dataset.mode='shop';tabs[1].dataset.mode='order';
  const location={hash:'#'+'p'.repeat(32),href:'',reloadCount:0,reload(){this.reloadCount++;}};
  const context=vm.createContext({
    Intl,URL,Date,Map,location,...(picker?{BBPlanPicker:picker}:{}),
    localStorage:{setItem:(key,value)=>storage.set(key,value)},
    PicnicUI:{foodSummary:picnic=>JSON.stringify(picnic.food_selections||{})},
    document:{body:new Element('body'),querySelector:selector=>{
      assert.ok(elements.has(selector),'Unexpected selector: '+selector);return elements.get(selector);
    },querySelectorAll:selector=>selector==='[data-mode]'?tabs:selector==='[name="food-business"]'?radios:[...elements.values(),...radios]},
    fetch:async(url,options)=>{
      const payload=options?.body?JSON.parse(options.body):null;
      calls.push({url,payload});
      const search=url.endsWith('/food-options');
      if(url==='/api/chat'){
        const choice={mode:payload.food_mode,near:payload.food_near,business:payload.food_option_id?{id:'food-1',name:payload.food_mode==='shop'?'Test Grocery':'Test Restaurant',source_url:'https://example.org/menu'}:null};
        serverPlan.food_selections={...serverPlan.food_selections,[choice.mode]:choice};
        serverPlan.food_selection=choice;
      }
      const result=search?(failSearch?{detail:'Search unavailable'}:{search_id:'s'.repeat(32),options:[{id:'food-1',name:'Test Business',description:'Sample menu',source_url:'https://example.org/menu'}]}):url.endsWith('/food-copy')?{thread_id:'n'.repeat(32),stage:'food'}:url==='/api/chat'?{stage:'approval',plan:serverPlan}:{plan:serverPlan,stage};
      return {ok:!(search&&failSearch),json:async()=>result};
    },
  });
  // Capture the page's existing startup promise so assertions wait for loading.
  vm.runInContext(source.replace('load().then(', 'globalThis.ready=load().then('),context);
  await context.ready;
  return {elements,calls,storage,location,get radios(){return radios;}};
}

test('restaurant choice searches the selected area and saves canonical IDs',async()=>{
  const p=await page();
  p.elements.get('#tab-order').onclick();
  assert.equal(p.elements.get('#nearby-title').textContent,'Find restaurants & caterers');
  p.elements.get('#food-near').value='start';
  p.elements.get('#food-near').onchange();
  await p.elements.get('#find-food').onclick();
  const search=p.calls.find(call=>call.url.endsWith('/food-options'));
  assert.deepEqual(search.payload,{mode:'order',near:'start'});
  assert.equal(p.elements.get('#use-food').disabled,true);
  p.radios[0].onchange();
  assert.equal(p.elements.get('#use-food').disabled,false);
  await p.elements.get('#use-food').onclick();
  const saved=p.calls.find(call=>call.url==='/api/chat').payload;
  assert.equal(saved.food_mode,'order');
  assert.equal(saved.food_near,'start');
  assert.equal(saved.food_search_id,'s'.repeat(32));
  assert.equal(saved.food_option_id,'food-1');
  assert.equal(p.storage.get('picnic-thread'),'p'.repeat(32));
  assert.equal(p.location.href,'');
  assert.equal(p.elements.get('#review-food').disabled,false);
  p.elements.get('#review-food').onclick();
  assert.equal(p.location.href,'picnic.html#'+'p'.repeat(32));
});

test('a search failure keeps the menu and lets the user choose a store later',async()=>{
  const p=await page({failSearch:true});
  await p.elements.get('#find-food').onclick();
  assert.equal(p.elements.get('#food-search-error').hidden,false);
  assert.match(p.elements.get('#food-menu').innerHTML,/Wraps/);
  await p.elements.get('#use-food-later').onclick();
  const saved=p.calls.find(call=>call.url==='/api/chat').payload;
  assert.equal(saved.food_mode,'shop');
  assert.equal(saved.food_search_id,null);
  assert.equal(saved.food_option_id,null);
});

test('shared plans are read only and skip navigation preserves the thread token',async()=>{
  const p=await page({stage:'shared'});
  assert.equal(p.elements.get('.food-decision').hidden,true);
  assert.equal(p.elements.get('#find-food').disabled,true);
  await p.elements.get('#find-food').onclick();
  await p.elements.get('#use-food-later').onclick();
  assert.equal(p.calls.length,1);
  let prevented=false;
  p.elements.get('.skip-link').onclick({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(p.location.hash,'#'+'p'.repeat(32));
});

test('shared picnic offers an editable version without resetting the details',async()=>{
  const p=await page({stage:'shared'});
  assert.equal(p.elements.get('#edit-food-copy').disabled,false);
  await p.elements.get('#edit-food-copy').onclick();
  assert.ok(p.calls.some(call=>call.url.endsWith('/food-copy')));
  assert.equal(p.storage.get('picnic-thread'),'n'.repeat(32));
  assert.equal(p.location.href,'food.html#'+'n'.repeat(32));
  assert.equal(p.location.reloadCount,1);
});

test('both grocery and restaurant selections remain saved before returning to review',async()=>{
  const p=await page();
  await p.elements.get('#find-food').onclick();
  p.radios[0].onchange();
  await p.elements.get('#use-food').onclick();
  assert.match(p.elements.get('#selected-food-summary').innerHTML,/Test Grocery/);
  assert.equal(p.location.href,'');
  p.elements.get('#tab-order').onclick();
  await p.elements.get('#find-food').onclick();
  p.radios[0].onchange();
  assert.equal(p.elements.get('#review-food').disabled,true);
  await p.elements.get('#use-food').onclick();
  assert.match(p.elements.get('#selected-food-summary').innerHTML,/Test Grocery/);
  assert.match(p.elements.get('#selected-food-summary').innerHTML,/Test Restaurant/);
  assert.equal(p.elements.get('#shop-choice-badge').textContent,'✓ Store saved');
  assert.equal(p.elements.get('#order-choice-badge').textContent,'✓ Restaurant saved');
  assert.equal(p.elements.get('#review-food').disabled,false);
  p.elements.get('#review-food').onclick();
  assert.equal(p.location.href,'picnic.html#'+'p'.repeat(32));
});

test('switching tabs preserves an unsaved radio selection',async()=>{
  const p=await page();
  await p.elements.get('#find-food').onclick();
  p.radios[0].onchange();
  p.elements.get('#tab-order').onclick();
  p.elements.get('#tab-shop').onclick();
  assert.equal(p.elements.get('#use-food').disabled,false);
  assert.match(p.elements.get('#food-result-cards').innerHTML,/checked/);
});


test('switching food plans requires saving selected businesses and navigates using the chosen workflow',async()=>{
  let config;
  const picker={init:async value=>{config=value;},current:()=>null};
  const p=await page({picker});
  await p.elements.get('#find-food').onclick();p.radios[0].onchange();
  assert.match(config.beforeSelect(),/Save your selected food/);
  await p.elements.get('#use-food').onclick();assert.equal(config.beforeSelect(),false);
  await config.onSelect({id:'b'.repeat(32),thread_id:'y'.repeat(32)});
  assert.equal(p.location.href,'food.html?plan='+'b'.repeat(32)+'#'+'y'.repeat(32));
});
