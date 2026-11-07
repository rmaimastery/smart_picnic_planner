/* Shared organizer-only selection. URLs identify the page's plan, not a global browser copy. */
(() => {
  const $=selector=>document.querySelector(selector);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const valid=value=>/^[A-Za-z0-9_-]{32}$/.test(value||'');
  let cached=null,mounted=null,loadVersion=0;
  function remembered(){
    try{const item=JSON.parse(sessionStorage.getItem('bb-active-plan'));return item?.email===BBAccount.state.email&&valid(item.id)?item:null;}catch{return null;}
  }
  function stamp(value){const date=new Date(value);return Number.isNaN(date.getTime())?'date unavailable':new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(date);}
  function label(plan){return `${plan.venue} · ${plan.date} · ${plan.guests} guests · saved ${stamp(plan.saved_at)}`;}
  async function list(fresh=false){
    await BBAccount.ready;
    if(!BBAccount.state.email)return [];
    if(fresh)cached=null;
    if(!cached)cached=BBAccount.api('/api/account/plans').then(result=>result.plans.filter(item=>item.role==='organizer'&&valid(item.id)&&valid(item.thread_id))).catch(error=>{cached=null;throw error;});
    return cached;
  }
  function updateLinks(plan){
    const destinations={'.nav-planner':plan?`/?thread=${plan.thread_id}`:'/', '.nav-picnic':plan?`picnic.html?plan=${plan.id}#${plan.thread_id}`:'picnic.html', '.nav-food':plan?`food.html?plan=${plan.id}#${plan.thread_id}`:'food.html', '.nav-saved':plan?`/?plan=${plan.id}#saved`:'/#saved', '[data-account-link]':plan?`account.html?plan=${plan.id}`:(globalThis.BBAccount?.state.email?'account.html':'login.html')};
    for(const [selector,href] of Object.entries(destinations))document.querySelectorAll('a'+selector).forEach(link=>link.href=href);
  }
  function remember(plan){
    if(!plan||!valid(plan.id)||!valid(plan.thread_id))return;
    try{sessionStorage.setItem('bb-active-plan',JSON.stringify({id:plan.id,thread_id:plan.thread_id,email:BBAccount.state.email}));}catch{}
    updateLinks(plan);
  }
  function current(){return mounted?.items.find(item=>item.id===mounted.currentId)||null;}
  function setCurrent({id=null,thread=null}={}){
    if(!mounted)return;
    const item=mounted.items.find(item=>item.id===id)||mounted.items.find(item=>item.thread_id===thread);
    mounted.currentId=item?.id||null;
    mounted.config.currentId=id;mounted.config.currentThread=thread;
    $('#organizer-plan').value=item?.id||'';
    $('#plan-picker-description').textContent=item?`${item.status==='approved'?'Finalized picnic':'Saved draft'} · Saved as of ${stamp(item.saved_at)}`:mounted.config.placeholder||'Choose a saved picnic. Your current draft is separate.';
    if(item)remember(item);else updateLinks(null);
  }
  function setBusy(value){if(mounted){$('#organizer-plan').disabled=value;$('#refresh-plan-list').disabled=value;}}
  async function init(config={}){
    const shell=$('#plan-picker-section');if(!shell||!globalThis.BBAccount)return null;
    $('#refresh-plan-list').onclick=()=>mounted?refresh():init(config);
    const version=++loadVersion;
    try{
      const items=config.plans?config.plans.filter(item=>item.role==='organizer'&&valid(item.id)&&valid(item.thread_id)):await list();
      if(version!==loadVersion)return null;
      mounted={items,config,currentId:null};
      shell.hidden=!items.length;
      $('#organizer-plan').innerHTML='<option value="">'+esc(config.placeholder||'Choose a saved picnic…')+'</option>'+items.map(item=>`<option value="${esc(item.id)}">${esc(label(item))}</option>`).join('');
      setCurrent({id:config.currentId,thread:config.currentThread});
      $('#plan-picker-status').textContent='';
      $('#organizer-plan').onchange=async event=>{
        const previous=mounted.currentId,selected=mounted.items.find(item=>item.id===event.target.value);
        if(!selected||selected.id===previous){$('#organizer-plan').value=previous||'';return;}
        const blocked=config.beforeSelect?.(selected);
        if(blocked){$('#organizer-plan').value=previous||'';$('#plan-picker-status').textContent=typeof blocked==='string'?blocked:'Finish your current step before switching plans.';return;}
        setBusy(true);$('#plan-picker-status').textContent='Opening the selected picnic…';
        try{await config.onSelect(selected);setCurrent({id:selected.id});$('#plan-picker-status').textContent='';}
        catch(error){$('#organizer-plan').value=previous||'';$('#plan-picker-status').textContent=error.message||'Could not open this picnic. Please retry.';}
        finally{setBusy(false);}
      };
      setBusy(false);
      return mounted;
    }catch(error){if(version===loadVersion){shell.hidden=false;$('#organizer-plan').disabled=true;$('#plan-picker-status').textContent=error.message;}return null;}
  }
  async function refresh(selection={}){cached=null;if(!mounted)return null;const config={...mounted.config,...selection};delete config.plans;return init(config);}
  function clear(){try{sessionStorage.removeItem('bb-active-plan');}catch{}if(mounted)setCurrent();}
  globalThis.BBPlanPicker={init,list,current,setCurrent,remember,remembered,refresh,clear,label};
})();
