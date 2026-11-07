// Run with: node --test tests/test_planner_actions.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root=path.join(__dirname,'../frontend');

async function planner({rejectApproval=false, needsRevision=false,pathname='/picnic.html',session=new Map(),empty=false,account=null,hash='',search='',storedPlan=null}={}) {
  const elements=new Map(), storage=new Map(empty?[]:[['picnic-thread','p'.repeat(32)]]);
  if(storedPlan)storage.set('gather-plan',JSON.stringify(storedPlan));
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
    ...(account?{BBAccount:account}:{}),
    URL,URLSearchParams,Intl,Date,Map,matchMedia:()=>({matches:false}),history:{replaceState(){}},location:{hash,pathname,search,href:''},setTimeout:()=>1,clearTimeout(){},
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
  vm.runInContext(fs.readFileSync(path.join(root,'invite-data.js'),'utf8'),context);
  const source=fs.readFileSync(path.join(root,'app.js'),'utf8').replace('if(threadId)restore();','if(threadId)globalThis.ready=restore();').replace("isSavedRoute())showSaved();else","isSavedRoute())globalThis.ready=showSaved();else");
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
  await p.elements.get('#save-draft').onclick();
  assert.equal(JSON.parse(p.storage.get('gather-plan')).status,'pending_approval');
  assert.equal(p.elements.get('#guest-signin-prompt').hidden,false);
  p.elements.get('#dismiss-guest-signin').onclick();
  await p.elements.get('#save-draft').onclick();
  assert.equal(p.elements.get('#guest-signin-prompt').hidden,true);
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
  await p.elements.get('#save-draft').onclick();
  assert.equal(JSON.parse(p.storage.get('gather-plan')).status,'needs_revision');
  assert.equal(p.elements.get('#share').disabled,true);
});

test('chat view offers a handoff without rendering the full picnic or save controls',async()=>{
  const p=await planner({pathname:'/'});
  assert.equal(p.elements.get('.conversation').hidden,false);
  assert.equal(p.elements.get('.plan-preview').hidden,true);
  assert.equal(p.elements.get('#planner-handoff').hidden,false);
  assert.equal(p.elements.get('#resume-context').hidden,false);
  assert.match(p.elements.get('#resume-context-details').textContent,/Guests: 12 people/);
  assert.match(p.elements.get('#resume-context-details').textContent,/Food: Vegetarian/);
  assert.equal(p.elements.has('#save'),false);
  assert.equal(p.elements.get('#open-picnic').href,'picnic.html#'+'p'.repeat(32));
  p.elements.get('#picnic-nav').onclick();
  assert.equal(p.location.href,'picnic.html#'+'p'.repeat(32));
});

test('Your picnic hides the chat and makes the review controls available',async()=>{
  const p=await planner();
  assert.equal(p.elements.get('.conversation').hidden,true);
  assert.equal(p.elements.get('#details-guide').hidden,true);
  assert.equal(p.elements.get('#resume-context').hidden,true);
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


test('starting fresh from the resume notice clears collected details and opens the first required step',async()=>{
  const p=await planner({pathname:'/'});
  const previousRequests=p.calls.length;
  p.elements.get('#start-new-picnic').onclick();
  assert.equal(p.elements.get('#resume-context').hidden,true);
  assert.equal(p.elements.get('#details-count').textContent,'0 of 6 collected');
  assert.equal(p.elements.get('#detail-step-form').hidden,false);
  assert.match(p.elements.get('#detail-step-field').innerHTML,/What is your total picnic budget/);
  assert.equal(p.storage.has('picnic-thread'),false);
  assert.equal(p.calls.length,previousRequests);
});

test('signed-in saves wait for the server and retain the canonical account timestamp',async()=>{
  let resolveSave;
  const account={ready:Promise.resolve(),state:{email:'host@example.test'},save:()=>new Promise(resolve=>{resolveSave=resolve;})};
  const p=await planner({account});
  const pending=p.elements.get('#save-draft').onclick();
  assert.equal(p.writes,0);
  assert.equal(p.elements.get('#save-draft').disabled,true);
  resolveSave({id:'a'.repeat(32),email:'host@example.test',saved_at:'2026-11-06T18:30:00+00:00'});
  await pending;
  const saved=JSON.parse(p.storage.get('gather-plan'));
  assert.equal(saved.saved_at,'2026-11-06T18:30:00+00:00');
  assert.equal(saved.account_plan_id,'a'.repeat(32));
  assert.equal(saved.account_email,'host@example.test');
  assert.equal(p.elements.get('#guest-signin-prompt').hidden,true);
  assert.equal(p.elements.get('#save-draft').disabled,false);
});

test('an account save failure preserves a browser copy without claiming account success',async()=>{
  const account={ready:Promise.resolve(),state:{email:'host@example.test'},save:async()=>{throw Error('Account connection unavailable.');}};
  const p=await planner({account});
  await p.elements.get('#save-draft').onclick();
  assert.equal(p.writes,1);
  assert.equal(JSON.parse(p.storage.get('gather-plan')).account_email,'host@example.test');
  assert.match(p.elements.get('#toast').textContent,/Account connection unavailable/);
  assert.equal(p.elements.get('#share').disabled,true);
});


test('Your picnic refreshes a compact feedback summary and links to the full account view',async()=>{
  let reads=0;
  const account={ready:Promise.resolve(),state:{email:'host@example.test'},api:async()=>({id:'c'.repeat(32),feedback:[{email:'guest@example.test',response:++reads===1?'Suggest a change':'Looks good',comment:'Guest comment stays in My Picnic.',created_at:'2026-11-06T18:30:00Z'}]})};
  const p=await planner({account});
  for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(p.elements.get('#picnic-crew-feedback').hidden,false);
  assert.match(p.elements.get('#picnic-crew-summary').innerHTML,/1<\/strong>Suggest a change/);
  assert.equal(p.elements.has('#picnic-crew-responses'),false);
  assert.equal(p.elements.get('#manage-picnic-crew').href,'account.html?plan='+'c'.repeat(32));
  await p.elements.get('#refresh-picnic-feedback').onclick();
  assert.match(p.elements.get('#picnic-crew-summary').innerHTML,/1<\/strong>Looks good/);
});


test('Create a Picnic Invite prepares public details and opens the editor without publishing',async()=>{
  const p=await planner();
  await p.elements.get('#download').onclick();
  assert.equal(p.location.href,'invite.html');
  const draft=JSON.parse(p.session.get('bb-picnic-invite'));
  assert.equal(draft.fields.venue,'Park');assert.equal(draft.fields.food,'Wraps');
  assert.equal('request' in draft,false);assert.equal('workflow_thread' in draft.fields,false);
  assert.equal(p.calls.some(call=>call.payload?.action==='share'),false);
});


test('Saved plan loads the requested account snapshot without overwriting another browser save',async()=>{
  const requests=[];
  const copy={id:'same-legacy-id',request:{date:'2027-06-12',guests:10,location:'Browser Park'},venues:[{id:'park',name:'Browser Park'}],budget:{},warnings:[]};
  const id='b'.repeat(32),thread='s'.repeat(32),savedAt='2026-11-01T18:00:00Z';
  const snapshot={...copy,request:{...copy.request,guests:22,location:'Selected Park'},venues:[{id:'park',name:'Selected Park'}],selected_venue:'park',total:0,remaining:0,status:'approved',menu:[],schedule:[],shopping_list:[],guest_assignments:[],warnings:[]};
  const account={ready:Promise.resolve(),state:{email:'host@example.test'},api:async url=>{requests.push(url);return {role:'organizer',plan:snapshot,thread_id:thread,saved_at:savedAt};}};
  const p=await planner({pathname:'/',hash:'#saved',search:'?plan='+id,storedPlan:copy,account});
  assert.deepEqual(requests,['/api/account/plans/'+id]);assert.equal(p.writes,0);
  assert.equal(JSON.parse(p.storage.get('gather-plan')).request.location,'Browser Park');
  assert.match(p.elements.get('#saved-description').textContent,/22 guests · Selected Park/);
  assert.match(p.elements.get('#saved-copy-note').textContent,/saved account snapshot/);
  p.elements.get('#resume-saved').onclick();
  assert.equal(p.location.href,'picnic.html?plan='+id+'#'+thread);
});
