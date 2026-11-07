const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../frontend');
const context=vm.createContext({URL,Intl});
for(const file of ['vendor/qrcode-generator.js','invite-data.js','invite-canvas.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
const invite=vm.runInContext('PicnicInvite',context),art=vm.runInContext('PicnicInviteCanvas',context);
const fixture=()=>({id:'same-legacy-id',request:{date:'2027-06-12',guests:10,budget:500,location:'Private starting address',notes:'Private notes',participants:['private@example.test']},selected_venue:'park',venues:[{id:'park',name:'Sunny Park'}],menu:['Wraps','Fruit','Cookies'],food_source:'Grocery',account_email:'owner@example.test',workflow_thread:'w'.repeat(32)});
const shared={path:'/review.html#'+'r'.repeat(32)};
const ok=plan=>({ok:true,json:async()=>({plan})});

test('invite fields and captions exclude private organizer and group details',async()=>{
  const plan=fixture(),before=JSON.stringify(plan);
  const draft=await invite.prepare(plan,{origin:'https://picnic.example'});
  const exported=JSON.stringify(draft.fields)+' '+invite.caption(draft.fields);
  for(const privateValue of ['Private notes','Private starting address','private@example.test','owner@example.test','w'.repeat(32)])assert.doesNotMatch(exported,new RegExp(privateValue));
  assert.equal(draft.fields.venue,'Sunny Park');assert.equal(draft.fields.food,'Wraps · Fruit');assert.equal(draft.fields.time,'');
  assert.equal(JSON.stringify(plan),before);
});

test('QR links are validated against the matching public snapshot without publishing',async()=>{
  const plan=fixture(),calls=[];
  const draft=await invite.prepare(plan,{thread:'w'.repeat(32),origin:'https://picnic.example',fetcher:async(url,options)=>{calls.push({url,options});return url.startsWith('/api/workflows/')?{ok:true,json:async()=>({shared})}:ok(plan);}});
  assert.equal(draft.review.url,'https://picnic.example'+shared.path);
  assert.equal(draft.review.status,'ready');assert.equal(calls.length,2);
  assert.equal(calls.some(call=>call.options?.method),false);
  assert.match(calls[1].url,/^\/api\/shares\//);
});

test('an unrelated or updated public snapshot never becomes the saved plan QR',async()=>{
  const draft=await invite.prepare(fixture(),{shared,origin:'https://picnic.example',fetcher:async()=>ok({...fixture(),menu:['A different menu']})});
  assert.equal(draft.review.url,null);assert.equal(draft.review.status,'different-version');
});

test('workflow, login and foreign links are rejected without being requested',async()=>{
  for(const path of ['/picnic.html#'+'w'.repeat(32),'/login.html#'+'m'.repeat(43),'https://evil.example'+shared.path,'/review.html?private=x#'+'r'.repeat(32)]){
    let calls=0;const draft=await invite.prepare(fixture(),{shared:{path},origin:'https://picnic.example',fetcher:async()=>{calls++;return ok(fixture());}});
    assert.equal(draft.review.url,null);assert.equal(calls,0);
  }
});

test('localhost QR codes are omitted while the invitation remains usable',async()=>{
  const draft=await invite.prepare(fixture(),{shared,origin:'http://127.0.0.1:8002',fetcher:async()=>ok(fixture())});
  assert.equal(draft.review.status,'local');assert.equal(draft.review.url,null);assert.equal(draft.fields.venue,'Sunny Park');
});

test('a failed review lookup does not prevent creation of the invitation',async()=>{
  const draft=await invite.prepare(fixture(),{shared,origin:'https://picnic.example',fetcher:async()=>{throw Error('offline');}});
  assert.equal(draft.review.status,'unavailable');assert.equal(draft.fields.date,'2027-06-12');
  assert.equal(invite.timeLabel(''),'Time to be confirmed');assert.equal(invite.timeLabel('25:00'),'Time to be confirmed');
  assert.equal(invite.dateLabel('2027-02-30'),'Date to be confirmed');
});

function drawing(){
  const calls={text:[],rect:[]};
  const ctx={beginPath(){},moveTo(){},arcTo(){},closePath(){},fill(){},save(){},restore(){},clip(){},drawImage(){},fillRect(...args){calls.rect.push(args);},fillText(...args){calls.text.push(args);},measureText:text=>({width:Array.from(text).length*15}),createLinearGradient:()=>({addColorStop(){}})};
  return {ctx,calls};
}
test('the social image has fixed dimensions, includes selected public details and wraps long names',()=>{
  const {ctx,calls}=drawing(),canvas={getContext:()=>ctx};const fields=invite.fields(fixture());
  art.draw(canvas,fields);
  assert.equal(canvas.width,1080);assert.equal(canvas.height,1350);
  const text=calls.text.map(item=>item[0]).join(' ');
  assert.match(text,/Sunny Park/);assert.match(text,/Wraps · Fruit/);assert.match(text,/Time to be confirmed/);assert.doesNotMatch(text,/Private|owner@example/);
  const long=art.wrap(ctx,'A'.repeat(200),450);assert.ok(long.length>1);assert.ok(long.every(line=>ctx.measureText(line).width<=450));
});
test('the vendored QR encoder draws a high contrast matrix with a quiet border inside its tile',()=>{
  const {ctx,calls}=drawing();art.qr(ctx,'https://picnic.example'+shared.path,20,30,204);
  assert.deepEqual(calls.rect[0],[20,30,204,204]);assert.ok(calls.rect.length>100);
  for(const [x,y,w,h] of calls.rect.slice(1)){assert.ok(Number.isInteger(x)&&Number.isInteger(y));assert.ok(x>=28&&y>=38);assert.ok(x+w<=216&&y+h<=226);}
});


test('editing event details disables an outdated QR but personal wording can keep it',async()=>{
  const draft=await invite.prepare(fixture(),{shared,origin:'https://picnic.example',fetcher:async()=>ok(fixture())});
  assert.ok(invite.reviewForFields(draft,{...draft.fields,title:'Our family picnic'},'https://picnic.example'));
  assert.equal(invite.reviewForFields(draft,{...draft.fields,date:'2027-06-13'},'https://picnic.example'),null);
  assert.equal(invite.reviewForFields(draft,{...draft.fields,venue:'A different park'},'https://picnic.example'),null);
  assert.equal(invite.reviewForFields(draft,{...draft.fields,food:'Pizza'},'https://picnic.example'),null);
});


test('invite wording stays with its workflow when organizers switch between plans',async()=>{
  const stored=new Map();
  const scope=vm.createContext({URL,Intl,sessionStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)}});
  vm.runInContext(fs.readFileSync(path.join(root,'invite-data.js'),'utf8'),scope);
  const helper=vm.runInContext('PicnicInvite',scope);
  const options=thread=>({thread,origin:'https://picnic.example',fetcher:async()=>({ok:true,json:async()=>({})})});
  const first=await helper.resume(fixture(),options('a'.repeat(32)));first.fields.title='Family day!';helper.storeDraft(first);
  const second=await helper.resume({...fixture(),venues:[{id:'park',name:'Other Park'}]},options('b'.repeat(32)));second.fields.title='Friends day!';helper.storeDraft(second);
  const restored=await helper.resume(fixture(),options('a'.repeat(32)));
  assert.equal(restored.fields.title,'Family day!');assert.equal(restored.fields.venue,'Sunny Park');
  const changed=await helper.resume({...fixture(),request:{...fixture().request,date:'2027-07-01'}},options('a'.repeat(32)));
  assert.equal(changed.fields.date,'2027-07-01');assert.equal(changed.fields.title,'You’re invited to a picnic!');
});
