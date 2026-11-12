const SUPABASE_URL="https://zaoiiafrryeajwoltzvo.supabase.co";
const SUPABASE_KEY="sb_publishable_ACM7uhhC3PKQxIxvqywgAA_0MuWsE2Y";
const TABLE="clinic_extra_specialties", SESSION_KEY="lpu2_session";
const CLINICS_TABLE="lpu_clinics", VISIBILITY_TABLE="clinic_visibility", DELETE_REQUESTS_TABLE="clinic_deletion_requests", CORRECTIONS_TABLE="specialty_corrections";
const $=id=>document.getElementById(id);
let DB=[],filtered=[],EXTRA=[],ADDED_CLINICS=[],HIDDEN_CLINICS=[],DELETE_REQUESTS=[],CORRECTIONS=[],CHANGE_LOG=[],SESSION=null,PROFILE=null,pendingAdd=null;
const norm=s=>String(s||"").toLocaleLowerCase("uk").normalize("NFC").replace(/[’‘`]/g,"'").replace(/\s+/g," ").trim();
const uniq=a=>[...new Set(a.filter(Boolean))].sort((a,b)=>a.localeCompare(b,"uk"));
function esc(v){return String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));}
function setStatus(msg,error=false){$("status").textContent=msg;$("status").classList.toggle("error",error);}
function apiHeaders(extra={}){return {apikey:SUPABASE_KEY,Authorization:`Bearer ${SESSION?.access_token||SUPABASE_KEY}`,...extra};}
async function api(path,options={}){const r=await fetch(`${SUPABASE_URL}${path}`,{...options,headers:apiHeaders(options.headers||{})});const t=await r.text();if(!r.ok)throw new Error(`${r.status}: ${t}`);return t?JSON.parse(t):null;}
async function restoreSession(){
 try{const saved=JSON.parse(sessionStorage.getItem(SESSION_KEY)||"null");if(saved?.access_token&&saved?.expires_at>Date.now()/1000){SESSION=saved;await loadProfile();return !!PROFILE;}}
 catch(e){console.warn("Session restore:",e);}
 SESSION=null;PROFILE=null;sessionStorage.removeItem(SESSION_KEY);return false;
}
async function anonymousSignIn(){
 const r=await fetch(`${SUPABASE_URL}/auth/v1/signup`,{method:"POST",headers:{apikey:SUPABASE_KEY,"Content-Type":"application/json"},body:JSON.stringify({})});
 const t=await r.text();if(!r.ok)throw new Error(`Не вдалося створити сесію: ${t}`);
 const d=JSON.parse(t);SESSION={...d,expires_at:Math.floor(Date.now()/1000)+(d.expires_in||3600)};
 sessionStorage.setItem(SESSION_KEY,JSON.stringify(SESSION));
}
async function loadProfile(){const rows=await api(`/rest/v1/lpu_user_profiles?select=surname,is_admin&user_id=eq.${encodeURIComponent(SESSION.user.id)}`);PROFILE=rows[0]||null;}
async function ensureRegularProfile(surname){
 const userId=SESSION?.user?.id;
 if(!userId)throw new Error("Не вдалося отримати ID користувача. Спробуй увійти ще раз.");
 const profilePath=`/rest/v1/lpu_user_profiles?select=surname,is_admin&user_id=eq.${encodeURIComponent(userId)}`;
 // Перевіряємо профіль перед INSERT. Upsert не використовуємо, бо він вимагає UPDATE-політику RLS.
 const existing=await api(profilePath);
 if(existing?.length){PROFILE=existing[0];return;}
 try{
  await api("/rest/v1/lpu_user_profiles",{
   method:"POST",
   headers:{"Content-Type":"application/json",Prefer:"return=representation"},
   body:JSON.stringify({user_id:userId,surname,is_admin:false})
  });
 }catch(err){
  // Якщо паралельний запит уже створив профіль, перечитуємо його.
  if(!/409|23505|duplicate key|already exists/i.test(String(err.message||"")))throw err;
 }
 await loadProfile();
 if(!PROFILE)throw new Error("Профіль не створено або не вдалося його прочитати.");
}

async function registerUser(surname,password){
 surname=surname.trim();if(surname.length<2||surname.length>80)throw new Error("Вкажи коректне прізвище (2–80 символів).");
 if(!SESSION)await anonymousSignIn();
 if(password){
  const r=await fetch(`${SUPABASE_URL}/functions/v1/admin-login`,{method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SESSION.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({surname,password})});
  const t=await r.text();if(!r.ok)throw new Error(`Вхід адміністратора не виконано: ${t}`);PROFILE=JSON.parse(t).profile;
 }else{
  await ensureRegularProfile(surname);
 }
 if(!PROFILE)throw new Error("Не вдалося завантажити профіль.");
 sessionStorage.setItem(SESSION_KEY,JSON.stringify(SESSION));await loadExtra();refreshDatalist();run();renderUser();renderAdminWorkspace();closeAuth();
 setStatus(`Вхід виконано: ${PROFILE.surname}${PROFILE.is_admin?" (адміністратор)":""}.`);
 if(pendingAdd){const task=pendingAdd;pendingAdd=null;await addSpecialty(task.clinic,task.inputId);}
}
function logout(){sessionStorage.removeItem(SESSION_KEY);SESSION=null;PROFILE=null;window.location.reload();}
function renderUser(){
 const signed=$("userSignedIn");
 if(PROFILE){
  signed.hidden=false;$("loginOpen").hidden=true;
  const identity=$("userIdentity");if(identity)identity.textContent=PROFILE.surname;
  const role=$("userRole");if(role)role.textContent=PROFILE.is_admin?"Адміністратор":"Користувач";
  signed.classList.toggle("admin-user",!!PROFILE.is_admin);
 }
 else{signed.hidden=true;$("loginOpen").hidden=false;}
}
async function loadExtra(){
 const [extra,added,hidden]=await Promise.all([
  api(`/rest/v1/${TABLE}?select=id,clinic_name,specialty,added_by_surname,is_admin,created_at&order=created_at.desc`),
  api(`/rest/v1/${CLINICS_TABLE}?select=id,clinic,locations,specialties,added_by_surname,created_at&order=created_at.desc`),
  api(`/rest/v1/${VISIBILITY_TABLE}?select=clinic_name,is_hidden`)
 ]);
 EXTRA=extra||[];ADDED_CLINICS=added||[];HIDDEN_CLINICS=(hidden||[]).filter(x=>x.is_hidden).map(x=>norm(x.clinic_name));
 if(PROFILE?.is_admin){
  const [requests,corrections,history]=await Promise.all([
   api(`/rest/v1/${DELETE_REQUESTS_TABLE}?select=*&status=eq.pending&order=created_at.asc`),
   api(`/rest/v1/${CORRECTIONS_TABLE}?select=*&order=created_at.desc`),
   api(`/rest/v1/lpu_change_archive?select=*&order=created_at.desc&limit=500`)
  ]);
  DELETE_REQUESTS=requests||[];CORRECTIONS=corrections||[];CHANGE_LOG=history||[];
 }else{
  const corrections=await api(`/rest/v1/${CORRECTIONS_TABLE}?select=*&status=eq.approved`);
  CORRECTIONS=corrections||[];DELETE_REQUESTS=[];CHANGE_LOG=[];
 }
}
function openAuth(clinic,inputId){pendingAdd=clinic?{clinic,inputId}:null;$("authError").textContent="";$("authForm").reset();$("authModal").hidden=false;document.body.classList.add("modal-open");setTimeout(()=>$("surname").focus(),30);}
function closeAuth(){$("authModal").hidden=true;document.body.classList.remove("modal-open");}
function setupAutocomplete(inputId,getItems){
 const input=$(inputId),field=input.closest(".field");
 const menu=document.createElement("div");
 menu.className="autocomplete-menu";menu.hidden=true;menu.setAttribute("role","listbox");
 field.appendChild(menu);
 function render(){
  const q=norm(input.value);
  const items=getItems().filter(x=>!q||norm(x).includes(q)).slice(0,300);
  menu.innerHTML=items.length?items.map((item,i)=>`<button type="button" class="autocomplete-option" role="option" data-value="${esc(item)}">${esc(item)}</button>`).join(""):'<div class="autocomplete-empty">Нічого не знайдено</div>';
  menu.hidden=false;
 }
 input.addEventListener("focus",render);
 input.addEventListener("input",render);
 menu.addEventListener("mousedown",e=>e.preventDefault());
 menu.addEventListener("click",e=>{
  const option=e.target.closest(".autocomplete-option");if(!option)return;
  input.value=option.dataset.value;menu.hidden=true;run();
 });
 input.addEventListener("keydown",e=>{
  if(e.key==="Escape")menu.hidden=true;
  if(e.key==="ArrowDown"&&!menu.hidden){e.preventDefault();menu.querySelector(".autocomplete-option")?.focus();}
 });
 document.addEventListener("click",e=>{if(!field.contains(e.target))menu.hidden=true;});
}

function init(){
 const specs=uniq(DB.flatMap(c=>allSpecs(c)));
 const cities=uniq(DB.flatMap(c=>(c.locations||[]).map(l=>l.city)));
 setupAutocomplete("specialty",()=>uniq(allClinics().flatMap(c=>allSpecs(c))));
 setupAutocomplete("city",()=>uniq(allClinics().flatMap(c=>(c.locations||[]).map(l=>l.city))));
 $("specialty").addEventListener("input",run);$("city").addEventListener("input",run);
 $("clear").addEventListener("click",()=>{$("specialty").value="";$("city").value="";run();});
 $("showAdded").addEventListener("click",showAdded);$("closeAdded").addEventListener("click",()=>$("addedPanel").hidden=true);
 $("results").addEventListener("click",handleCardClick);$("addedList").addEventListener("click",handleCardClick);
 $("authForm").addEventListener("submit",async e=>{
  e.preventDefault();$("authError").textContent="";const btn=$("authForm").querySelector("button[type=submit]");btn.disabled=true;
  try{await registerUser($("surname").value,$("adminPassword").value);}
  catch(err){$("authError").textContent=err.message;}
  finally{btn.disabled=false;}
 });
 document.querySelectorAll("[data-close-auth]").forEach(el=>el.addEventListener("click",()=>{pendingAdd=null;closeAuth();}));
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("authModal").hidden){pendingAdd=null;closeAuth();}});
 $("logout").addEventListener("click",logout);
 $("loginOpen").addEventListener("click",()=>{pendingAdd=null;openAuth(null,null);});
 $("addClinicOpen")?.addEventListener("click",()=>{ $("clinicError").textContent="";$("clinicForm").reset();$("clinicModal").hidden=false;document.body.classList.add("modal-open"); });
 document.querySelectorAll("[data-close-clinic]").forEach(el=>el.addEventListener("click",()=>{ $("clinicModal").hidden=true;document.body.classList.remove("modal-open"); }));
 $("clinicForm")?.addEventListener("submit",submitNewClinic);
 $("showDeletionRequests")?.addEventListener("click",()=>renderAdminQueue("deletions"));
 $("showCorrectionRequests")?.addEventListener("click",()=>renderAdminQueue("corrections"));
 $("showChangeArchive")?.addEventListener("click",()=>{const box=$("changeArchive");if(!box)return;box.hidden=!box.hidden;if(!box.hidden)renderChangeArchive();});
 $("archiveSearch")?.addEventListener("input",renderChangeArchive);
 $("archiveType")?.addEventListener("change",renderChangeArchive);
 renderAdminWorkspace();run();renderUser();
}
function allClinics(){
 const base=DB.filter(c=>!HIDDEN_CLINICS.includes(norm(c.clinic)));
 const added=ADDED_CLINICS.map(c=>({...c,_isAdded:true}));
 return [...base,...added];
}
function archiveValue(value){
 if(value===null||value===undefined||value==="")return "—";
 if(typeof value==="object")return JSON.stringify(value);
 return String(value);
}
function archiveDescription(row){
 const before=row.old_data||{},after=row.new_data||{};
 const name=after.clinic||before.clinic||after.clinic_name||before.clinic_name||"";
 const specialty=after.specialty||before.specialty||after.original_specialty||before.original_specialty||"";
 const corrected=after.corrected_specialty||before.corrected_specialty||"";
 const actor=row.actor_surname||"Невідомо";
 const actionLabels={INSERT:"Додано",UPDATE:"Змінено",DELETE:"Видалено"};
 const label=actionLabels[row.action]||row.action;
 let detail="";
 if(row.entity_table==="lpu_clinics")detail=after.clinic||before.clinic||"Клініка";
 else if(row.entity_table==="clinic_extra_specialties")detail=`${specialty} · ${name}`;
 else if(row.entity_table==="specialty_corrections")detail=`${specialty}${corrected?` → ${corrected}`:""} · ${name}`;
 else if(row.entity_table==="clinic_visibility")detail=`${after.clinic_name||before.clinic_name||"Клініка"} · ${after.is_hidden?"приховано":"відновлено"}`;
 else if(row.entity_table==="clinic_deletion_requests")detail=`Заявка: ${name||"клініка"} · ${after.status||before.status||""}`;
 else detail=name||specialty||row.entity_table;
 return {label,detail,actor};
}
function renderChangeArchive(){
 if(!PROFILE?.is_admin)return;
 const query=norm($("archiveSearch")?.value||""),type=$("archiveType")?.value||"";
 const rows=CHANGE_LOG.filter(row=>{
  if(type&&row.entity_table!==type)return false;
  const d=archiveDescription(row);
  return !query||norm([d.detail,d.actor,row.entity_table,d.label,JSON.stringify(row.old_data),JSON.stringify(row.new_data)].join(" ")).includes(query);
 });
 if(!$("archiveRows"))return;
 $("archiveRows").innerHTML=rows.length?rows.map(row=>{
  const d=archiveDescription(row),date=row.created_at?new Date(row.created_at).toLocaleString("uk-UA"):"";
  return `<article class="archive-entry"><div class="archive-entry-top"><span class="archive-action">${esc(d.label)}</span><time>${esc(date)}</time></div><strong>${esc(d.detail)}</strong><div class="archive-meta">Таблиця: ${esc(row.entity_table)} · Виконав: ${esc(d.actor)}</div><details><summary>Деталі зміни</summary><div class="archive-diff"><div><b>До зміни</b><pre>${esc(archiveValue(row.old_data))}</pre></div><div><b>Після зміни</b><pre>${esc(archiveValue(row.new_data))}</pre></div></div></details></article>`;
 }).join(""):'<p class="muted">За вибраними умовами записів не знайдено.</p>';
}

function renderAdminWorkspace(){
 const panel=$("adminWorkspace");if(!panel)return;
 panel.hidden=!PROFILE?.is_admin;
 if(PROFILE?.is_admin){
  if($("deletionCount"))$("deletionCount").textContent=String(DELETE_REQUESTS.length);
  if($("correctionCount"))$("correctionCount").textContent=String(CORRECTIONS.filter(x=>x.status==="pending").length);
 }
}
async function submitNewClinic(e){
 e.preventDefault();if(!PROFILE?.is_admin)return;
 const btn=$("clinicForm").querySelector("button[type=submit]");btn.disabled=true;$("clinicError").textContent="";
 const clinic=$("clinicName").value.trim(),city=$("clinicCity").value.trim(),address=$("clinicAddress").value.trim(),level=$("clinicLevel").value.trim();
 const specialties=$("clinicSpecialties").value.split(",").map(x=>x.trim()).filter(Boolean);
 try{
  await api(`/rest/v1/${CLINICS_TABLE}`,{method:"POST",headers:{"Content-Type":"application/json",Prefer:"return=representation"},body:JSON.stringify({clinic,locations:[{city,address,level}],specialties,added_by_surname:PROFILE.surname,user_id:SESSION.user.id})});
  $("clinicModal").hidden=true;document.body.classList.remove("modal-open");await reloadData();setStatus(`Клініку «${clinic}» додано до бази.`);
 }catch(err){$("clinicError").textContent=`Не вдалося додати клініку: ${err.message}`;}
 finally{btn.disabled=false;}
}
async function deleteClinic(clinic){
 if(!PROFILE?.is_admin)return;
 if(!confirm(`Підтвердити видалення клініки «${clinic.clinic}»?`))return;
 try{
  if(clinic._isAdded){
   await api(`/rest/v1/${CLINICS_TABLE}?id=eq.${clinic.id}`,{method:"DELETE"});
  }else{
   await api(`/rest/v1/${VISIBILITY_TABLE}`,{method:"POST",headers:{"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({clinic_name:clinic.clinic,is_hidden:true,updated_by:PROFILE.surname})});
  }
  await reloadData();setStatus(`Клініку «${clinic.clinic}» видалено з активного списку.`);
 }catch(err){setStatus(`Не вдалося видалити клініку: ${err.message}`,true);}
}
async function proposeCorrection(clinic,specialty){
 if(!PROFILE||!SESSION){setStatus("Спочатку увійдіть за прізвищем.",true);return;}
 const corrected=prompt(`Запропонуйте скореговану назву для «${specialty}»:`,specialty);
 if(corrected===null)return;
 if(!corrected.trim()||norm(corrected)===norm(specialty)){setStatus("Вкажіть іншу назву спеціальності.",true);return;}
 try{
  await api(`/rest/v1/${CORRECTIONS_TABLE}`,{method:"POST",headers:{"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify({clinic_name:clinic,original_specialty:specialty,corrected_specialty:corrected.trim(),submitted_by_surname:PROFILE.surname,user_id:SESSION.user.id,status:"pending"})});
  setStatus("Пропозицію щодо спеціальності передано адміністратору на розгляд.");
 }catch(err){setStatus(`Не вдалося надіслати коригування: ${err.message}`,true);}
}
async function reviewRequest(table,id,status){
 if(!PROFILE?.is_admin)return;
 try{
  await api(`/rest/v1/${table}?id=eq.${id}`,{method:"PATCH",headers:{"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify({status,reviewed_by:PROFILE.surname,reviewed_at:new Date().toISOString()})});
  await reloadData();renderAdminQueue(table===DELETE_REQUESTS_TABLE?"deletions":"corrections");
  setStatus(status==="approved"?"Заявку підтверджено.":"Заявку відхилено.");
 }catch(err){setStatus(`Не вдалося оновити заявку: ${err.message}`,true);}
}
function renderAdminQueue(kind){
 if(!PROFILE?.is_admin)return;
 const box=$("adminQueue");box.hidden=false;
 const rows=kind==="deletions"?DELETE_REQUESTS:CORRECTIONS.filter(x=>x.status==="pending");
 box.innerHTML=`<div class="queue-heading"><strong>${kind==="deletions"?"Заявки на видалення клінік":"Запропоновані коригування спеціальностей"}</strong></div>`+
 (rows.length?rows.map(x=>`<div class="queue-row"><div><strong>${esc(kind==="deletions"?x.clinic_name:x.clinic_name)}</strong><div class="muted">${kind==="deletions"?"Запропонував: "+esc(x.requested_by_surname):esc(x.original_specialty)+" → "+esc(x.corrected_specialty)+" · запропонував: "+esc(x.submitted_by_surname)}</div></div><div class="queue-actions"><button class="approve-btn" data-review-table="${kind==="deletions"?DELETE_REQUESTS_TABLE:CORRECTIONS_TABLE}" data-review-id="${x.id}" data-review-status="approved">${kind==="deletions"?"Підтвердити видалення":"Затвердити"}</button><button class="reject-btn" data-review-table="${kind==="deletions"?DELETE_REQUESTS_TABLE:CORRECTIONS_TABLE}" data-review-id="${x.id}" data-review-status="rejected">Відхилити</button></div></div>`).join(""):'<p class="muted">Немає заявок на розгляді.</p>');
 box.querySelectorAll("[data-review-id]").forEach(btn=>btn.addEventListener("click",async()=>{
  const id=btn.dataset.reviewId,status=btn.dataset.reviewStatus,table=btn.dataset.reviewTable;
  if(kind==="deletions"&&status==="approved"){
   const req=DELETE_REQUESTS.find(x=>String(x.id)===String(id));
   const clinic=allClinics().find(c=>norm(c.clinic)===norm(req?.clinic_name));
   if(clinic){
    try{
     if(clinic._isAdded) await api(`/rest/v1/${CLINICS_TABLE}?id=eq.${clinic.id}`,{method:"DELETE"});
     else await api(`/rest/v1/${VISIBILITY_TABLE}`,{method:"POST",headers:{"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({clinic_name:clinic.clinic,is_hidden:true,updated_by:PROFILE.surname})});
    }catch(err){setStatus(`Не вдалося видалити клініку: ${err.message}`,true);return;}
   }
  }
  await reviewRequest(table,id,status);
 }));
}
async function reloadData(){
 await loadExtra();
 const specs=uniq(allClinics().flatMap(c=>Array.isArray(c.specialties)?c.specialties:[]).concat(EXTRA.map(x=>x.specialty)));
 run();renderAdminWorkspace();
}

function handleCardClick(e){
 const toggle=e.target.closest("[data-toggle-specialties]");
 if(toggle){const panel=$(toggle.getAttribute("aria-controls"));panel.hidden=!panel.hidden;toggle.setAttribute("aria-expanded",String(!panel.hidden));return;}
 const add=e.target.closest("[data-add-specialty]");
 if(add){const clinic=add.dataset.clinic,inputId=add.dataset.input;if(!PROFILE||!SESSION){openAuth(clinic,inputId);return;}addSpecialty(clinic,inputId);return;}
 const del=e.target.closest("[data-delete-specialty]");if(del){deleteSpecialty(Number(del.dataset.id));return;}
 const adminDel=e.target.closest("[data-admin-delete-clinic]");if(adminDel){const c=allClinics().find(x=>x.clinic===adminDel.dataset.adminDeleteClinic);if(c)deleteClinic(c);return;}
 const correction=e.target.closest("[data-propose-correction]");if(correction){proposeCorrection(correction.dataset.clinic,correction.dataset.originalSpecialty);return;}
}
function run(){
 const query=norm($("specialty").value),city=$("city").value,started=!!query||!!city;
 $("resultbar").hidden=!started;$("results").hidden=!started;$("empty").hidden=true;
 if(!started){$("results").innerHTML="";$("summary").textContent="Оберіть місто або введіть спеціальність.";return;}
 filtered=allClinics().map(c=>{const locs=(c.locations||[]).filter(l=>!city||norm(l.city).includes(norm(city)));if(!locs.length)return null;const matching=allSpecs(c).filter(s=>!query||norm(s).includes(query));if(query&&!matching.length)return null;return {...c,matching,shownLocations:locs};}).filter(Boolean);
 $("summary").textContent=`Знайдено клінік: ${filtered.length.toLocaleString("uk-UA")}${query?" за спеціальністю":""}${city?` у місті ${city}`:""}`;
 $("results").innerHTML=filtered.map((c,i)=>renderCard(c,i)).join("");$("empty").hidden=filtered.length>0;
}
function extrasFor(clinic){return EXTRA.filter(x=>norm(x.clinic_name)===norm(clinic));}
function allSpecs(c){return uniq([...(Array.isArray(c.specialties)?c.specialties:[]),...extrasFor(c.clinic).map(x=>x.specialty)]);}
function renderCard(c,i){
 // Прибираємо повтори адрес у межах однієї клініки.
 const uniqueLocations=[...new Map(c.shownLocations.map(l=>{
  const key=[norm(l.address),norm(l.city),norm(l.level)].join("|");
  return [key,l];
 })).values()];
 const locHtml=uniqueLocations.map(l=>`<div class="loc"><p class="address">${esc(l.address||l.city||"Адресу не вказано")}${l.city?`<small>${esc(l.city)}</small>`:""}</p>${l.level?`<span class="level-badge">Рівень клініки: ${esc(l.level)}</span>`:""}</div>`).join("");
 const base=uniq(Array.isArray(c.specialties)?c.specialties:[]),extra=extrasFor(c.clinic),panelId=`specialties-${i}`;
 const correctedFor=s=>CORRECTIONS.find(x=>norm(x.clinic_name)===norm(c.clinic)&&norm(x.original_specialty)===norm(s)&&x.status==="approved");
 const tags=base.map(s=>{const corr=correctedFor(s);return `<div class="specialty-row"><div class="specialty-original">${esc(s)}</div><div class="specialty-corrected">${corr?`<span class="corrected-tag">${esc(corr.corrected_specialty)}</span>`:'<span class="muted">—</span>'}</div><button type="button" class="text-action" data-propose-correction data-clinic="${esc(c.clinic)}" data-original-specialty="${esc(s)}">Запропонувати виправлення</button></div>`;}).join("");
 const primary=c.shownLocations[0],link=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([c.clinic,primary?.address,primary?.city].filter(Boolean).join(", "))}`;
 return `<article class="card"><div class="clinic-card-head"><h3><button class="clinic-title" type="button" data-toggle-specialties aria-controls="${panelId}" aria-expanded="false">${esc(c.clinic)} <span class="clinic-count">(${base.length+extra.length} спеціальностей)</span></button></h3>${PROFILE?.is_admin?`<button class="clinic-delete-admin" type="button" data-admin-delete-clinic="${esc(c.clinic)}">Видалити</button>`:""}</div>${locHtml}<div class="clinic-specialties" id="${panelId}" hidden><div class="specialty-table"><div class="specialty-table-head"><strong>Спеціальність</strong><strong>Скорегована спеціальність</strong><span></span></div>${tags}</div><div class="tags extra-tags">${extra.length?extra.map(x=>`<span class="tag ${x.is_admin?"admin-tag":"user-tag"}" title="Додав: ${esc(x.added_by_surname||"невідомо")}">${esc(x.specialty)} <small>${x.is_admin?"адмін":"додано"} · ${esc(x.added_by_surname||"невідомо")}</small>${PROFILE?.is_admin?` <button class="delete-specialty" type="button" data-delete-specialty data-id="${x.id}" title="Видалити">×</button>`:""}</span>`).join(""):'<span class="muted">Доданих спеціальностей поки немає.</span>'}</div><div class="add-specialty"><input id="new-${i}" maxlength="120" placeholder="Нова спеціальність / послуга"><button type="button" class="add-btn" data-add-specialty data-clinic="${esc(c.clinic)}" data-input="new-${i}">+ Додати спеціальність</button></div></div><div class="links"><a class="google" href="${link}" target="_blank" rel="noopener">Показати адресу в Google Maps ↗</a></div></article>`;
}
async function addSpecialty(clinic,inputId){
 if(!PROFILE||!SESSION){openAuth(clinic,inputId);return;}
 const input=$(inputId),specialty=input?.value.trim();if(!input){setStatus("Поле додавання не знайдено. Відкрийте картку клініки ще раз.",true);return;}
 if(!specialty){setStatus("Введи назву спеціальності.",true);input.focus();return;}
 if(specialty.length>120){setStatus("Максимальна довжина — 120 символів.",true);return;}
 const clinicData=DB.find(c=>norm(c.clinic)===norm(clinic))||{clinic,specialties:[]};
 if(allSpecs(clinicData).some(s=>norm(s)===norm(specialty))){setStatus("Така спеціальність уже є в цій клініці.",true);return;}
 try{
  const rows=await api(`/rest/v1/${TABLE}`,{method:"POST",headers:{"Content-Type":"application/json",Prefer:"return=representation"},body:JSON.stringify({clinic_name:clinic,specialty,added_by_surname:PROFILE.surname,is_admin:!!PROFILE.is_admin,user_id:SESSION.user.id})});
  EXTRA.unshift(...rows);input.value="";setStatus(`«${specialty}» додано до ${clinic}. Автор: ${PROFILE.surname}.`);refreshDatalist();run();
 }catch(e){setStatus(`Не вдалося зберегти: ${e.message}`,true);}
}
async function deleteSpecialty(id){
 if(!PROFILE?.is_admin)return;if(!confirm("Видалити цю додану спеціальність? Дію не можна скасувати."))return;
 try{await api(`/rest/v1/${TABLE}?id=eq.${id}`,{method:"DELETE"});EXTRA=EXTRA.filter(x=>x.id!==id);setStatus("Спеціальність видалено.");refreshDatalist();run();if(!$("addedPanel").hidden)showAdded();}
 catch(e){setStatus(`Не вдалося видалити: ${e.message}`,true);}
}
function refreshDatalist(){}
function showAdded(){
 $("addedPanel").hidden=false;const rows=[...EXTRA].sort((a,b)=>a.clinic_name.localeCompare(b.clinic_name,"uk")||a.specialty.localeCompare(b.specialty,"uk"));
 $("addedSummary").textContent=`Усього додано: ${rows.length}`;
 $("addedList").innerHTML=rows.length?rows.map(x=>`<div class="added-row"><div><strong>${esc(x.clinic_name)}</strong><div class="muted">${esc(x.specialty)}</div><div class="muted">Додав: ${esc(x.added_by_surname||"невідомо")}</div></div><span class="tag ${x.is_admin?"admin-tag":"user-tag"}">${x.is_admin?"Адміністратор":"Користувач"}${PROFILE?.is_admin?` <button class="delete-specialty" type="button" data-delete-specialty data-id="${x.id}">×</button>`:""}</span></div>`).join(""):'<p class="muted">Поки немає доданих спеціальностей.</p>';
}
async function start(){
 try{const d=await fetch("data.json").then(r=>{if(!r.ok)throw Error("Не вдалося завантажити data.json");return r.json();});DB=d;await restoreSession();await loadExtra();init();refreshDatalist();renderAdminWorkspace();}
 catch(e){setStatus(`Помилка запуску: ${e.message}`,true);console.error(e);}
}
start();
