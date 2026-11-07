const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../frontend');
const settle=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
function browser(page,{hash='',search='',email=null,stored=new Map(),routes={},clock=null}={}){
  const elements=new Map(),calls=[],historyCalls=[],timers=[];
  class Element{
    constructor(attrs=''){this.hidden=/\bhidden\b/.test(attrs);this.disabled=false;this.textContent='';this.value='';this.dataset={};this.attributes={};}
    set innerHTML(value){this.markup=value;}
    get innerHTML(){return this.markup||'';}
    focus(){this.focused=true;}
  }
  const html=fs.readFileSync(path.join(root,page),'utf8');
  for(const match of html.matchAll(/<\w+\b([^>]*\bid="([^"]+)"[^>]*)>/g))elements.set('#'+match[2],new Element(match[1]));
  const context=vm.createContext({
    URL,URLSearchParams,Intl,Date:clock?class extends Date{static now(){return clock.now;}}:Date,Map,setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},location:{pathname:'/'+page,search,hash,href:''},history:{replaceState:(...args)=>historyCalls.push(args)},
    localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)},sessionStorage:{getItem:key=>stored.get('session:'+key),setItem:(key,value)=>stored.set('session:'+key,value),removeItem:key=>stored.delete('session:'+key)},
    document:{querySelector:selector=>elements.get(selector)||null,querySelectorAll:()=>[]},
    fetch:async(url,options={})=>{calls.push({url,...options});const body=options.body?JSON.parse(options.body):null;
      const result=routes[url]?await routes[url](body):url==='/api/auth/me'?{email}:url==='/api/auth/config'?{local_preview:true,email_configured:true}:{};
      return {ok:!result.error,status:result.error?(result.status||400):200,headers:{get:()=>result.retryAfter?String(result.retryAfter):null},json:async()=>result.error?{detail:result.error}:result};},
  });
  vm.runInContext(fs.readFileSync(path.join(root,'session.js'),'utf8'),context);
  if(page==='account.html')for(const file of ['plan-ui.js','plan-picker.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,page.replace('.html','.js')),'utf8'),context);
  return {context,elements,calls,historyCalls,stored,timers};
}

test('opening an email link inspects it without signing in until explicit confirmation',async()=>{
  const token='a'.repeat(43);
  const p=browser('login.html',{hash:'#'+token,routes:{
    '/api/auth/inspect':()=>({email:'guest@example.test',invitation:true}),
    '/api/auth/verify':()=>({email:'guest@example.test',path:'/account.html?plan='+'p'.repeat(32)}),
  }});
  await settle();
  assert.equal(p.historyCalls[0][2],'/login.html');
  assert.equal(p.elements.get('#verify-email').textContent,'guest@example.test');
  assert.equal(p.elements.get('#verify-panel').hidden,false);
  assert.equal(p.calls.some(call=>call.url==='/api/auth/verify'),false);
  await p.elements.get('#finish-sign-in').onclick();
  assert.equal(p.context.location.href,'/account.html?plan='+'p'.repeat(32));
  assert.equal(p.calls.find(call=>call.url==='/api/auth/verify').headers['X-BB-Request'],'1');
});

test('local sign-in clearly shows a preview while production uses the email message',async()=>{
  const p=browser('login.html',{routes:{'/api/auth/link':()=>({preview:{email:'a@example.test',preview_url:'http://localhost/login.html#'+'x'.repeat(43)}})}});
  await settle();p.elements.get('#login-email').value='a@example.test';
  await p.elements.get('#login-form').onsubmit({preventDefault(){}});
  assert.equal(p.elements.get('#email-preview').hidden,false);
  assert.match(p.elements.get('#login-status').textContent,/No email was sent/);
  assert.match(p.elements.get('#preview-link').href,/login.html#/);
  const real=browser('login.html',{routes:{'/api/auth/config':()=>({local_preview:false,email_configured:true}),'/api/auth/link':()=>({message:'Check your email.'})}});
  await settle();real.elements.get('#login-email').value='a@example.test';
  await real.elements.get('#login-form').onsubmit({preventDefault(){}});
  assert.equal(real.elements.get('#email-preview').hidden,true);
  assert.equal(real.elements.get('#login-status').textContent,'Check your email.');
});

test('expired links leave the email form available without creating a session',async()=>{
  const p=browser('login.html',{hash:'#'+'x'.repeat(43),routes:{'/api/auth/inspect':()=>({error:'This link has expired.'})}});
  await settle();assert.match(p.elements.get('#login-status').textContent,/expired/);
  assert.equal(p.elements.get('#verify-panel').hidden,true);
  assert.equal(p.elements.get('#login-form').hidden,false);
  assert.equal(p.calls.some(call=>call.url==='/api/auth/verify'),false);
});

test('switching accounts clears another account’s browser copy',async()=>{
  const stored=new Map([['gather-plan',JSON.stringify({account_email:'old@example.test'})],['picnic-thread','p'.repeat(32)]]);
  const p=browser('login.html',{hash:'#'+'x'.repeat(43),email:'old@example.test',stored,routes:{'/api/auth/inspect':()=>({email:'new@example.test'}),'/api/auth/verify':()=>({email:'new@example.test',path:'/account.html'})}});
  await settle();await p.elements.get('#finish-sign-in').onclick();
  assert.equal(p.stored.has('gather-plan'),false);assert.equal(p.stored.has('picnic-thread'),false);
});

test('group guests see saved sections and feedback without organizer controls',async()=>{
  const id='p'.repeat(32);
  const plan={status:'approved',request:{date:'2027-06-12',guests:12,location:'Park',budget:600},venues:[{id:'park',name:'Sunny Park'}],selected_venue:'park',budget:{Food:360},total:360,remaining:240,menu:[],schedule:[],shopping_list:[],guest_assignments:[],warnings:[]};
  const p=browser('account.html',{email:'guest@example.test',routes:{'/api/account/plans':()=>({plans:[{id,role:'guest',venue:'Sunny Park',date:'2027-06-12',guests:12,saved_at:'2026-11-06T18:30:00Z'}]}),['/api/account/plans/'+id]:()=>({role:'guest',venue:'Sunny Park',plan,saved_at:'2026-11-06T18:30:00Z',feedback:[]})}});
  await settle();
  assert.equal(p.elements.get('#account-detail').hidden,false,p.elements.get('#account-status').textContent);
  assert.equal(p.elements.get('#invite-panel').hidden,true);
  assert.equal(p.elements.get('#account-feedback-form').hidden,false);
  assert.equal(p.elements.get('#edit-account-plan').hidden,true);
  assert.match(p.elements.get('#account-sections').innerHTML,/Food & dietary needs/);
  p.elements.get('#crew-response').value='Looks good';p.elements.get('#crew-comment').value='See you there!';
  await p.elements.get('#account-feedback-form').onsubmit({preventDefault(){}});
  const sent=JSON.parse(p.calls.find(call=>call.url.endsWith('/feedback')).body);
  assert.equal(sent.comment,'See you there!');assert.equal('email' in sent,false);
});


test('rate limits show a countdown and prevent retries until the remaining wait expires',async()=>{
  const clock={now:10000};let requests=0;
  const p=browser('login.html',{clock,routes:{'/api/auth/link':()=>++requests===1?{error:'Too many requests. Try again in 5 seconds.',status:429,retryAfter:5}:{message:'Check your email.'}}});
  await settle();p.elements.get('#login-email').value='guest@example.test';
  await p.elements.get('#login-form').onsubmit({preventDefault(){}});
  assert.equal(p.elements.get('#send-link').disabled,true);
  assert.equal(p.elements.get('#send-link').textContent,'Try again in 0:05');
  await p.elements.get('#login-form').onsubmit({preventDefault(){}});
  assert.equal(requests,1);
  clock.now+=5000;p.timers.shift()();
  assert.equal(p.elements.get('#send-link').disabled,false);
  assert.equal(p.elements.get('#send-link').textContent,'Send my link →');
  await p.elements.get('#login-form').onsubmit({preventDefault(){}});
  assert.equal(requests,2);
  assert.equal(p.elements.get('#login-status').textContent,'Check your email.');
});


test('organizers review and refresh guest feedback without a response form',async()=>{
  const id='p'.repeat(32);let reads=0;
  const plan={status:'approved',request:{date:'2027-06-12',guests:12,location:'Park',budget:600},venues:[{id:'park',name:'Sunny Park'}],selected_venue:'park',budget:{Food:360},total:360,remaining:240,menu:[],schedule:[],shopping_list:[],guest_assignments:[],warnings:[]};
  const p=browser('account.html',{email:'host@example.test',routes:{'/api/account/plans':()=>({plans:[{id,role:'organizer',venue:'Sunny Park',date:'2027-06-12',guests:12,saved_at:'2026-11-06T18:30:00Z'}]}),['/api/account/plans/'+id]:()=>({role:'organizer',venue:'Sunny Park',plan,saved_at:'2026-11-06T18:30:00Z',members:[],feedback:[{email:'guest@example.test',response:'Looks good',comment:++reads===1?'I can bring fruit.':'I can bring dessert.',created_at:'2026-11-06T18:30:00Z'},{email:'host@example.test',response:'Looks good',comment:'Old organizer response',created_at:'2026-11-06T18:30:00Z'}]})}});
  await settle();
  assert.equal(p.elements.get('#account-feedback-form').hidden,true);
  assert.equal(p.elements.get('#crew-feedback-title').textContent,'Your crew’s feedback 🌿');
  assert.match(p.elements.get('#crew-responses').innerHTML,/I can bring fruit/);
  assert.doesNotMatch(p.elements.get('#crew-responses').innerHTML,/Old organizer response/);
  assert.match(p.elements.get('#crew-feedback-summary').innerHTML,/1 guest has responded/);
  await p.elements.get('#refresh-crew-feedback').onclick();
  assert.match(p.elements.get('#crew-responses').innerHTML,/I can bring dessert/);
  await p.elements.get('#account-feedback-form').onsubmit({preventDefault(){}});
  assert.equal(p.calls.some(call=>call.url.endsWith('/feedback')),false);
});


test('account dropdown switches plan details, members and feedback while guarding unsent invitations',async()=>{
  const a='a'.repeat(32),b='b'.repeat(32);
  const plan=venue=>({status:'approved',request:{date:'2027-06-12',guests:10,location:'City',budget:500},venues:[{id:'park',name:venue}],selected_venue:'park',budget:{},total:0,remaining:0,menu:[],schedule:[],shopping_list:[],guest_assignments:[],warnings:[]});
  const summary=(id,venue)=>({id,thread_id:(id===a?'x':'y').repeat(32),role:'organizer',venue,date:'2027-06-12',guests:10,saved_at:'2026-11-06T18:30:00Z'});
  const detail=(id,venue,comment)=>({...summary(id,venue),plan:plan(venue),members:[{email:id===a?'first@example.test':'second@example.test'}],feedback:[{email:'guest@example.test',response:'Looks good',comment,created_at:'2026-11-06T18:30:00Z'}]});
  const p=browser('account.html',{email:'host@example.test',search:'?plan='+a,routes:{'/api/account/plans':()=>({plans:[summary(a,'Park A'),summary(b,'Park B')]}),['/api/account/plans/'+a]:()=>detail(a,'Park A','Feedback for A'),['/api/account/plans/'+b]:()=>detail(b,'Park B','Feedback for B')}});
  await settle();assert.equal(p.elements.get('#organizer-plan').value,a);
  p.elements.get('#guest-emails').value='unsent@example.test';
  await p.elements.get('#organizer-plan').onchange({target:{value:b}});
  assert.equal(p.elements.get('#account-plan-title').textContent,'Park A');assert.match(p.elements.get('#plan-picker-status').textContent,/Send or clear/);
  p.elements.get('#guest-emails').value='';p.elements.get('#invite-previews').hidden=false;p.elements.get('#invite-previews').innerHTML='Old preview';
  await p.elements.get('#organizer-plan').onchange({target:{value:b}});
  assert.equal(p.elements.get('#account-plan-title').textContent,'Park B');
  assert.match(p.elements.get('#crew-responses').innerHTML,/Feedback for B/);assert.doesNotMatch(p.elements.get('#crew-responses').innerHTML,/Feedback for A/);
  assert.match(p.elements.get('#account-members').innerHTML,/second@example.test/);assert.equal(p.elements.get('#invite-previews').hidden,true);
  assert.equal(p.elements.get('#edit-account-plan').href,'picnic.html?plan='+b+'#'+'y'.repeat(32));
  assert.equal(p.calls.some(call=>call.method==='POST'),false);
});
