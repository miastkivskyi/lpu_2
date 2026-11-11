const MAP_ID="1K7NXAhGSko0ppMx1Adt0ZRHnEi_jNCM";
const MAP_BASE=`https://www.google.com/maps/d/u/1/view?mid=${MAP_ID}&usp=sharing`;
const $=id=>document.getElementById(id);let DB=[],filtered=[];
const norm=s=>String(s||"").toLocaleLowerCase("uk").normalize("NFC").replace(/[’‘`]/g,"'").replace(/\s+/g," ").trim();
const uniq=a=>[...new Set(a.filter(Boolean))].sort((a,b)=>a.localeCompare(b,"uk"));
function esc(v){return String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));}
function uniqueLocations(locations=[]){const seen=new Set();return locations.filter(l=>{const k=[norm(l.address),norm(l.city),norm(l.level)].join("|");if(seen.has(k))return false;seen.add(k);return true;});}
function googleLink(c,l){const q=[c.clinic,l?.address,l?.city].filter(Boolean).join(", ");return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;}
function init(){
 const specs=uniq(DB.flatMap(c=>Array.isArray(c.specialties)?c.specialties:[]));
 $("specialties").innerHTML=specs.map(s=>`<option value="${esc(s)}"></option>`).join("");
 const cities=uniq(DB.flatMap(c=>(c.locations||[]).map(l=>l.city)));
 $("city").innerHTML='<option value="">Усі міста</option>'+cities.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
 $("specialty").addEventListener("input",run);
 $("city").addEventListener("change",run);
 $("clear").addEventListener("click",()=>{$("specialty").value="";$("city").value="";run();});
 // Кнопки showMap немає в index.html, тому обробник не потрібен.
 $("results").addEventListener("click",e=>{
   const btn=e.target.closest("[data-toggle-specialties]");if(!btn)return;
   const panel=$(btn.getAttribute("aria-controls"));const opening=panel.hidden;
   panel.hidden=!opening;btn.setAttribute("aria-expanded",String(opening));
   btn.setAttribute("aria-label",opening?"Сховати спеціальності":"Показати всі спеціальності");
 });
 run();
}
function run(){
 const query=norm($("specialty").value),city=$("city").value;
 const started=!!query||!!city;
 $("resultbar").hidden=!started;$("results").hidden=!started;$("empty").hidden=true;
 if(!started){$("results").innerHTML="";$("summary").textContent="Оберіть місто або введіть спеціальність.";return;}
 filtered=DB.map(c=>{
   const locs=uniqueLocations(c.locations||[]).filter(l=>!city||l.city===city);
   if(!locs.length)return null;
   const allSpecs=Array.isArray(c.specialties)?c.specialties:[];
   const matching=allSpecs.filter(s=>!query||norm(s).includes(query));
   if(query&&!matching.length)return null;
   return {...c,matching,shownLocations:locs};
 }).filter(Boolean);
 $("summary").textContent=`Знайдено клінік: ${filtered.length.toLocaleString("uk-UA")}${query?" за спеціальністю":""}${city?` у місті ${city}`:""}`;
 $("results").innerHTML=filtered.map((c,i)=>renderCard(c,i)).join("");
 $("empty").hidden=filtered.length>0;
}
function renderCard(c,i){
 const locHtml=c.shownLocations.map(l=>`<div class="loc"><p class="address">${esc(l.address||l.city||"Адресу не вказано")}${l.city?`<small>${esc(l.city)}</small>`:""}</p>${l.level?`<span class="level-badge">Рівень клініки: ${esc(l.level)}</span>`:""}</div>`).join("");
 const allSpecs=uniq(Array.isArray(c.specialties)?c.specialties:[]);
 const panelId=`specialties-${i}`;
 const specsHtml=allSpecs.length?allSpecs.map(s=>`<span class="tag">${esc(s)}</span>`).join(""):'<span class="muted">Спеціальності не вказані.</span>';
 const primary=c.shownLocations[0];const link=googleLink(c,primary);
 return `<article class="card"><h3><button class="clinic-title" type="button" data-toggle-specialties aria-controls="${panelId}" aria-expanded="false">${esc(c.clinic)} <span class="clinic-count">(${allSpecs.length} спеціальностей)</span></button></h3>${locHtml}<div class="clinic-specialties" id="${panelId}" hidden><div class="tags">${specsHtml}</div></div><div class="links"><a class="google" href="${link}" target="_blank" rel="noopener">Показати адресу в Google Maps ↗</a></div></article>`;
}
fetch("data.json").then(r=>{if(!r.ok)throw Error("Не вдалося завантажити data.json");return r.json();}).then(d=>{DB=d;init();}).catch(e=>{$("summary").textContent=e.message;console.error(e);});
