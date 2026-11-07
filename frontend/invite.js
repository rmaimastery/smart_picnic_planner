(() => {
  const $=selector=>document.querySelector(selector);
  const form=$('#invite-form'),canvas=$('#invite-canvas'),status=$('#invite-status');
  let draft=null,image=null,png=null,version=0,reviewUrl=null,qrNote='';
  const ids=['title','message','date','time','venue','food'];
  const field=id=>$('#invite-'+(id==='title'?'title-field':id));
  function data(){return Object.fromEntries(ids.map(id=>[id,field(id).value.trim()]));}
  function updateReviewOption(){
    const allowed=PicnicInvite.reviewForFields(draft,data(),location.origin);
    $('#invite-qr').disabled=!allowed;
    if(!allowed)$('#invite-qr').checked=false;
    $('#invite-qr-note').textContent=reviewUrl&&!allowed?'The date, location or food highlights changed. Use matching details or publish an updated review snapshot before adding its QR code.':qrNote;
    return allowed;
  }
  function activeReview(){return $('#invite-qr').checked?PicnicInvite.reviewForFields(draft,data(),location.origin):null;}
  function file(){return new File([png],`blanket-and-bites-picnic-invite-${data().date||'picnic'}.png`,{type:'image/png'});}
  function shareable(){try{return png&&typeof File==='function'&&navigator.canShare?.({files:[file()]});}catch{return false;}}
  function controls(ready){
    $('#download-invite').disabled=!ready;
    $('#copy-invite-caption').disabled=!ready;
    $('#share-invite').hidden=!shareable();$('#share-invite').disabled=!ready;
  }
  async function render(){
    const current=++version;png=null;controls(false);
    try{
      updateReviewOption();
      draft.fields=data();draft.include_review=Boolean(activeReview());
      try{PicnicInvite.storeDraft(draft);}catch{}
      PicnicInviteCanvas.draw(canvas,data(),{image,reviewUrl:activeReview()});
      $('#invite-caption').value=PicnicInvite.caption(data(),activeReview());
      const output=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(current!==version)return;
      if(!output)throw Error('Could not create the PNG. Please try updating the preview.');
      png=output;controls(form.checkValidity());
      status.textContent=form.checkValidity()?'Your invite is ready. Review the image, then download it for WhatsApp.':'Add a title, date and picnic location to finish your invite.';
    }catch(error){if(current===version)status.textContent=error.message;}
  }
  async function start(){
    const requested=new URLSearchParams(location.search).get('plan');
    await globalThis.BBAccount?.ready;
    try{
      if(/^[A-Za-z0-9_-]{32}$/.test(requested||'')){
        const result=await BBAccount.api(`/api/account/plans/${requested}`);
        if(result.role!=='organizer')throw Error('Open My Picnic to view this invitation as a guest.');
        const active=JSON.parse(sessionStorage.getItem(PicnicInvite.key)||'null');
        draft=new URLSearchParams(location.search).get('draft')==='1'&&PicnicInvite.draftThread(active)===result.thread_id?active:await PicnicInvite.resume(result.plan,{thread:result.thread_id,origin:location.origin});
      }else{try{draft=JSON.parse(sessionStorage.getItem(PicnicInvite.key));}catch{}}
    }catch(error){status.textContent=error.message;draft=null;}
    await globalThis.BBPlanPicker?.init({currentThread:PicnicInvite.draftThread(draft),onSelect:async item=>{
      const result=await BBAccount.api(`/api/account/plans/${item.id}`);
      if(result.role!=='organizer')throw Error('Only the organizer can create an invite for this picnic.');
      await PicnicInvite.open(result.plan,{thread:result.thread_id,origin:location.origin,accountPlanId:item.id});
    }});
    if(!draft?.fields){$('#invite-empty').hidden=false;$('#invite-editor').hidden=true;return;}
    draft.base_fields??={date:draft.fields.date,venue:draft.fields.venue,food:draft.fields.food};
    const limits={title:60,message:180,date:10,time:5,venue:120,food:120};
    for(const id of ids)field(id).value=PicnicInvite.clean(draft.fields[id],limits[id]);
    if(/^picnic\.html#[A-Za-z0-9_-]{32}$/.test(draft.back_path||''))$('#invite-back').href=draft.back_path;
    const selected=globalThis.BBPlanPicker?.current();if(selected)$('#invite-back').href=`picnic.html?plan=${selected.id}#${selected.thread_id}`;
    const publicLink=PicnicInvite.publicReview(draft.review?.url,location.origin);
    reviewUrl=draft.review?.status==='ready'&&publicLink&&!PicnicInvite.loopback(location.origin)?publicLink.href:null;
    $('#invite-qr').disabled=!reviewUrl;
    const messages={
      ready:'Optional: anyone with your flyer can scan the QR code to open the public review snapshot.',
      local:'A localhost link won’t open on your guests’ devices. Host B&B at a reachable address to add a review QR code. You can still download this invite.',
      'different-version':'This saved version differs from the public review snapshot. You can create the invite without a QR code, or return to the latest picnic.',
      unavailable:'The matching review link could not be verified. You can create your invite without a QR code.',
      unshared:'To add a QR code, first finalize the picnic and create a public link using Share for review. No public link is created automatically.',
    };
    qrNote=reviewUrl?messages.ready:(messages[draft.review?.status]||messages.unshared);
    $('#invite-qr').checked=Boolean(draft.include_review&&reviewUrl);
    $('#invite-editor').hidden=false;$('#invite-empty').hidden=true;
    form.onsubmit=event=>{event.preventDefault();render();};
    document.querySelectorAll('#invite-form input,#invite-form textarea').forEach(input=>input.oninput=render);
    $('#invite-qr').onchange=render;
    status.textContent='Getting the picnic artwork ready…';
    try{await document.fonts?.ready;}catch{}
    image=await new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>resolve(null);img.src='images/picnic-hero.jpg';});
    await render();
  }
  $('#download-invite').onclick=()=>{
    if(!png||!form.reportValidity())return;
    const url=URL.createObjectURL(png),link=document.createElement('a');
    link.href=url;link.download=`blanket-and-bites-picnic-invite-${data().date}.png`;document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    status.textContent='Download started. Attach the PNG in your WhatsApp group, then paste the caption if you like.';
  };
  $('#copy-invite-caption').onclick=async()=>{
    if(!form.reportValidity())return;
    try{await navigator.clipboard.writeText($('#invite-caption').value);status.textContent='Caption copied. Paste it alongside your invite in WhatsApp.';}
    catch{$('#invite-caption-details').open=true;$('#invite-caption').focus();$('#invite-caption').select();status.textContent='Select and copy the caption below.';}
  };
  $('#share-invite').onclick=async()=>{
    if(!png||!form.reportValidity()||!shareable())return;
    try{await navigator.share({files:[file()],title:data().title,text:$('#invite-caption').value});status.textContent='Invite handed to your device’s share menu.';}
    catch(error){status.textContent=error.name==='AbortError'?'Sharing cancelled. Your invite is still ready.':'Sharing is unavailable here. Download the PNG and attach it in WhatsApp.';}
  };
  start();
})();
