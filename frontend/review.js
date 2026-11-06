const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = v => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);
function sourceLink(url){try{const u=new URL(url);return ['https:','http:'].includes(u.protocol)?`<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">Venue source ↗</a>`:'';}catch{return '';}}
let token = location.hash.slice(1);
let endpoint = `/api/shares/${encodeURIComponent(token)}`;
async function load(){
 try{
  if(!/^[A-Za-z0-9_-]{32}$/.test(token))throw Error('This review link is incomplete. Ask the organizer for a new link.');
  const response=await fetch(endpoint);if(!response.ok)throw Error(response.status===404?'This review link was not found. Ask the organizer for a new link.':'Unable to load the plan. Please try again.');
  const {plan:p,reviews}=await response.json();const venue=p.venues[0];
  $('#shared-content').innerHTML=`<section class="panel"><span class="status">You’re invited to review</span><h2>${esc(venue.name)}</h2><p class="review-facts">${esc(p.request.date)} · ${p.request.guests} people<br>${esc(p.request.location)} · ${venue.distance_miles==null?'Distance not verified':esc(venue.distance_miles)+' miles away'}</p>${sourceLink(venue.source_url)}<div class="review-cost"><strong>${money(p.total)} estimated total</strong><span>${money(p.total/p.request.guests)} per person</span></div><h3>Food & drinks</h3>${PicnicUI.foodSummary(p)}<p>${esc(p.food_choices.join(' · '))} · ${esc(p.food_source)}</p><ul class="menu">${p.menu.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p>Preferences: ${esc(p.dietary_preferences.join(', ')||'None specified')}</p><h3>Activities</h3><ul class="menu">${p.activities.map(a=>`<li>${esc(a.name)} — ${esc(a.owner)}</li>`).join('')||'<li>Time to relax and enjoy the outdoors.</li>'}</ul><details><summary>Schedule & backup</summary><ul class="menu">${p.schedule.map(s=>`<li>${esc(s)}</li>`).join('')}</ul><p>${esc(p.backup_plan)}</p></details><div class="notice">${p.warnings.map(esc).join('<br>')}</div></section>`;
  $('#reviews').innerHTML=reviews.length?reviews.map(r=>`<article class="review-item"><strong>${esc(r.name)}</strong><span>${esc(r.response)}</span>${r.comment?`<p>${esc(r.comment)}</p>`:''}</article>`).join(''):'<p>No feedback yet. Be the first to share your thoughts.</p>';
  for(const id of ['shared-content','feedback-section','responses-section'])$('#'+id).hidden=false;
  $('#review-status').textContent='';
 }catch(e){$('#review-status').textContent=e instanceof TypeError?'Cannot reach the planner. Please try again.':e.message;}
}
$('#refresh-reviews').onclick=load;
$('#review-form').onsubmit=async e=>{e.preventDefault();const name=$('#review-name').value.trim();if(!name){$('#review-name').setCustomValidity('Please enter your name.');$('#review-name').reportValidity();return;}$('#send-review').disabled=true;$('#feedback-status').textContent='';try{const res=await fetch(endpoint+'/reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,response:$('#review-response').value,comment:$('#review-comment').value.trim()})});if(!res.ok)throw Error('Unable to send feedback. Please check your details and try again.');$('#review-form').reset();await load();$('#feedback-status').textContent='Thanks! Your feedback has been shared with the group.';}catch(e){$('#feedback-status').textContent=e instanceof TypeError?'Cannot connect. Your feedback has not been sent. Please try again.':e.message;}finally{$('#send-review').disabled=false;}};
$('#review-name').oninput=()=>$('#review-name').setCustomValidity('');
load();

window.addEventListener('hashchange',()=>{token=location.hash.slice(1);endpoint=`/api/shares/${encodeURIComponent(token)}`;for(const id of ['shared-content','feedback-section','responses-section'])$('#'+id).hidden=true;load();});
