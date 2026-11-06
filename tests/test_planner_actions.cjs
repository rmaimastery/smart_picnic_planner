// Run with: node --test tests/test_planner_actions.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root=path.join(__dirname,'../frontend');

async function planner({rejectApproval=false, needsRevision=false,pathname='/picnic.html',session=new Map(),empty=false}={}) {
  const elements=new Map(), storage=new Map(empty?[]:[['picnic-thread','p'.repeat(32)]]);
  const calls=[];
  let writes=0;
  class Element {
    constructor(tag='div',attrs='',text='') {
      this.tag=tag;this.textContent=text;this.value='';this.dataset={};this.attributes={};this.hidden=/\bhidden\b/.test(attrs);this.disabled=/\bdisabled\b/.test(attrs);
      const classes=new Set((attrs.match(/class="([^"]*)"/)?.[1]||'').split(/\s+/));
      this.classList={add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name),toggle(name,value){if(value)classes.add(name);else classes.delete(name);}};
    }
    set innerHTML(value){this.markup=value;register(value);}
    get innerHTML(){return this.markup||'';}
    setAttribute(name,value){this.attributes[name]=value;}
    removeAttribute(name){delete this.attributes[name];}
    append(...items){this.children=[...(this.children||[]),...items];}
    replaceChildren(){this.children=[];}
    scrollIntoView(){}
    focus(){this.focused=true;}
  }
  function register(html){
    for(const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>([^<]*)/g))elements.set('#'+match[3],new Element(match[1],match[2],match[4]));
  }
  register(fs.readFileSync(path.join(root,'index.html'),'utf8'));
  for(const name of ['.chat-workspace','.plan-preview','.chat-main','.skip-link','.conversation'])elements.set(name,new Element());
  const server={stage:'approval',plan:{
    status:needsRevision?'needs_revision':'pending_approval',
    request:{guests:12,budget:600,date:'2027-06-12',location:'San Ramon',distance_miles:20,food_category:'Vegetarian'},
    venues:[{id:'park',name:'Park',features:'Picnic tables'}],selected_venue:'park',
    food_selection:{mode:'shop',business:null},food_choices:['Brunch'],food_source:'Grocery / self catered',dietary_preferences:[],
    menu:['Wraps'],budget:{'Food & drinks':360},total:360,remaining:240,schedule:[],activities:[],shopping_list:[],guest_assignments:[],backup_plan:'Reschedule.',warnings:[],
  }};
  const snapshot=()=>JSON.parse(JSON.stringify({...server,state:server.plan.request,reply:'Review your picnic.'}));
  const context=vm.createContext({
    URL,Intl,Date,Map,location:{hash:'',pathname,search:'',href:''},setTimeout:()=>1,clearTimeout(){},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{storage.set(key,value);if(key==='gather-plan')writes++;},removeItem:key=>storage.delete(key)},
    sessionStorage:{getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,value)},
    document:{body:new Element(),querySelector:selector=>elements.get(selector)||null,querySelectorAll:()=>[],createElement:tag=>new Element(tag)},
    fetch:async(url,options)=>{
      const payload=options?.body?JSON.parse(options.body):null;calls.push({url,payload});
      if(payload?.action==='approve'){
        if(rejectApproval)return {ok:false,json:async()=>({detail:'This plan needs a revision.'})};
        server.plan.status='approved';server.stage='share';
      }
      return {ok:true,json:async()=>snapshot()};
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root,'plan-ui.js'),'utf8'),context);
  const source=fs.readFileSync(path.join(root,'app.js'),'utf8').replace('if(threadId)restore();','if(threadId)globalThis.ready=restore();');
  vm.runInContext(source,context);
  await context.ready;
  return {elements,storage,calls,session,location:context.location,get writes(){return writes;},revise(){server.plan.status='pending_approval';server.stage='approval';context.revised=snapshot();vm.runInContext('applyResult(revised,{openShare:false})',context);}};
}

test('save and finalize unlocks and highlights sharing, including a second save',async()=>{
  const p=await planner();
  assert.equal(p.elements.get('#share').disabled,true);
  await p.elements.get('#save').onclick();
  assert.equal(p.elements.get('#share').disabled,false);
  assert.equal(p.elements.get('#share').classList.contains('share-ready'),true);
  assert.equal(p.elements.get('#share').focused,true);
  assert.equal(JSON.parse(p.storage.get('gather-plan')).status,'approved');
  assert.match(p.elements.get('#plan-next-step').textContent,/Next: Share for review/);
  await p.elements.get('#save').onclick();
  assert.equal(p.elements.get('#share').disabled,false);
  assert.equal(p.writes,2);
  assert.equal(p.calls.filter(call=>call.payload?.action==='approve').length,1);
});

test('save draft keeps sharing locked and explains how to finalize',async()=>{
  const p=await planner();
  p.elements.get('#save-draft').onclick();
  assert.equal(JSON.parse(p.storage.get('gather-plan')).status,'pending_approval');
  assert.equal(p.elements.get('#share').disabled,true);
  assert.match(p.elements.get('#toast').textContent,/Save & finalize/);
  assert.equal(p.calls.filter(call=>call.payload?.action==='approve').length,0);
});

test('failed server approval never saves an approved plan or unlocks sharing',async()=>{
  const p=await planner({rejectApproval:true});
  await p.elements.get('#save').onclick();
  assert.equal(p.storage.has('gather-plan'),false);
  assert.equal(p.elements.get('#share').disabled,true);
});

test('food revisions require finalization again before sharing',async()=>{
  const p=await planner();
  await p.elements.get('#save').onclick();
  p.revise();
  assert.equal(p.elements.get('#share').disabled,true);
  await p.elements.get('#save').onclick();
  assert.equal(p.elements.get('#share').disabled,false);
  assert.equal(p.calls.filter(call=>call.payload?.action==='approve').length,2);
});

test('budget revisions block finalization and still allow a draft save',async()=>{
  const p=await planner({needsRevision:true});
  assert.equal(p.elements.get('#save').disabled,true);
  await p.elements.get('#save').onclick();
  assert.equal(p.calls.filter(call=>call.payload?.action==='approve').length,0);
  p.elements.get('#save-draft').onclick();
  assert.equal(JSON.parse(p.storage.get('gather-plan')).status,'needs_revision');
  assert.equal(p.elements.get('#share').disabled,true);
});

test('chat view offers a handoff without rendering the full picnic or save controls',async()=>{
  const p=await planner({pathname:'/'});
  assert.equal(p.elements.get('.conversation').hidden,false);
  assert.equal(p.elements.get('.plan-preview').hidden,true);
  assert.equal(p.elements.get('#planner-handoff').hidden,false);
  assert.equal(p.elements.has('#save'),false);
  assert.equal(p.elements.get('#open-picnic').href,'picnic.html#'+'p'.repeat(32));
  p.elements.get('#picnic-nav').onclick();
  assert.equal(p.location.href,'picnic.html#'+'p'.repeat(32));
});

test('Your picnic hides the chat and makes the review controls available',async()=>{
  const p=await planner();
  assert.equal(p.elements.get('.conversation').hidden,true);
  assert.equal(p.elements.get('#details-guide').hidden,true);
  assert.equal(p.elements.get('#picnic-page-heading').hidden,false);
  assert.equal(p.elements.get('.plan-preview').hidden,false);
  assert.equal(p.elements.get('#picnic-nav').classList.contains('active'),true);
  let prevented=false;
  p.elements.get('.skip-link').onclick({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
});

test('an empty Your picnic page points back to the planner',async()=>{
  const p=await planner({empty:true});
  assert.equal(p.elements.get('#picnic-empty').hidden,false);
  assert.equal(p.elements.get('.plan-preview').hidden,true);
  assert.equal(p.elements.get('.conversation').hidden,true);
});

test('conversation history survives navigation and restore does not repeat the reply',async()=>{
  const key='picnic-chat-'+'p'.repeat(32);
  const session=new Map([[key,JSON.stringify([{role:'user',text:'Plan a picnic with wraps.'}])]]);
  await planner({pathname:'/',session});
  const before=JSON.parse(session.get(key));
  assert.equal(before[0].text,'Plan a picnic with wraps.');
  assert.equal(before.length,2);
  await planner({session});
  assert.equal(JSON.parse(session.get(key)).length,2);
  const back=await planner({pathname:'/',session});
  assert.equal(back.elements.get('#messages').children.length,2);
});
