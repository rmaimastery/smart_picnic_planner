const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../frontend/plan-picker.js'),'utf8');
const a={id:'a'.repeat(32),thread_id:'x'.repeat(32),role:'organizer',venue:'Park A',date:'2027-06-12',guests:10,saved_at:'2026-11-06T18:00:00Z',status:'approved'};
const b={...a,id:'b'.repeat(32),thread_id:'y'.repeat(32),venue:'Park B'};
function page({plans=[a,b],email='host@example.test',onSelect=async()=>{},beforeSelect}={}){
  const elements=new Map(['plan-picker-section','organizer-plan','plan-picker-description','plan-picker-status','refresh-plan-list'].map(id=>['#'+id,{hidden:true,value:'',textContent:'',disabled:false}]));
  const storage=new Map(),links=new Map(['.nav-planner','.nav-picnic','.nav-food','.nav-saved','[data-account-link]'].map(selector=>['a'+selector,{}]));
  let records=plans,reads=0;
  const context=vm.createContext({Date,Intl,BBAccount:{ready:Promise.resolve(),state:{email},api:async()=>{reads++;return {plans:records};}},sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},document:{querySelector:selector=>elements.get(selector),querySelectorAll:selector=>links.has(selector)?[links.get(selector)]:[]}});
  vm.runInContext(source,context);
  const picker=context.BBPlanPicker;
  return {picker,elements,storage,links,init:()=>picker.init({currentThread:a.thread_id,onSelect,beforeSelect}),get reads(){return reads;},setPlans(value){records=value;}};
}
test('organizer dropdown identifies owned plans, keeps the workflow selected, and scopes navigation',async()=>{
  const p=page({plans:[a,b,{...b,id:'g'.repeat(32),role:'guest'}]});await p.init();
  assert.equal(p.elements.get('#plan-picker-section').hidden,false);
  assert.equal(p.elements.get('#organizer-plan').value,a.id);
  assert.match(p.elements.get('#organizer-plan').innerHTML,/Park A/);assert.match(p.elements.get('#organizer-plan').innerHTML,/2027-06-12/);
  assert.doesNotMatch(p.elements.get('#organizer-plan').innerHTML,new RegExp('g'.repeat(32)));
  assert.equal(p.links.get('a.nav-saved').href,'/?plan='+a.id+'#saved');
  await p.elements.get('#organizer-plan').onchange({target:{value:b.id}});
  assert.equal(p.picker.current().id,b.id);
  assert.equal(p.links.get('a.nav-food').href,'food.html?plan='+b.id+'#'+b.thread_id);
  assert.equal(p.picker.remembered().id,b.id);
});
test('pending changes block switching and failed loads keep the previous selection',async()=>{
  let blocked=true,calls=0;
  const p=page({beforeSelect:()=>blocked?'Save your food choice first.':false,onSelect:async()=>{calls++;throw Error('Offline');}});await p.init();
  await p.elements.get('#organizer-plan').onchange({target:{value:b.id}});
  assert.equal(calls,0);assert.equal(p.picker.current().id,a.id);assert.match(p.elements.get('#plan-picker-status').textContent,/Save your food/);
  blocked=false;await p.elements.get('#organizer-plan').onchange({target:{value:b.id}});
  assert.equal(calls,1);assert.equal(p.elements.get('#organizer-plan').value,a.id);assert.match(p.elements.get('#plan-picker-status').textContent,/Offline/);
});
test('refresh discovers new plans and guests have no organizer selector',async()=>{
  const p=page({plans:[a]});await p.init();p.setPlans([a,b]);await p.picker.refresh();
  assert.equal(p.reads,2);assert.match(p.elements.get('#organizer-plan').innerHTML,/Park B/);assert.equal(p.picker.current().id,a.id);
  const guest=page({plans:[{...a,role:'guest'}]});await guest.init();assert.equal(guest.elements.get('#plan-picker-section').hidden,true);
  const signedOut=page({email:null});await signedOut.init();assert.equal(signedOut.reads,0);assert.equal(signedOut.elements.get('#plan-picker-section').hidden,true);
});
