/* Shared session helpers; private access is always enforced by the server. */
(() => {
  const state = {email:null, navRole:null, unavailable:false};
  async function api(path, options={}) {
    const response = await fetch(path, {
      ...options, credentials:'same-origin', cache:'no-store',
      headers:{'Content-Type':'application/json', 'X-BB-Request':'1', ...options.headers},
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(typeof result.detail === 'string' ? result.detail : 'Please check your details and try again.');
      error.status = response.status;
      error.retryAfter = Number(response.headers?.get('Retry-After')) || 0;
      throw error;
    }
    return result;
  }
  function clearLocalCopies() {
    try {
      for (const key of ['gather-plan','picnic-thread','gather-review-link']) localStorage.removeItem(key);
      for (const key of Object.keys(sessionStorage)) if (key.startsWith('picnic-chat-')||key==='bb-active-plan'||key.startsWith('bb-picnic-invite')) sessionStorage.removeItem(key);
    } catch {}
  }
  function updateSidebarIdentity(){
    document.querySelectorAll('[data-session-identity]').forEach(card=>{
      const label=card.querySelector('[data-identity-label]');
      const email=card.querySelector('[data-identity-email]');
      const avatar=card.querySelector('[data-identity-avatar]');
      label.textContent=state.unavailable?'Sign-in status unavailable':state.email?'Signed in as':'Guest mode';
      email.textContent=state.unavailable?'Refresh to check':state.email||'Not signed in';
      avatar.textContent=state.email?state.email.slice(0,2).toUpperCase():'YOU';
    });
  }
  function updateAccountLinks(){
    document.querySelectorAll('[data-account-link]').forEach(link=>{
      const role=state.email?(state.navRole==='guest'?'As Guest':'As Organizer'):'As Organizer · Email sign-in';
      link.href=state.email?'account.html':'login.html';
      link.querySelector('strong').textContent='My Picnic';
      link.querySelector('small').textContent=role;
      link.setAttribute('aria-label',`My Picnic — ${role}`);
    });
    updateSidebarIdentity();
  }
  const ready = api('/api/auth/me').then(result => {
    state.email = result.email;
    try{const cached=JSON.parse(localStorage.getItem('gather-plan'));if(cached?.account_email&&cached.account_email!==state.email)clearLocalCopies();}catch{}
    state.navRole=result.nav_role||'organizer';
    updateAccountLinks();
    return state;
  }).catch(() => {state.unavailable=true; updateSidebarIdentity(); return state;});
  async function save(thread) {
    await ready;
    if (state.unavailable) throw Error('Account connection unavailable. This copy is saved in your browser; retry to save it to your account.');
    if (!state.email) return null;
    const result = await api('/api/account/plans', {method:'POST', body:JSON.stringify({thread_id:thread})});
    state.navRole='organizer';updateAccountLinks();
    return {...result, email:state.email};
  }
  function notifyChange(){try{localStorage.setItem('bb-session-change',String(Date.now()));}catch{}}
  globalThis.addEventListener?.('storage',event=>{if(event.key==='bb-session-change')location.reload();});
  async function logout() {
    await api('/api/auth/logout', {method:'POST'});
    clearLocalCopies(); state.email=null; state.navRole=null; updateAccountLinks(); notifyChange();
    location.href='login.html';
  }
  globalThis.BBAccount = {ready, state, api, save, logout, clearLocalCopies, notifyChange};
})();
