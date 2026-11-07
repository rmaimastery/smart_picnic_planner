(() => {
  const $ = selector => document.querySelector(selector);
  const api = BBAccount.api;
  globalThis.addEventListener?.('hashchange',()=>{if(location.hash)location.reload();});
  let token = location.hash.slice(1);
  if (token) history.replaceState(null, '', location.pathname + location.search);
  const plan = new URLSearchParams(location.search).get('plan');
  const destination = /^[A-Za-z0-9_-]{32}$/.test(plan || '') ? `account.html?plan=${plan}` : 'account.html';
  const status = $('#login-status');
  const preview = $('#email-preview');
  let sending=false, retryAt=0, retryTimer=null;
  function updateSendButton(){
    clearTimeout(retryTimer);
    const remaining=Math.max(0,Math.ceil((retryAt-Date.now())/1000));
    $('#send-link').disabled=sending||remaining>0;
    $('#send-link').textContent=remaining>0?`Try again in ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`:'Send my link →';
    if(remaining>0)retryTimer=setTimeout(updateSendButton,1000);
  }
  async function start() {
    try {
      const config = await api('/api/auth/config');
      $('#local-email-note').hidden = !config.local_preview;
      if (!config.email_configured) status.textContent='Email sign-in needs configuration. You can continue as a guest for now.';
      if (token) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw Error('This sign-in link is incomplete. Request a new link below.');
        const info = await api('/api/auth/inspect', {method:'POST',body:JSON.stringify({token})});
        $('#login-form').hidden=true;
        $('#verify-email').textContent=info.email;
        $('#verify-note').textContent=info.invitation ? 'Your picnic crew invited you. Confirm your email to open the saved plan.' : 'Confirm this is your email to open your saved picnics.';
        $('#verify-panel').hidden=false;
      } else {
        await BBAccount.ready;
        if (BBAccount.state.email) {
          $('#already-signed-in').hidden=false;
          $('#already-email').textContent=BBAccount.state.email;
          $('#my-picnics-link').href=destination;
        }
      }
    } catch(error) {status.textContent=error.message;}
  }
  $('#login-form').onsubmit=async event => {
    event.preventDefault(); if(sending||Date.now()<retryAt)return;
    sending=true; $('#send-link').disabled=true; preview.hidden=true;
    status.textContent='Getting your sign-in link ready…';
    try {
      const result=await api('/api/auth/link', {method:'POST',body:JSON.stringify({email:$('#login-email').value})});
      status.textContent=result.preview ? 'Local preview ready. No email was sent.' : result.message;
      if(result.preview){$('#preview-link').href=result.preview.preview_url;$('#preview-recipient').textContent=result.preview.email;preview.hidden=false;}
    } catch(error) {
      status.textContent=error.message;
      if(error.status===429&&error.retryAfter>0)retryAt=Date.now()+error.retryAfter*1000;
    }
    finally {sending=false;updateSendButton();}
  };
  $('#finish-sign-in').onclick=async()=>{
    if(sending)return;
    sending=true; $('#finish-sign-in').disabled=true;
    status.textContent='Opening your picnic corner…';
    try {
      const result=await api('/api/auth/verify',{method:'POST',body:JSON.stringify({token})});
      await BBAccount.ready;
      let cachedOwner=null;try{cachedOwner=JSON.parse(localStorage.getItem('gather-plan'))?.account_email;}catch{}
      if((BBAccount.state.email&&BBAccount.state.email!==result.email)||(cachedOwner&&cachedOwner!==result.email))BBAccount.clearLocalCopies();
      token=null;BBAccount.notifyChange();
      location.href=result.path.includes('?plan=')?result.path:destination;
    } catch(error){status.textContent=error.message;$('#finish-sign-in').disabled=false;sending=false;}
  };
  $('#use-another-email').onclick=()=>{token=null;$('#verify-panel').hidden=true;$('#login-form').hidden=false;status.textContent='';$('#login-email').focus();};
  start();
})();
