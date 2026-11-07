(() => {
  const $=selector=>document.querySelector(selector);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api=BBAccount.api;
  let current=null, plans=[], busy=false, canRespond=false, inviteSource=null;
  const requested=new URLSearchParams(location.search).get('plan');
  function switchingBlocked(){return busy?'Please wait for this step to finish.':$('#guest-emails').value.trim()||$('#crew-comment').value.trim()?'Send or clear your current invitation or feedback before switching picnics.':false;}
  const stamp=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'Date unavailable':new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(date);};
  function setBusy(value){busy=value;document.querySelectorAll('#account-list button,#invite-form button,#account-members button,#account-feedback-form button,#refresh-crew-feedback,#account-create-invite').forEach(button=>button.disabled=value);}
  function renderList(){
    $('#account-list').innerHTML=plans.length?plans.map(plan=>`<button type="button" class="account-plan-card ${plan.id===current?'selected':''}" data-plan="${esc(plan.id)}" aria-pressed="${plan.id===current}"><span class="eyebrow">${plan.role==='organizer'?'YOUR PICNIC':'WITH YOUR CREW'}</span><strong>${esc(plan.venue)}</strong><span>${esc(plan.date)} · ${esc(plan.guests)} guests</span><small>Saved as of ${esc(stamp(plan.saved_at))}</small><span class="account-card-arrow" aria-hidden="true">↗</span></button>`).join(''):'<div class="account-panel"><h2>A good day starts with a little idea.</h2><p>No account plans yet. Create a picnic and save it while signed in, or open a group invitation from your email.</p><a class="secondary" href="/">Let’s plan a picnic ↗</a></div>';
    document.querySelectorAll('[data-plan]').forEach(button=>button.onclick=()=>{if(button.dataset.plan!==current){const reason=switchingBlocked();if(reason){$('#account-status').textContent=reason;return;}}if(!busy)loadDetail(button.dataset.plan);});
  }
  async function loadDetail(id){
    setBusy(true);inviteSource=null;$('#account-status').textContent='Opening your picnic…';
    const changing=current!==id;$('#account-detail').hidden=true;
    if(changing){$('#invite-status').textContent='';$('#invite-previews').hidden=true;$('#invite-previews').innerHTML='';$('#crew-feedback-status').textContent='';}
    try {
      const result=await api(`/api/account/plans/${encodeURIComponent(id)}`);
      canRespond=result.role==='guest';
      $('#account-feedback-form').hidden=!canRespond;
      $('#crew-feedback-title').textContent=canRespond?'What does the crew think?':'Your crew’s feedback 🌿';
      $('#crew-feedback-description').textContent=canRespond?'Share your thoughts with the picnic crew. Everyone with verified access can see the responses.':'Read the latest response from each guest. Refresh to check for new feedback.';
      current=id;history.replaceState(null,'',`account.html?plan=${id}`);globalThis.BBPlanPicker?.setCurrent({id});
      $('#account-role').textContent=result.role==='organizer'?'You’re the organizer':'Your crew’s saved plan · View & comment';
      $('#account-plan-title').textContent=result.venue;
      $('#account-saved-at').textContent=`Saved as of: ${stamp(result.saved_at)}`;
      $('#edit-account-plan').hidden=result.role!=='organizer';
      $('#account-create-invite').hidden=result.role!=='organizer';
      if(result.role==='organizer')inviteSource={plan:result.plan,thread:result.thread_id,id};
      if(result.thread_id)$('#edit-account-plan').href=`picnic.html?plan=${id}#${result.thread_id}`;
      $('#account-sections').innerHTML=PicnicUI.savedSections(result.plan).map(section=>`<section class="panel saved-section"><h2>${section.title}</h2>${section.body}</section>`).join('');
      $('#invite-panel').hidden=result.role!=='organizer';
      $('#account-members').innerHTML=result.members?.length?result.members.map(member=>`<div class="account-member"><div><strong>${esc(member.email)}</strong><small>${member.accepted_at?'Joined the crew':'Invitation pending'}</small></div><button type="button" class="secondary" data-remove="${esc(member.email)}">Remove access</button></div>`).join(''):'<p>No guests invited yet. Add their emails above.</p>';
      document.querySelectorAll('[data-remove]').forEach(button=>button.onclick=async()=>{
        if(busy)return;setBusy(true);
        try{await api(`/api/account/plans/${current}/members/${encodeURIComponent(button.dataset.remove)}`,{method:'DELETE'});await loadDetail(current);}
        catch(error){$('#invite-status').textContent=error.message;}
        finally{setBusy(false);}
      });
      const feedback=PicnicUI.crewFeedback(result.feedback.filter(item=>canRespond||item.email!==BBAccount.state.email));
      $('#crew-feedback-summary').innerHTML=feedback.summary;
      $('#crew-responses').innerHTML=feedback.body;
      $('#account-detail').hidden=false;$('#account-status').textContent='';renderList();return true;
    }catch(error){$('#account-status').textContent=error.message;$('#account-detail').hidden=true;if(error.status===401)location.href=`login.html?plan=${encodeURIComponent(id)}`;return false;}
    finally{setBusy(false);}
  }
  $('#account-create-invite').onclick=async()=>{
    if(busy||!inviteSource)return;setBusy(true);
    try{await PicnicInvite.open(inviteSource.plan,{thread:inviteSource.thread,origin:location.origin,accountPlanId:inviteSource.id});}
    catch(error){$('#account-status').textContent=error.message;}
    finally{setBusy(false);}
  };
  $('#sign-out').onclick=async()=>{
    $('#sign-out').disabled=true;
    try{await BBAccount.logout();}catch(error){$('#account-status').textContent=error.message;$('#sign-out').disabled=false;}
  };
  $('#invite-form').onsubmit=async event=>{
    event.preventDefault();if(busy||!current)return;
    const emails=[...new Set($('#guest-emails').value.split(/[\s,;]+/).map(value=>value.trim()).filter(Boolean))];
    if(!emails.length||emails.length>25){$('#invite-status').textContent='Add between 1 and 25 email addresses. You can send another batch afterward.';return;}
    setBusy(true);$('#invite-status').textContent='Getting your invitations ready…';$('#invite-previews').hidden=true;
    try{
      const result=await api(`/api/account/plans/${current}/invitations`,{method:'POST',body:JSON.stringify({emails})});
      $('#invite-status').textContent=`${result.delivered.length} invitation${result.delivered.length===1?'':'s'} ${result.previews.length?'prepared in local preview':'sent'}.${result.failed.length?' Please retry: '+result.failed.map(item=>`${item.email} — ${item.message}`).join('; '):''}`;
      if(result.previews.length){
        $('#invite-previews').innerHTML='<strong>Local invitation previews · No email was sent.</strong><p>Use a separate browser profile to preview a guest. Each link signs in as that recipient.</p>'+result.previews.map(item=>`<a href="${esc(item.preview_url)}" target="_blank" rel="noopener noreferrer">Open invitation for ${esc(item.email)} ↗</a>`).join('');
        $('#invite-previews').hidden=false;
      }
      if(!result.failed.length)$('#guest-emails').value='';
      await loadDetail(current);
    }catch(error){$('#invite-status').textContent=error.message;}
    finally{setBusy(false);}
  };
  $('#refresh-crew-feedback').onclick=()=>{if(!busy&&current)return loadDetail(current);};
  $('#account-feedback-form').onsubmit=async event=>{
    event.preventDefault();if(busy||!current||!canRespond)return;setBusy(true);
    try{await api(`/api/account/plans/${current}/feedback`,{method:'POST',body:JSON.stringify({response:$('#crew-response').value,comment:$('#crew-comment').value})});$('#crew-comment').value='';await loadDetail(current);$('#crew-feedback-status').textContent='Your thoughts are shared with the crew.';}
    catch(error){$('#crew-feedback-status').textContent=error.message;}
    finally{setBusy(false);}
  };
  $('#import-plan').onclick=async()=>{
    $('#import-plan').disabled=true;
    try{
      const local=JSON.parse(localStorage.getItem('gather-plan'));
      const result=await BBAccount.save(local.workflow_thread);
      if(!result)throw Error('Sign in to save this plan.');
      localStorage.setItem('gather-plan',JSON.stringify({...local,account_email:result.email,account_plan_id:result.id,saved_at:result.saved_at}));
      location.href=`account.html?plan=${result.id}`;
    }catch(error){$('#import-status').textContent=error.message;$('#import-plan').disabled=false;}
  };
  async function start(){
    await BBAccount.ready;
    if(!BBAccount.state.email){location.href='login.html'+(/^[A-Za-z0-9_-]{32}$/.test(requested||'')?`?plan=${requested}`:'');return;}
    $('#signed-in-email').textContent=`Signed in as ${BBAccount.state.email}`;
    try{
      plans=(await api('/api/account/plans')).plans;renderList();
      await globalThis.BBPlanPicker?.init({plans,currentId:requested,beforeSelect:switchingBlocked,onSelect:async item=>{if(!await loadDetail(item.id))throw Error('Could not open the selected picnic. Please retry.');}});
      try{const local=JSON.parse(localStorage.getItem('gather-plan'));$('#import-browser-plan').hidden=!/^[A-Za-z0-9_-]{32}$/.test(local?.workflow_thread||'')||plans.some(item=>item.id===local.account_plan_id);}catch{}
      if(/^[A-Za-z0-9_-]{32}$/.test(requested||''))await loadDetail(requested);
      else if(plans.some(item=>item.id===globalThis.BBPlanPicker?.remembered()?.id))await loadDetail(BBPlanPicker.remembered().id);
      else if(plans.length===1)await loadDetail(plans[0].id);
    }catch(error){$('#account-status').textContent=error.message;}
  }
  start();
})();
