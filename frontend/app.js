const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = v => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);
const localDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const isPicnicPage=location.pathname==='/picnic.html';
const isSavedRoute=()=>/^#saved(?:-|$)/.test(location.hash);
document.body.classList.toggle('picnic-page',isPicnicPage);
if(isPicnicPage)document.title='Your picnic — Blanket & Bites';
let plan=null, state={}, busy=false, threadId=null, stage=null;
let transcript=[];
let resumedWorkflow=false;
let latestShared=null;
let feedbackLoad=0;
let selectedDetail=null, savedPlan=null;
let pickerReady=Promise.resolve();
let accountPlanCount=0;
function updateSavedCount(){$('#saved-count').textContent=String(accountPlanCount||(readSaved()?1:0));}
const requestedPlan=new URLSearchParams(location.search).get('plan');
const validPlanId=value=>/^[A-Za-z0-9_-]{32}$/.test(value||'');
function activeAccountId(){return !$('#saved-view').hidden?savedPlan?.account_plan_id:globalThis.BBPlanPicker?.current()?.id;}
function planPage(page,token=threadId,id=activeAccountId()){return `${page}${validPlanId(id)?'?plan='+id:''}${token?'#'+token:''}`;}
function savedPage(){const id=activeAccountId();return validPlanId(id)?`/?plan=${id}#saved`:'/#saved';}
function switchBlocked(){return busy?'Please wait for this step to finish.':$('#chat-input').value.trim()||selectedDetail||$('#details-dialog').open?'Finish or close your current detail before switching picnics. Your chat will be kept.':false;}
async function setupPlanPicker(){
  if(!globalThis.BBPlanPicker)return;
  const picker=await BBPlanPicker.init({currentThread:isSavedRoute()?null:threadId,currentId:isSavedRoute()?requestedPlan:null,beforeSelect:switchBlocked,onSelect:async item=>{
    if(!isPicnicPage&&!isSavedRoute()&&threadId)history.replaceState(null,'',`/?thread=${threadId}`);
    location.href=isSavedRoute()?`/?plan=${item.id}#saved`:isPicnicPage?planPage('picnic.html',item.thread_id,item.id):`/?thread=${item.thread_id}&plan=${item.id}`;
  }});
  accountPlanCount=picker?.items.length||0;updateSavedCount();
  if(!isSavedRoute())syncWorkspace();
}
function toast(msg){$('#toast').textContent=msg;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,3500);}
function readSaved(){try{const p=JSON.parse(localStorage.getItem('gather-plan'));if(p?.account_email&&globalThis.BBAccount&&p.account_email!==BBAccount.state.email)return null;return p?.request&&p.venues?.length&&p.budget&&p.warnings?p:null;}catch{return null;}}
function frame(title,sub,body){$('#flow-screen').hidden=false;$('.plan-preview').hidden=false;$('.chat-workspace').classList.add('has-plan');$('#flow-screen').innerHTML=`<section class="panel flow-panel"><h2>${title}</h2><p>${sub}</p>${body}</section>`;}
function rememberConversation(){
  if(!threadId)return;
  try{sessionStorage.setItem(`picnic-chat-${threadId}`,JSON.stringify(transcript.slice(-60)));}catch{}
}
function message(role,text,remember=true){
  const row=document.createElement('div');row.className=`chat-message ${role}`;
  const label=document.createElement('strong');label.textContent=role==='user'?'You':'BLANKET & BITES !!';
  const content=document.createElement('p');content.textContent=text;row.append(label,content);$('#messages').append(row);$('#welcome').hidden=true;
  if(!isPicnicPage)row.scrollIntoView({block:'nearest',behavior:'smooth'});
  if(remember){transcript.push({role,text:String(text).slice(0,8000)});transcript=transcript.slice(-60);rememberConversation();}
}
function restoreConversation(){
  let cached=[];
  try{const value=JSON.parse(sessionStorage.getItem(`picnic-chat-${threadId}`));if(Array.isArray(value))cached=value.filter(item=>['user','assistant'].includes(item?.role)&&typeof item.text==='string').slice(-60);}catch{}
  transcript=[];$('#messages').replaceChildren();$('#welcome').hidden=cached.length>0;
  for(const item of cached)message(item.role,item.text,false);
  transcript=cached;
}
function ensureThread(){if(!threadId){threadId=newThread();try{localStorage.setItem('picnic-thread',threadId);}catch{}if(!isPicnicPage)history.replaceState(null,'',`/?thread=${threadId}`);}}
function setBusy(value){busy=value;$('#send-message').disabled=value;$('#generate').disabled=value;$('#new-chat').disabled=value;$('#start-new-picnic').disabled=value;$('#edit-plan').disabled=value;$('#saved-nav').disabled=value;$('#food-nav').disabled=value;$('#picnic-nav').disabled=value;$('#planner-nav').disabled=value;$('#chat-status').textContent=value?'Putting the details together…':'';$('#chat-form').setAttribute('aria-busy',String(value));for(const id of ['save','save-draft','download','share','export-saved']){const button=$('#'+id);if(button)button.disabled=value||(id==='save'&&(!plan?.food_selection||plan.status==='needs_revision'))||(id==='share'&&stage!=='share'&&stage!=='shared');}$('#start-details').disabled=value;document.querySelectorAll('#details-guide button, #details-guide input, #details-guide select').forEach(el=>el.disabled=value||stage==='shared');}
function stateFromPlan(){state={...plan.request,selected_venue:plan.selected_venue};}
function safeLink(url){try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)?esc(u.href):'#';}catch{return '#';}}
function newThread(){const bytes=crypto.getRandomValues(new Uint8Array(24));return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_');}
function applyResult(result,{openShare=true,announce=true}={}){
  state=result.state||{};stage=result.stage;plan=result.plan||null;latestShared=result.shared||null;
  if(isPicnicPage){
    if(result.places&&stage==='places'){
      frame('Choose your picnic place','Find a spot for your kind of day. Select a place to plan the food.',`<div class="venue-results">${result.places.map(v=>`<article class="venue"><strong>${esc(v.name)}</strong><p>${esc(v.features)}</p><p><a href="${safeLink(v.source_url)}" target="_blank" rel="noopener noreferrer">View source ↗</a></p><button class="primary" data-select="${esc(v.id)}">Choose this place →</button></article>`).join('')}</div><div class="notice">Verify travel distance, fees, capacity and availability with the park.</div>`);
      document.querySelectorAll('[data-select]').forEach(button=>button.onclick=()=>action('select',{venue_id:button.dataset.select}));
    }else if(plan){story();}
    else{$('#flow-screen').hidden=true;}
  }
  syncWorkspace();renderGuide();refreshCrewFeedback();
  if(result.shared&&openShare)showShare(result.shared);
  if(result.reply&&announce)message('assistant',result.reply);
}
function syncWorkspace(){
  const hasPicnic=Boolean(plan)||stage==='places';
  const knownDetails=PicnicUI.fields.filter(field=>PicnicUI.hasValue(state,field.key));
  $('#resume-context').hidden=isPicnicPage||!resumedWorkflow||!knownDetails.length;
  $('#resume-context-details').textContent=knownDetails.map(field=>`${field.label}: ${field.format(state[field.key])}`).join(' · ');
  $('#picnic-page-heading').hidden=!isPicnicPage;
  if(!plan||globalThis.BBAccount?.state?.email)$('#guest-signin-prompt').hidden=true;
  $('#picnic-empty').hidden=!isPicnicPage||hasPicnic;
  $('#planner-hero').hidden=isPicnicPage;
  $('#details-guide').hidden=isPicnicPage;
  $('.conversation').hidden=isPicnicPage;
  $('.plan-preview').hidden=!isPicnicPage||!hasPicnic;
  $('.chat-workspace').classList.toggle('has-plan',isPicnicPage&&hasPicnic);
  $('#workspace-page-label').textContent=isPicnicPage?'Your picnic':'Picnic planner';
  $('#planner-handoff').hidden=isPicnicPage||!hasPicnic;
  $('#handoff-title').textContent=stage==='places'?'Your picnic places are ready':'Your picnic is coming together';
  $('#handoff-description').textContent=stage==='places'?'Open Your picnic to choose a place. You can keep chatting here to refine the details.':'Open Your picnic to review your place, food, budget and schedule. Come back here whenever you want to make a change.';
  $('#open-picnic').href=planPage('picnic.html');
  $('#open-picnic').textContent=stage==='places'?'Choose your picnic place ↗':'Open Your picnic ↗';
}
async function action(kind,extra={}){if(busy)return;setBusy(true);ensureThread();try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json','X-BB-Request':'1'},body:JSON.stringify({thread_id:threadId,action:kind,today:localDate(new Date()),...extra})});const result=await r.json();if(!r.ok)throw Error(typeof result.detail==='string'?result.detail:'Please check the details and try again.');applyResult(result);if(result.stage==='food'&&kind==='select')location.href=`food.html#${threadId}`;return true;}catch(e){message('assistant',e instanceof TypeError?'Cannot reach the planner. Please check your connection and retry.':e.message);return false;}finally{setBusy(false);$('#chat-input').focus();}}
async function send(text){if(busy||!text.trim())return;ensureThread();message('user',text);$('#chat-input').value='';return await action('message',{message:text});}
$('#chat-form').onsubmit=e=>{e.preventDefault();send($('#chat-input').value);};
$('#chat-input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send(e.target.value);}};
document.querySelectorAll('[data-prompt]').forEach(b=>b.onclick=()=>send(b.dataset.prompt));
function reset(){if(busy)return;resumedWorkflow=false;globalThis.BBPlanPicker?.clear();history.replaceState(null,'',location.pathname);if(isPicnicPage){try{localStorage.removeItem('picnic-thread');}catch{}location.href='/';return;}showPlanner();transcript=[];plan=null;state={};threadId=null;stage=null;selectedDetail=null;try{localStorage.removeItem('picnic-thread');}catch{}$('#messages').replaceChildren();$('#welcome').hidden=false;$('#flow-screen').hidden=true;$('.plan-preview').hidden=true;$('.chat-workspace').classList.remove('has-plan');$('#chat-input').value='';renderGuide();syncWorkspace();$('#chat-input').focus();}
$('#start-new-picnic').onclick=()=>{if(busy)return;reset();continuePlanning();};
$('#new-chat').onclick=reset;$('#planner-nav').onclick=()=>{if(busy)return;const token=!$('#saved-view').hidden?savedPlan?.workflow_thread:threadId;if(isPicnicPage||!$('#saved-view').hidden){location.href=token?`/?thread=${token}`:'/';return;}showPlanner();$('#chat-input').focus();};
$('#picnic-nav').onclick=()=>{if(busy)return;const token=$('#saved-view').hidden?threadId:savedPlan?.workflow_thread;location.href=planPage('picnic.html',token);};
$('#saved-count').textContent=readSaved()?'1':'0';
if(globalThis.BBAccount)BBAccount.ready.then(()=>{$('#saved-count').textContent=readSaved()?'1':'0';});
$('#saved-nav').onclick=()=>{if(busy)return;if(isPicnicPage)location.href=savedPage();else showSaved(activeAccountId());};
$('#food-nav').onclick=()=>{
  if(busy)return;
  const token=$('#saved-view').hidden?threadId:savedPlan?.workflow_thread;
  if(!token||($('#saved-view').hidden&&!plan)){toast('Choose a picnic place first, then add your food options.');$('#chat-input').focus();return;}
  location.href=planPage('food.html',token);
};
const nextSaturday=new Date();nextSaturday.setDate(nextSaturday.getDate()+((6-nextSaturday.getDay()+7)%7||7));$('#date').value=localDate(nextSaturday);$('#date').min=localDate(new Date());
$('#travel').oninput=e=>$('#travel-value').textContent=`${e.target.value} miles`;
$('#edit-plan').onclick=()=>{for(const key of ['date','guests','location','budget'])if(state[key])$('#'+key).value=state[key];$('#food-category').value=state.food_category||'Mixed';$('#travel').value=state.distance_miles||30;$('#travel-value').textContent=`${$('#travel').value} miles`;$('#request').value=plan?.request.request||'';document.querySelectorAll('.chips input').forEach(i=>i.checked=(state.dietary_preferences||[]).includes(i.value));$('#error-state').hidden=true;$('#details-dialog').showModal();};
$('#close-details').onclick=()=>$('#details-dialog').close();
$('#picnic-form').onsubmit=async e=>{e.preventDefault();if(busy)return;const food=[...document.querySelectorAll('.chips input:checked')].map(i=>i.value);const text=`Update the picnic to ${$('#guests').value} people near ${$('#location').value}, on ${$('#date').value}, budget $${$('#budget').value}, within ${$('#travel').value} miles. Food category: ${$('#food-category').value}. Dietary preferences: ${food.join(', ')||'none'}. Notes: ${$('#request').value}`;$('#details-dialog').close();await send(text);};
function story(){const venue=plan.venues.find(v=>v.id===plan.selected_venue)||plan.venues[0];frame('Your day at a glance',stage==='food'?'Your place is picked. Choose your food option, then return here for final review.':'Here’s the full plan. Review the details, then share it with your group.',`<div class="story-banner"><span>YOUR NEXT GREAT DAY</span><h3>Fun times at ${esc(venue.name)}</h3><p>${esc(plan.request.date)} · ${plan.request.guests} people · starting from ${esc(plan.request.location)}</p></div><div class="story-grid"><div><h3>A place to gather</h3><p>${esc(venue.features)} · ${venue.distance_miles==null?'Distance not verified':esc(venue.distance_miles)+' miles away'}</p><p><a href="${safeLink(venue.source_url)}" target="_blank" rel="noopener noreferrer">View venue source ↗</a></p><h3>Food for the day</h3>${PicnicUI.foodSummary(plan)}<a class="secondary food-planning-link" href="${esc(planPage('food.html'))}">${stage==='shared'?'View food choice':plan.food_selection?'Change food option':'Plan your food'} ↗</a><p>${esc((plan.food_choices||[]).join(' · ')||'No categories selected')}<br>${esc((plan.food_selection||stage==='shared')?plan.food_source:'Choose shopping or ordering')}</p><p>Food category: ${esc(plan.request.food_category||'Not specified')}<br>Dietary preferences: ${esc((plan.dietary_preferences||[]).join(', ')||'None specified')}</p><ul class="menu">${plan.menu.map(m=>`<li>${esc(m)}</li>`).join('')}</ul><h3>Let the fun begin</h3><ul class="menu">${(plan.activities||[]).map(a=>`<li>${esc(a.name)} — ${esc(a.owner)}</li>`).join('')||'<li>No activities selected.</li>'}</ul></div><div><h3>Cost estimate</h3>${Object.entries(plan.budget).map(([k,v])=>`<div class="budget-row"><span>${esc(k)}</span><span>${money(v)}</span></div>`).join('')}<div class="budget-row total"><span>Total / budget</span><span>${money(plan.total)} / ${money(plan.request.budget)}</span></div><div class="budget-row"><span>Budget remaining</span><span>${money(plan.remaining)}</span></div><h3>Your day at a glance</h3><ul class="menu">${plan.schedule.map(v=>`<li>${esc(v)}</li>`).join('')}</ul></div></div><details class="result-section" open><summary>Shopping, coordination & backup</summary><ul class="menu">${[...plan.shopping_list,...plan.guest_assignments].map(v=>`<li>${esc(v)}</li>`).join('')}</ul><p>${esc(plan.backup_plan)}</p></details><div class="notice">${plan.warnings.map(esc).join('<br>')}</div><span class="status">${plan.status==='approved'?'✓ Approved':plan.status==='needs_revision'?'Budget revision required':plan.food_selection?'Ready for your review':'Choose your food option first'}</span><div class="actions"><button class="primary" id="save" ${!plan.food_selection||plan.status==='needs_revision'?'disabled':''}>${plan.status==='approved'?'Save finalized plan':'Save & finalize'}</button><button class="secondary" id="save-draft">Save draft</button><button class="secondary" id="download">Create a Picnic Invite 🧺</button><button class="primary ${stage==='share'||stage==='shared'?'share-ready':''}" id="share" ${stage!=='share'&&stage!=='shared'?'disabled':''}>${stage==='shared'?'View saved plan ↗':'Share for review ↗'}</button></div><p class="plan-next-step" id="plan-next-step" role="status">${stage==='shared'?'Your plan is shared. Open your saved plan to review the details.':stage==='share'?'✓ Plan finalized. Next: Share for review.':plan.status==='needs_revision'?'Revise the budget before finalizing this plan.':!plan.food_selection?'Choose your food options, then save and finalize.':'Next: Save & finalize to unlock Share for review.'}</p>`,null);$('#save').onclick=finalizeAndSave;$('#save-draft').onclick=async()=>{if(busy)return;setBusy(true);try{if(await persistPlan())toast(plan.status==='approved'?'Finalized plan saved.':'Draft saved. Select Save & finalize when you are ready to share.');}finally{setBusy(false);}};$('#download').onclick=()=>createPicnicInvite(plan,threadId,latestShared);$('#share').onclick=shareForReview;}
async function refreshCrewFeedback(){
  const panel=$('#picnic-crew-feedback');
  const requestedThread=threadId, load=++feedbackLoad;
  if(!isPicnicPage||!plan||!globalThis.BBAccount?.api){panel.hidden=true;return;}
  await BBAccount.ready;
  if(load!==feedbackLoad||requestedThread!==threadId)return;
  if(!BBAccount.state.email){panel.hidden=true;return;}
  panel.hidden=false;
  $('#refresh-picnic-feedback').disabled=true;
  $('#picnic-crew-status').textContent='Checking your crew’s feedback…';
  $('#picnic-crew-summary').innerHTML='';
  $('#manage-picnic-crew').href='account.html';
  try{
    const result=await BBAccount.api(`/api/account/workflows/${encodeURIComponent(requestedThread)}/feedback`);
    if(load!==feedbackLoad||requestedThread!==threadId)return;
    const feedback=PicnicUI.crewFeedback(result.feedback);
    $('#picnic-crew-summary').innerHTML=feedback.summary;
    $('#picnic-crew-status').textContent='A quick look at your crew’s responses. Open My Picnic for comments and guest details.';
    $('#manage-picnic-crew').href=`account.html?plan=${result.id}`;
  }catch(error){
    if(load!==feedbackLoad||requestedThread!==threadId)return;
    $('#picnic-crew-status').textContent=error.status===404?'Save this picnic to My picnics, then invite your crew to see their feedback here.':error.message;
  }finally{if(load===feedbackLoad)$('#refresh-picnic-feedback').disabled=false;}
}
$('#refresh-picnic-feedback').onclick=()=>refreshCrewFeedback();
function promptGuestSignIn(){
  if(!isPicnicPage||globalThis.BBAccount?.state?.email)return;
  try{if(sessionStorage.getItem(`bb-signin-nudge-${threadId}`)==='dismissed')return;}catch{}
  $('#guest-signin-prompt').hidden=false;
}
$('#dismiss-guest-signin').onclick=()=>{
  $('#guest-signin-prompt').hidden=true;
  try{sessionStorage.setItem(`bb-signin-nudge-${threadId}`,'dismissed');}catch{}
};
async function persistPlan(){
  const copy={...plan,workflow_thread:threadId,saved_at:new Date().toISOString()};
  let account=null;
  try{
    if(globalThis.BBAccount)account=await BBAccount.save(threadId);
    if(account){Object.assign(copy,{saved_at:account.saved_at,account_email:account.email,account_plan_id:account.id});refreshCrewFeedback();const picker=await globalThis.BBPlanPicker?.refresh({currentId:account.id,currentThread:threadId});accountPlanCount=picker?.items.length||accountPlanCount;}
  }catch(error){
    if(globalThis.BBAccount?.state.email)copy.account_email=BBAccount.state.email;
    try{localStorage.setItem('gather-plan',JSON.stringify(copy));updateSavedCount();}catch{}
    toast(`${error.message} A browser copy was kept when storage was available.`);
    return false;
  }
  try{
    localStorage.setItem('gather-plan',JSON.stringify(copy));
    updateSavedCount();
    if(!account)promptGuestSignIn();
    return true;
  }catch{toast(account?'Saved to My picnics. Browser storage is unavailable.':'Browser storage is unavailable. Your picnic remains on the server. Retry saving when browser storage is available.');return Boolean(account);}
}
async function finalizeAndSave(){
  if(busy||!plan||!plan.food_selection||plan.status==='needs_revision')return;
  if(plan.status!=='approved'){
    const ok=await action('approve');
    if(!ok||plan.status!=='approved')return;
  }
  let saved;setBusy(true);try{saved=await persistPlan();}finally{setBusy(false);}
  if(stage==='share'||stage==='shared'){
    $('#share').classList.add('share-ready');
    $('#share').focus();
    if(saved)toast('Plan finalized and saved. Share for review is ready.');
  }
}
async function createPicnicInvite(source,reference,shared=null){
  if(busy||!source)return;
  setBusy(true);
  try{await PicnicInvite.open(source,{thread:reference,shared,origin:location.origin,accountPlanId:source.account_plan_id||globalThis.BBPlanPicker?.current()?.id});}
  catch(error){toast(error.message||'Could not prepare your invite. Please try again.');}
  finally{setBusy(false);}
}


function showShare(shared){const url=new URL(shared.path,location.origin).href;$('#share-url').value=url;$('#open-review').href=url;$('#local-share-note').hidden=!['127.0.0.1','localhost','::1','[::1]'].includes(location.hostname);$('#share-status').textContent='';$('#share-dialog').showModal();}
async function shareForReview(){if(busy)return;if(stage==='shared'){location.href=savedPage();return;}await action('share');}
async function restore(){
  if(!threadId)return;
  restoreConversation();setBusy(true);
  try{
    const response=await fetch(`/api/workflows/${threadId}`);
    if(!response.ok)throw Error(response.status===403?'Sign in as the organizer to edit this picnic, or open My picnics for your group view.':'The saved workflow is unavailable. Start a new picnic.');
    const data=await response.json();
    try{localStorage.setItem('picnic-thread',threadId);}catch{}
    if(!data.reply&&!data.plan&&!data.places)data.reply='Your workflow needs a retry. Send a message to continue.';
    const lastReply=[...transcript].reverse().find(item=>item.role==='assistant')?.text;
    resumedWorkflow=true;
    applyResult(data,{openShare:false,announce:data.reply!==lastReply});
  }catch(error){toast(error.message);syncWorkspace();}
  finally{setBusy(false);if(!isPicnicPage&&isSavedRoute())showSaved();}
}
try{
  const explicit=isPicnicPage?location.hash.slice(1):new URLSearchParams(location.search).get('thread');
  threadId=explicit||localStorage.getItem('picnic-thread');
  if(threadId&&!/^[A-Za-z0-9_-]{32}$/.test(threadId))threadId=null;
}catch{}
renderGuide();
if(!isPicnicPage&&isSavedRoute())showSaved();else if(threadId)restore();
$('.skip-link').onclick=event=>{if(isPicnicPage){event.preventDefault();$('#picnic-page-title').focus();}};
$('#close-share').onclick=()=>$('#share-dialog').close();
$('#copy-link').onclick=async()=>{try{await navigator.clipboard.writeText($('#share-url').value);$('#share-status').textContent='Link copied. Paste it into your group chat or email.';}catch{$('#share-url').focus();$('#share-url').select();$('#share-status').textContent='Select and copy the link above.';}};



function showPlanner(){
  if(isSavedRoute())history.replaceState(null,'',location.pathname+location.search);
  $('#saved-view').hidden=true;$('.chat-workspace').hidden=false;syncWorkspace();
  for(const key of ['planner','picnic','saved']){
    const current=key===(isPicnicPage?'picnic':'planner');
    $('#'+key+'-nav').classList.toggle('active',current);
    if(current)$('#'+key+'-nav').setAttribute('aria-current','page');else $('#'+key+'-nav').removeAttribute('aria-current');
  }
  $('.skip-link').href=isPicnicPage?'#picnic-page-title':'#chat-input';
  $('.skip-link').textContent=isPicnicPage?'Skip to your picnic':'Skip to picnic planner';
}

function renderGuide(){
  const complete=PicnicUI.fields.filter(field=>PicnicUI.hasValue(state,field.key)).length;
  $('#details-count').textContent=`${complete} of 6 collected`;
  $('#detail-progress').value=complete;
  $('.chat-main').classList.toggle('has-conversation',Boolean(threadId));
  $('#continue-details').textContent=stage==='shared'?'All set ✓':complete<6?'Continue →':stage==='places'?'Choose your place →':plan?'Open Your picnic →':'Continue in chat →';
  $('#detail-steps').innerHTML=PicnicUI.steps(state,selectedDetail);
  const next=PicnicUI.nextMissing(state);
  $('#details-next').textContent=stage==='shared'?'This plan has been shared. Start a new picnic to plan another day.':next?`Next: ${next.question}`:stage==='places'?'Details collected. Choose a picnic place to continue.':plan?'Details collected. Review your plan, save & finalize, then share.':'Details collected. Continue in the chat to find your place.';
  document.querySelectorAll('[data-detail]').forEach(button=>button.onclick=()=>{
    selectedDetail=button.dataset.detail;
    renderGuide();
    $('#detail-value').focus();
  });
  const field=PicnicUI.fields.find(item=>item.key===selectedDetail);
  $('#detail-step-form').hidden=!field;
  if(field){
    const value=state[field.key]??'';
    const input=field.type==='select'
      ? `<select id="detail-value" required><option value="">Choose a food category</option>${field.options.map(option=>`<option ${value===option?'selected':''}>${option}</option>`).join('')}</select>`
      : `<input id="detail-value" type="${field.type}" value="${esc(value)}" required ${field.min!==undefined?`min="${field.min}" max="${field.max}" step="${field.step}"`:''} ${field.type==='date'?`min="${localDate(new Date())}"`:''} ${field.maxlength?`maxlength="${field.maxlength}"`:''} ${field.placeholder?`placeholder="${field.placeholder}"`:''}>`;
    $('#detail-step-field').innerHTML=`<label for="detail-value">${field.question}</label>${input}`;
    $('#detail-step-save').textContent=PicnicUI.hasValue(state,field.key)?'Update detail →':'Save and continue →';
  }
  document.querySelectorAll('#details-guide button, #details-guide input, #details-guide select').forEach(el=>el.disabled=busy||stage==='shared');
}
$('#detail-step-close').onclick=()=>{const previous=selectedDetail;selectedDetail=null;renderGuide();document.querySelector(`[data-detail="${previous}"]`)?.focus();};
$('#detail-step-form').onsubmit=async event=>{
  event.preventDefault();
  if(busy)return;
  const field=PicnicUI.fields.find(item=>item.key===selectedDetail);
  const input=$('#detail-value');
  if(!field||!input.reportValidity())return;
  const value=input.value.trim();
  if(!value){input.setCustomValidity('Please enter a value.');input.reportValidity();input.oninput=()=>input.setCustomValidity('');return;}
  const ok=await send(field.message(value));
  if(ok){selectedDetail=PicnicUI.nextMissing(state)?.key||null;renderGuide();if(selectedDetail)$('#detail-value').focus();}
};

async function showSaved(id=null){
  if(busy)return;
  if(globalThis.BBAccount)await BBAccount.ready;
  let selected=id||new URLSearchParams(location.search).get('plan');
  const local=readSaved();
  if(!selected&&globalThis.BBAccount?.state.email){
    selected=globalThis.BBPlanPicker?.current()?.id||local?.account_plan_id||globalThis.BBPlanPicker?.remembered()?.id;
    if(!selected){try{selected=(await globalThis.BBPlanPicker?.list())?.[0]?.id;}catch(error){return toast(error.message);}}
  }
  setBusy(true);
  try{
    if(validPlanId(selected)){
      if(!globalThis.BBAccount?.state.email){location.href=`login.html?plan=${selected}`;return;}
      const result=await BBAccount.api(`/api/account/plans/${selected}`);
      if(result.role!=='organizer'){location.href=`account.html?plan=${selected}`;return;}
      savedPlan={...result.plan,workflow_thread:result.thread_id,account_plan_id:selected,account_email:BBAccount.state.email,saved_at:result.saved_at};
      history.replaceState(null,'',`/?plan=${selected}#saved`);
    }else{savedPlan=local;history.replaceState(null,'','/#saved');}
    if(!savedPlan)return toast('Create and save a picnic plan first.');
    await pickerReady;
    globalThis.BBPlanPicker?.setCurrent({id:savedPlan.account_plan_id,thread:savedPlan.workflow_thread});
    $('#saved-copy-note').textContent=savedPlan.account_plan_id?'This is the selected plan’s saved account snapshot. Open Your picnic to continue editing. Save again to update this snapshot.':'This is your browser’s saved copy. Sign in to keep it across devices.';
  }catch(error){toast(error.message);return;}
  finally{setBusy(false);}
  const sections=PicnicUI.savedSections(savedPlan);
  const signedIn=Boolean(globalThis.BBAccount?.state?.email);
  $('#saved-account-link').href=signedIn?`account.html${savedPlan.account_plan_id?'?plan='+savedPlan.account_plan_id:''}`:'login.html';
  $('#saved-account-link').textContent=signedIn?'Open My Picnic & invite your crew ↗':'Sign in to keep this picnic & invite your crew ↗';
  $('#saved-description').textContent=`${savedPlan.request.guests} guests · ${savedPlan.request.location} · ${savedPlan.request.date}`;
  const savedAt=new Date(savedPlan.saved_at||'');
  $('#saved-as-of').textContent=Number.isNaN(savedAt.getTime())
    ? 'Saved as of: unavailable for this older save.'
    : `Saved as of: ${new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(savedAt)}`;
  $('#saved-sections-nav').innerHTML=sections.map(section=>`<a href="#saved-${section.id}">${section.title}</a>`).join('');
  $('#saved-sections').innerHTML=sections.map(section=>`<section class="panel saved-section" id="saved-${section.id}" aria-labelledby="saved-${section.id}-title"><h2 id="saved-${section.id}-title">${section.title}</h2>${section.body}</section>`).join('');
  $('#resume-saved').disabled=!/^[A-Za-z0-9_-]{32}$/.test(savedPlan.workflow_thread||'');
  $('#resume-context').hidden=true;
  $('#saved-view').hidden=false;
  $('#workspace-page-label').textContent='Saved plan';
  $('#planner-hero').hidden=true;
  $('#details-guide').hidden=true;
  $('.chat-workspace').hidden=true;
  $('#picnic-page-heading').hidden=true;$('#picnic-empty').hidden=true;
  $('#picnic-nav').classList.remove('active');$('#picnic-nav').removeAttribute('aria-current');
  $('#planner-nav').classList.remove('active');
  $('#planner-nav').removeAttribute('aria-current');
  $('#saved-nav').classList.add('active');
  $('#saved-nav').setAttribute('aria-current','page');
  $('.skip-link').href='#saved-title';
  $('#saved-title').focus();
}
$('#resume-saved').onclick=()=>{
  if(busy||!savedPlan?.workflow_thread)return;
  try{localStorage.setItem('picnic-thread',savedPlan.workflow_thread);}catch{}
  location.href=planPage('picnic.html',savedPlan.workflow_thread,savedPlan.account_plan_id);
};
$('#export-saved').onclick=()=>{if(savedPlan)createPicnicInvite(savedPlan,savedPlan.workflow_thread);};
if(!isSavedRoute())showPlanner();
pickerReady=setupPlanPicker();


function continuePlanning(){
  if(busy)return;
  const next=PicnicUI.nextMissing(state);
  if(next&&stage!=='shared'){
    selectedDetail=next.key;
    renderGuide();
    $('#detail-value').focus({preventScroll:true});
    $('#details-guide').scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }else if(threadId&&(plan||stage==='places')){
    location.href=planPage('picnic.html');
  }else{$('#chat-input').focus();}
}
$('#start-details').onclick=continuePlanning;
$('#continue-details').onclick=continuePlanning;
$('#hero-chat-link').onclick=event=>{event.preventDefault();$('#chat-input').focus();};
document.querySelectorAll('[data-idea]').forEach(button=>button.onclick=()=>{
  $('#chat-input').value=`${button.dataset.idea} `;
  $('#chat-input').focus();
});
