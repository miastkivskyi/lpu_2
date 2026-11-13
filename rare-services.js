const SUPABASE_URL="https://zaoiiafrryeajwoltzvo.supabase.co";
const SUPABASE_KEY="sb_publishable_ACM7uhhC3PKQxIxvqywgAA_0MuWsE2Y";
const SESSION_KEY="lpu2_session";
const $=id=>document.getElementById(id);
const norm=s=>String(s||"").toLocaleLowerCase("uk").normalize("NFC").replace(/[’‘`]/g,"'").replace(/\s+/g," ").trim();
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let SESSION=null,PROFILE=null,ROWS=[],PENDING=[],EDITING_PENDING_ID=null;
function headers(extra={}){return {apikey:SUPABASE_KEY,Authorization:`Bearer ${SESSION?.access_token||SUPABASE_KEY}`,...extra};}
async function api(path,opt={}){const r=await fetch(`${SUPABASE_URL}${path}`,{...opt,headers:headers(opt.headers||{})});const t=await r.text();if(!r.ok){let detail=t;try{const j=JSON.parse(t);detail=[j.message,j.details,j.hint,j.code].filter(Boolean).join(" | ")||t;}catch{}throw new Error(`${r.status}: ${detail}`);}return t?JSON.parse(t):null;}
function status(msg,error=false){$("rareStatus").textContent=msg;$("rareStatus").classList.toggle("error",error);}
async function restore(){
 try{const s=JSON.parse(sessionStorage.getItem(SESSION_KEY)||"null");if(s?.access_token&&s?.expires_at>Date.now()/1000){SESSION=s;const p=await api(`/rest/v1/lpu_user_profiles?select=surname,is_admin&user_id=eq.${encodeURIComponent(s.user.id)}`);PROFILE=p[0]||null;if(PROFILE)return;}}
 catch(e){console.warn(e);}
 SESSION=null;PROFILE=null;
}
async function anonLogin(){
 const r=await fetch(`${SUPABASE_URL}/auth/v1/signup`,{method:"POST",headers:{apikey:SUPABASE_KEY,"Content-Type":"application/json"},body:"{}"});
 const t=await r.text();if(!r.ok)throw new Error(t);const d=JSON.parse(t);
 SESSION={...d,expires_at:Math.floor(Date.now()/1000)+(d.expires_in||3600)};sessionStorage.setItem(SESSION_KEY,JSON.stringify(SESSION));
}
async function login(surname,password){
 if(!SESSION)await anonLogin();
 if(password){
  const r=await fetch(`${SUPABASE_URL}/functions/v1/admin-login`,{method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SESSION.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({surname,password})});
  const t=await r.text();if(!r.ok)throw new Error(t);PROFILE=JSON.parse(t).profile;
 }else{
  await api("/rest/v1/lpu_user_profiles",{method:"POST",headers:{"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify({user_id:SESSION.user.id,surname:surname.trim(),is_admin:false})});
  const p=await api(`/rest/v1/lpu_user_profiles?select=surname,is_admin&user_id=eq.${encodeURIComponent(SESSION.user.id)}`);PROFILE=p[0]||null;
 }
 if(!PROFILE)throw new Error("Не вдалося завантажити профіль.");
 sessionStorage.setItem(SESSION_KEY,JSON.stringify(SESSION));renderUser();closeAuth();await load();
}
function renderUser(){
 $("rareLogin").hidden=!!PROFILE;$("rareUser").hidden=!PROFILE;
 if(PROFILE){$("rareSurname").textContent=PROFILE.surname;}
}
function openAuth(){ $("rareAuthError").textContent="";$("rareAuthForm").reset();$("rareAuth").hidden=false;document.body.classList.add("modal-open");}
function closeAuth(){ $("rareAuth").hidden=true;document.body.classList.remove("modal-open");}
function closeForm(){
 $("rareFormModal").hidden=true;
 document.body.classList.remove("modal-open");
 EDITING_PENDING_ID=null;
 if($("rareFormTitle"))$("rareFormTitle").textContent="Запропонувати запис";
 if($("rareFormDescription"))$("rareFormDescription").textContent="Пропозиція стане видимою всім після перевірки адміністратором.";
 if($("rareFormSubmit"))$("rareFormSubmit").textContent="Надіслати на розгляд";
}
async function load(){
 // Не завантажуємо весь затверджений каталог під час відкриття сторінки.
 ROWS=[];
 renderEmptySearchState();
 try{
  if(PROFILE?.is_admin){
   PENDING=await api("/rest/v1/rare_service_records?select=*&status=eq.pending&order=created_at.asc&limit=1000")||[];
  }else{
   PENDING=[];
  }
  renderAdmin();
  if(hasSearchCriteria())await searchRecords();
 }catch(e){
  status("Не вдалося завантажити дані: "+e.message,true);
 }
}
let searchTimer=null;
let searchRequestId=0;
const SEARCH_MIN_CHARS=2;
const SEARCH_LIMIT=100;
function currentSearch(){
 return {q:norm($("rareQuery").value),city:norm($("rareCity").value),cat:$("rareCategory").value};
}
function hasSearchCriteria(){
 const {q,city,cat}=currentSearch();
 return q.length>=SEARCH_MIN_CHARS||city.length>=SEARCH_MIN_CHARS||!!cat;
}
function renderEmptySearchState(message="Введіть щонайменше 2 символи для пошуку або виберіть категорію."){
 $("rareSummary").textContent="Пошук ще не виконано";
 $("rareResults").innerHTML="";
 $("rareEmpty").hidden=false;
 $("rareEmpty").textContent=message;
}
function scheduleSearch(){
 clearTimeout(searchTimer);
 const {q,city,cat}=currentSearch();
 if(q.length<SEARCH_MIN_CHARS&&city.length<SEARCH_MIN_CHARS&&!cat){
  searchRequestId++;
  ROWS=[];
  renderEmptySearchState(q.length===1||city.length===1?"Введіть ще хоча б один символ для пошуку.":undefined);
  return;
 }
 $("rareSummary").textContent="Пошук…";
 $("rareEmpty").hidden=true;
 searchTimer=setTimeout(searchRecords,400);
}
async function searchRecords(){
 const {q,city,cat}=currentSearch();
 if(q.length<SEARCH_MIN_CHARS&&city.length<SEARCH_MIN_CHARS&&!cat){
  ROWS=[];renderEmptySearchState();return;
 }
 const requestId=++searchRequestId;
 const params=new URLSearchParams({select:"*",status:"eq.approved",order:"city.asc,name.asc",limit:String(SEARCH_LIMIT)});
 if(q.length>=SEARCH_MIN_CHARS){
  const term=q.replace(/[(),.*%]/g," ").replace(/\s+/g," ").trim();
  if(term.length>=SEARCH_MIN_CHARS){
   const pattern=`*${term}*`;
   const fields=["name","clinic","city","area","address","price","availability","conditions","notes"];
   params.set("or",`(${fields.map(field=>`${field}.ilike.${pattern}`).join(",")})`);
  }
 }
 if(city.length>=SEARCH_MIN_CHARS){
  const cityTerm=city.replace(/[(),.*%]/g," ").replace(/\s+/g," ").trim();
  if(cityTerm.length>=SEARCH_MIN_CHARS)params.set("city",`ilike.*${cityTerm}*`);
 }
 if(cat)params.set("category",`eq.${cat}`);
 $("rareResults").innerHTML='<div class="empty">Шукаємо записи…</div>';
 $("rareEmpty").hidden=true;
 try{
  const found=await api(`/rest/v1/rare_service_records?${params.toString()}`)||[];
  if(requestId!==searchRequestId)return;
  ROWS=found;
  render();
  if(found.length===SEARCH_LIMIT){
   $("rareSummary").textContent=`Показано перші ${SEARCH_LIMIT} записів. Уточніть пошук, щоб звузити результати.`;
  }
 }catch(err){
  if(requestId!==searchRequestId)return;
  ROWS=[];
  $("rareResults").innerHTML="";
  $("rareEmpty").hidden=false;
  $("rareEmpty").textContent="Не вдалося виконати пошук. Спробуйте ще раз.";
  status("Помилка пошуку: "+err.message,true);
 }
}
function renderAdmin(){
 $("rareAdmin").hidden=!PROFILE?.is_admin;
 if(!PROFILE?.is_admin)return;
 $("rarePendingCount").textContent=String(PENDING.length);
 $("rarePending").innerHTML=PENDING.length?PENDING.map(x=>`<div class="rare-admin-row">
  <div class="rare-admin-info">
   <div class="rare-admin-title">${esc(x.name)}</div>
   <div class="rare-detail">${esc(x.category)} · ${esc(x.city)} · ${esc(x.clinic)}</div>
   ${x.address?`<div class="rare-detail">Адреса: ${esc(x.address)}</div>`:""}
   ${x.price?`<div class="rare-detail">Вартість: ${esc(x.price)}</div>`:""}
   ${x.availability?`<div class="rare-detail">Наявність: ${esc(x.availability)}</div>`:""}
   ${x.notes?`<div class="rare-detail">Примітки: ${esc(x.notes)}</div>`:""}
   <small>Запропонував: ${esc(x.submitted_by_surname||"—")}</small>
  </div>
  <div class="rare-admin-actions">
   <button class="rare-edit" data-edit="${x.id}">Редагувати</button>
   <button class="rare-approve" data-approve="${x.id}">Затвердити</button>
   <button class="rare-reject" data-reject="${x.id}">Відхилити</button>
   <button class="rare-delete" data-delete="${x.id}">Видалити</button>
  </div>
 </div>`).join(""):'<p class="muted">Нових пропозицій немає.</p>';
}
function render(){
 const filtered=ROWS;
 $("rareSummary").textContent=`Знайдено записів: ${filtered.length}`;
 $("rareEmpty").hidden=!!filtered.length;
 if(!filtered.length){
  $("rareResults").innerHTML="";
  $("rareEmpty").textContent="За цим запитом нічого не знайдено.";
  return;
 }
 $("rareResults").innerHTML=filtered.map(x=>{
  const av=norm(x.availability+" "+x.notes);
  const unavailable=/не працює|не проводять|немає|не має|припинили співпрацю|тимчасово не/.test(av);
  const uncertain=/уточн|потрібно|запис|індивідуальн/.test(av);
  const badge=x.availability?`<span class="rare-status ${unavailable?"unavailable":uncertain?"uncertain":""}">${esc(x.availability)}</span>`:"";
  return `<article class="rare-card"><div class="rare-card-top"><span class="rare-kind">${esc(x.category)}</span>${badge}</div><h3>${esc(x.name)}</h3><div class="rare-clinic">${esc(x.clinic)}</div>${x.city?`<p class="rare-detail"><b>Місто / регіон:</b> ${esc(x.city)}${x.area?" · "+esc(x.area):""}</p>`:""}${x.address?`<p class="rare-detail"><b>Адреса:</b> ${esc(x.address)}</p>`:""}${x.price?`<p class="rare-detail"><b>Вартість:</b> ${esc(x.price)}</p>`:""}${x.availability?`<p class="rare-detail"><b>Наявність:</b> ${esc(x.availability)}</p>`:""}${x.conditions?`<p class="rare-detail"><b>Умови:</b> ${esc(x.conditions)}</p>`:""}${x.notes?`<p class="rare-detail"><b>Примітки:</b> ${esc(x.notes)}</p>`:""}<div class="rare-source">Джерело: ${esc(x.source_sheet||"Додано на сайт")} · ${x.source_row?"рядок "+x.source_row:""} ${x.updated_at?"· оновлено "+new Date(x.updated_at).toLocaleDateString("uk-UA"):""}</div></article>`;
 }).join("");
}
async function submitRecord(e){
 e.preventDefault();
 const form=$("rareRecordForm");
 const btn=form?.querySelector('button[type="submit"],button.auth-submit');
 const errorEl=$("rareFormError");
 if(btn?.disabled)return;
 if(!form.reportValidity())return;
 if(!PROFILE||!SESSION?.user?.id||!SESSION?.access_token){
  if(errorEl)errorEl.textContent="Сесія неактивна. Увійди ще раз і повтори надсилання.";
  openAuth();return;
 }
 if(btn)btn.disabled=true;
 if(errorEl)errorEl.textContent="";
 try{
  const record={
   category:$("fCategory").value,
   name:$("fName").value.trim(),
   city:$("fCity").value.trim(),
   area:"",
   clinic:$("fClinic").value.trim(),
   address:$("fAddress").value.trim(),
   availability:$("fAvailability").value.trim(),
   price:$("fPrice").value.trim(),
   conditions:"",
   notes:$("fNotes").value.trim(),
   updated_at:new Date().toISOString()
  };
  if(!record.name||!record.city||!record.clinic)throw new Error("Заповни назву, місто та клініку.");

  if(EDITING_PENDING_ID){
   if(!PROFILE.is_admin)throw new Error("Редагувати пропозиції може лише адміністратор.");
   await api(`/rest/v1/rare_service_records?id=eq.${encodeURIComponent(EDITING_PENDING_ID)}&status=eq.pending`,{
    method:"PATCH",
    headers:{"Content-Type":"application/json",Prefer:"return=representation"},
    body:JSON.stringify(record)
   });
   closeForm();form.reset();EDITING_PENDING_ID=null;
   $("rareFormTitle").textContent="Запропонувати запис";
   $("rareFormDescription").textContent="Пропозиція стане видимою всім після перевірки адміністратором.";
   $("rareFormSubmit").textContent="Надіслати на розгляд";
   status("Пропозицію відредаговано. Вона залишається на розгляді.");
  }else{
   const profileRows=await api(`/rest/v1/lpu_user_profiles?select=surname,is_admin&user_id=eq.${encodeURIComponent(SESSION.user.id)}`);
   const currentProfile=profileRows?.[0];
   if(!currentProfile){PROFILE=null;throw new Error("Профіль користувача не знайдено. Вийди з облікового запису та увійди знову.");}
   PROFILE=currentProfile;
   Object.assign(record,{
    source_sheet:"Додано користувачем",
    status:PROFILE.is_admin?"approved":"pending",
    submitted_by_surname:PROFILE.surname,
    user_id:SESSION.user.id
   });
   await api("/rest/v1/rare_service_records",{
    method:"POST",headers:{"Content-Type":"application/json",Prefer:"return=representation"},
    body:JSON.stringify(record)
   });
   closeForm();form.reset();
   status(PROFILE.is_admin?"Запис додано до каталогу.":"Пропозицію надіслано адміністратору на перевірку.");
  }
  await load();
 }catch(err){
  const message=String(err?.message||err);
  if(errorEl)errorEl.textContent=message;
  status("Не вдалося зберегти запис: "+message,true);
  console.error("Rare service save failed:",err);
 }finally{if(btn)btn.disabled=false;}
}
async function review(id,state){
 try{await api(`/rest/v1/rare_service_records?id=eq.${encodeURIComponent(id)}`,{method:"PATCH",headers:{"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify({status:state,reviewed_by:PROFILE.surname,reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()})});status(state==="approved"?"Запис затверджено.":"Пропозицію відхилено.");await load();}
 catch(e){status("Не вдалося змінити статус: "+e.message,true);}
}
function editPending(id){
 if(!PROFILE?.is_admin)return;
 const x=PENDING.find(row=>String(row.id)===String(id));
 if(!x)return;
 EDITING_PENDING_ID=x.id;
 $("rareFormTitle").textContent="Редагувати пропозицію";
 $("rareFormDescription").textContent="Виправ дані. Після збереження запис залишиться на розгляді.";
 $("rareFormSubmit").textContent="Зберегти зміни";
 $("fCategory").value=x.category||"Послуга";
 $("fName").value=x.name||"";
 $("fCity").value=x.city||"";
 $("fClinic").value=x.clinic||"";
 $("fAddress").value=x.address||"";
 $("fAvailability").value=x.availability||"";
 $("fPrice").value=x.price||"";
 $("fNotes").value=x.notes||"";
 $("rareFormError").textContent="";
 $("rareFormModal").hidden=false;
 document.body.classList.add("modal-open");
}
async function deletePending(id){
 if(!PROFILE?.is_admin)return;
 const x=PENDING.find(row=>String(row.id)===String(id));
 if(!x)return;
 if(!confirm(`Видалити пропозицію «${x.name}» від ${x.submitted_by_surname||"користувача"}? Цю дію не можна скасувати.`))return;
 try{
  await api(`/rest/v1/rare_service_records?id=eq.${encodeURIComponent(id)}&status=eq.pending`,{
   method:"DELETE",headers:{Prefer:"return=minimal"}
  });
  status("Пропозицію видалено.");
  await load();
 }catch(err){status("Не вдалося видалити пропозицію: "+err.message,true);}
}
async function deleteApprovedRecord(id){
 if(!PROFILE?.is_admin)return;
 const x=ROWS.find(row=>String(row.id)===String(id));
 if(!x)return;
 if(!confirm(`Видалити затверджений запис «${x.name}» — ${x.clinic}? Запис буде видалено з каталогу. Цю дію не можна скасувати.`))return;
 try{
  await api(`/rest/v1/rare_service_records?id=eq.${encodeURIComponent(id)}&status=eq.approved`,{
   method:"DELETE",headers:{Prefer:"return=minimal"}
  });
  status("Запис видалено з каталогу.");
  await load();
 }catch(err){
  status("Не вдалося видалити запис: "+err.message,true);
 }
}
document.addEventListener("DOMContentLoaded",async()=>{
 await restore();renderUser();
 $("rareLogin").addEventListener("click",openAuth);
 $("rareLogout").addEventListener("click",()=>{sessionStorage.removeItem(SESSION_KEY);location.reload();});
 $("rareQuery").addEventListener("input",scheduleSearch);$("rareCity").addEventListener("input",scheduleSearch);$("rareCategory").addEventListener("change",scheduleSearch);
 $("rareClear").addEventListener("click",()=>{clearTimeout(searchTimer);searchRequestId++;$("rareQuery").value="";$("rareCity").value="";$("rareCategory").value="";ROWS=[];renderEmptySearchState();});
 $("rareSuggest").addEventListener("click",()=>{if(!PROFILE){openAuth();return;}$("rareFormError").textContent="";$("rareRecordForm").reset();$("rareFormModal").hidden=false;document.body.classList.add("modal-open");});
 $("rareAuthForm").addEventListener("submit",async e=>{e.preventDefault();const b=$("rareAuthForm").querySelector("button");b.disabled=true;$("rareAuthError").textContent="";try{await login($("rareSurnameInput").value,$("rarePassword").value);}catch(err){$("rareAuthError").textContent=err.message;}finally{b.disabled=false;}});
 $("rareRecordForm").addEventListener("submit",submitRecord);
 $("rareResults").addEventListener("click",e=>{
  const del=e.target.closest("[data-delete-approved]");
  if(del)deleteApprovedRecord(del.dataset.deleteApproved);
 });
 document.querySelectorAll("[data-close-auth]").forEach(x=>x.addEventListener("click",closeAuth));
 document.querySelectorAll("[data-close-form]").forEach(x=>x.addEventListener("click",closeForm));
 $("rarePending").addEventListener("click",e=>{
  const edit=e.target.closest("[data-edit]"),approve=e.target.closest("[data-approve]"),reject=e.target.closest("[data-reject]"),del=e.target.closest("[data-delete]");
  if(edit)editPending(edit.dataset.edit);
  if(approve)review(approve.dataset.approve,"approved");
  if(reject)review(reject.dataset.reject,"rejected");
  if(del)deletePending(del.dataset.delete);
 });
 await load();
});
