/* Invitation drafts intentionally contain only the public details drawn on the flyer. */
const PicnicInvite = (() => {
  const key='bb-picnic-invite';
  const clean=(value,max)=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,max);
  function fields(plan){
    const venue=plan.venues?.find(item=>item.id===plan.selected_venue)||plan.venues?.[0];
    return {
      title:'You’re invited to a picnic!',
      message:'Less scrolling, more strolling—family, friends, tasty bites, and a little magic from nature!',
      date:/^\d{4}-\d{2}-\d{2}$/.test(plan.request?.date||'')?plan.request.date:'',
      time:'',
      venue:clean(venue?.name||'Picnic location to be confirmed',120),
      food:clean((plan.menu||[]).slice(0,2).join(' · '),120),
    };
  }
  function snapshotKey(plan){
    const venue=plan.venues?.find(item=>item.id===plan.selected_venue)||plan.venues?.[0];
    const choices={...plan.food_selections};if(plan.food_selection)choices[plan.food_selection.mode]??=plan.food_selection;
    return JSON.stringify({date:plan.request?.date,guests:plan.request?.guests,budget:plan.request?.budget,
      venue:venue?.name,selected:plan.selected_venue,menu:plan.menu,food:plan.food_source,
      choices:['shop','order'].map(mode=>[choices[mode]?.business?.name,choices[mode]?.business?.source_url])});
  }
  function publicReview(value,origin){
    try{
      const url=new URL(value,origin);
      if(url.origin!==new URL(origin).origin||url.pathname!=='/review.html'||url.search||url.username||url.password||!/^#[A-Za-z0-9_-]{32}$/.test(url.hash))return null;
      return url;
    }catch{return null;}
  }
  function loopback(origin){
    try{const host=new URL(origin).hostname.toLowerCase();return ['localhost','::1','[::1]'].includes(host)||host.endsWith('.localhost')||/^127\./.test(host);}catch{return true;}
  }
  async function timedFetch(url,options){
    if(typeof AbortController!=='function')return globalThis.fetch(url,options);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{return await globalThis.fetch(url,{...options,signal:controller.signal});}finally{clearTimeout(timer);}
  }
  async function prepare(plan,{thread=null,shared=null,origin,fetcher=timedFetch}={}){
    const validThread=/^[A-Za-z0-9_-]{32}$/.test(thread||'');
    const draft={fields:fields(plan),review:{url:null,status:'unshared'},back_path:validThread?`picnic.html#${thread}`:'/#saved'};
    draft.base_fields={date:draft.fields.date,venue:draft.fields.venue,food:draft.fields.food};
    try{
      let candidate=shared;
      if(!candidate&&validThread){
        const response=await fetcher(`/api/workflows/${encodeURIComponent(thread)}`,{cache:'no-store'});
        if(response.ok)candidate=(await response.json()).shared;
      }
      if(!candidate)return draft;
      const url=publicReview(candidate.path,origin);
      if(!url){draft.review.status='unavailable';return draft;}
      const response=await fetcher(`/api/shares/${encodeURIComponent(url.hash.slice(1))}`,{cache:'no-store'});
      if(!response.ok){draft.review.status='unavailable';return draft;}
      const snapshot=(await response.json()).plan;
      if(!snapshot||snapshotKey(snapshot)!==snapshotKey(plan)){draft.review.status='different-version';return draft;}
      if(loopback(origin)){draft.review.status='local';return draft;}
      draft.review={url:url.href,status:'ready'};
    }catch{draft.review.status='unavailable';}
    return draft;
  }
  function reviewForFields(draft,edited,origin){
    if(draft.review?.status!=='ready'||loopback(origin))return null;
    const baseline=draft.base_fields||draft.fields;
    if(['date','venue','food'].some(key=>edited[key]!==baseline[key]))return null;
    return publicReview(draft.review.url,origin)?.href||null;
  }
  function dateLabel(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return 'Date to be confirmed';
    const date=new Date(value+'T12:00:00');
    if(Number.isNaN(date.getTime())||date.getFullYear()!==Number(value.slice(0,4))||date.getMonth()+1!==Number(value.slice(5,7))||date.getDate()!==Number(value.slice(8,10)))return 'Date to be confirmed';
    return new Intl.DateTimeFormat(undefined,{weekday:'short',month:'long',day:'numeric',year:'numeric'}).format(date);
  }
  function timeLabel(value){
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))return 'Time to be confirmed';
    const [hour,minute]=value.split(':').map(Number);
    return new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date(2000,0,1,hour,minute));
  }
  function caption(data,reviewUrl=null){
    return [data.title,data.message,`When: ${dateLabel(data.date)} · ${timeLabel(data.time)}`,`Where: ${data.venue}`,
      data.food?`Food highlights: ${data.food}`:'',reviewUrl?`Review the picnic: ${reviewUrl}`:'','Blanket & Bites · LOVE LIFE ♥'].filter(Boolean).join('\n\n');
  }
  function draftThread(draft){return /^picnic\.html#[A-Za-z0-9_-]{32}$/.test(draft?.back_path||'')?draft.back_path.split('#')[1]:null;}
  function storeDraft(draft){
    sessionStorage.setItem(key,JSON.stringify(draft));
    const thread=draftThread(draft);if(thread)sessionStorage.setItem(`${key}-${thread}`,JSON.stringify(draft));
  }
  async function resume(plan,options){
    const fresh=await prepare(plan,options);
    let previous=null;
    try{previous=JSON.parse(sessionStorage.getItem(`${key}-${options?.thread}`));}catch{}
    if(previous?.fields&&JSON.stringify(previous.base_fields)===JSON.stringify(fresh.base_fields)){
      fresh.fields={...fresh.fields,...Object.fromEntries(['title','message','date','time','venue','food'].map(name=>[name,clean(previous.fields[name],name==='message'?180:120)]))};
      fresh.include_review=previous.include_review;
    }
    return fresh;
  }
  async function open(plan,options){
    const draft=await resume(plan,options);
    try{storeDraft(draft);}catch{throw Error('Your browser cannot keep the invite draft. Allow session storage and try again.');}
    location.href='invite.html'+(/^[A-Za-z0-9_-]{32}$/.test(options?.accountPlanId||'')?'?plan='+options.accountPlanId+'&draft=1':'');
  }
  return {key,clean,fields,snapshotKey,publicReview,loopback,prepare,reviewForFields,dateLabel,timeLabel,caption,draftThread,storeDraft,resume,open};
})();
