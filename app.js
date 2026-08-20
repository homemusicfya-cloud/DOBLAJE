const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DB_NAME="doblame-db", STORE="scenes";
let db, scenes=[], currentScene=null, currentLine=0, gameTimer=null, recognition=null, transcript="", roundStats={timing:0,words:0,energy:0,combo:0};
const settings={lang:localStorage.getItem("dm_lang")||"es-MX",voiceScore:localStorage.getItem("dm_voice")!=="0",countdown:+(localStorage.getItem("dm_count")||3),auto:localStorage.getItem("dm_auto")!=="0"};

function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:"id"});r.onsuccess=()=>{db=r.result;res(db)};r.onerror=()=>rej(r.error)})}
function id(){return crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random()}
function tx(mode="readonly"){return db.transaction(STORE,mode).objectStore(STORE)}
async function putScene(s){return new Promise((res,rej)=>{const r=tx("readwrite").put(s);r.onsuccess=()=>res(s);r.onerror=()=>rej(r.error)})}
async function delScene(i){return new Promise((res,rej)=>{const r=tx("readwrite").delete(i);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
async function getScenes(){return new Promise((res,rej)=>{const r=tx().getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}

function showView(name){
  $$(".view").forEach(v=>v.classList.remove("active"));
  $("#"+name+"View")?.classList.add("active");
  if(name==="play")renderScenes();
  if(name==="library")renderLibrary();
  window.scrollTo(0,0);
}
$$("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));

function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),2200)}

function parseDialogue(raw){
  return raw.split(/\n/).map(x=>x.trim()).filter(Boolean).map((x,i)=>{
    const p=x.split("|").map(s=>s.trim());
    if(p.length<4) return null;
    const start=parseFloat(p[1]), end=parseFloat(p[2]);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start) return null;
    return {id:i,speaker:p[0],start,end,text:p.slice(3).join("|")};
  }).filter(Boolean).sort((a,b)=>a.start-b.start);
}
function formatDialogue(lines){return lines.map(x=>`${x.speaker} | ${x.start} | ${x.end} | ${x.text}`).join("\n")}

function coverHTML(s){
  return s.cover?`<img src="${s.cover}" alt="">`:"🎬";
}
function renderScenes(filter="Todas"){
  const cats=["Todas",...new Set(scenes.map(s=>s.category))];
  $("#categoryChips").innerHTML=cats.map(c=>`<button class="chip ${c===filter?"active":""}" data-cat="${escapeHTML(c)}">${escapeHTML(c)}</button>`).join("");
  $$("#categoryChips .chip").forEach(b=>b.onclick=()=>renderScenes(b.dataset.cat));
  const list=filter==="Todas"?scenes:scenes.filter(s=>s.category===filter);
  $("#sceneGrid").innerHTML=list.length?list.map(s=>`
    <article class="scene-card" data-id="${s.id}">
      <div class="scene-cover">${coverHTML(s)}</div>
      <div class="scene-meta"><h3>${escapeHTML(s.name)}</h3><p>${escapeHTML(s.category)} · ${s.lines.length} líneas · ${s.duration.toFixed(1)} s</p></div>
    </article>`).join(""):`<div class="card"><h3>No hay escenas en esta categoría.</h3><p class="muted">Crea una escena o carga el ejemplo.</p></div>`;
  $$("#sceneGrid .scene-card").forEach(c=>c.onclick=()=>startGame(scenes.find(s=>s.id===c.dataset.id)));
}
function renderLibrary(){
  $("#libraryList").innerHTML=scenes.length?scenes.map(s=>`
  <div class="library-item"><div class="thumb">${s.cover?`<img src="${s.cover}">`:"🎬"}</div><div class="grow"><h3>${escapeHTML(s.name)}</h3><p>${escapeHTML(s.category)} · ${s.lines.length} diálogos</p></div><button class="primary playLib" data-id="${s.id}">Jugar</button><button class="danger delLib" data-id="${s.id}">Borrar</button></div>`).join(""):`<div class="card"><h3>Biblioteca vacía</h3><p class="muted">Tus escenas importadas aparecerán aquí.</p></div>`;
  $$(".playLib").forEach(b=>b.onclick=()=>startGame(scenes.find(s=>s.id===b.dataset.id)));
  $$(".delLib").forEach(b=>b.onclick=async()=>{if(confirm("¿Borrar esta escena?")){await delScene(b.dataset.id);scenes=await getScenes();renderLibrary();toast("Escena borrada")}})
}

function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

async function mediaToDataURL(file){
  if(!file)return null;
  return await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)})
}
$("#mediaFile").addEventListener("change",async e=>{
  const f=e.target.files[0], p=$("#mediaPreview"); if(!f){p.textContent="Selecciona un archivo para previsualizarlo.";return}
  const url=URL.createObjectURL(f);
  p.innerHTML=f.type.startsWith("image/")?`<img src="${url}">`:f.type.startsWith("video/")?`<video src="${url}" controls></video>`:`🎵 ${escapeHTML(f.name)}`;
});
$("#sceneForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const media=$("#mediaFile").files[0], cover=$("#coverFile").files[0], lines=parseDialogue($("#dialogueInput").value);
  if(!media||!lines.length){toast("Necesitas un archivo y al menos una línea válida.");return}
  const scene={id:id(),name:$("#sceneName").value.trim(),category:$("#sceneCategory").value,mode:$("#sceneMode").value,
    media:await mediaToDataURL(media),cover:await mediaToDataURL(cover),lines,duration:Math.max(...lines.map(x=>x.end)),created:Date.now()};
  await putScene(scene);scenes=await getScenes();toast("Escena guardada");$("#sceneForm").reset();$("#mediaPreview").textContent="Selecciona un archivo para previsualizarlo.";showView("play");
});
$("#clearForm").onclick=()=>{$("#sceneForm").reset();$("#mediaPreview").textContent="Selecciona un archivo para previsualizarlo."}
$("#loadDemo").onclick=()=>{
  $("#sceneName").value="La escena imposible";$("#sceneCategory").value="Comedia";$("#sceneMode").value="image";
  $("#dialogueInput").value=`ALEX | 0 | 3 | ¿Quién dejó esto aquí?
SAM | 3 | 6 | Yo no fui.
ALEX | 6 | 9 | Claro... y yo soy astronauta.
SAM | 9 | 12 | ¡Pues felicidades!`;
  toast("Ejemplo cargado. Añade tu archivo multimedia y guarda.");
}

function setupMedia(s){
  ["sceneVideo","sceneImage","sceneAudio"].forEach(x=>{$("#"+x).classList.add("hidden");$("#"+x).pause?.()});
  if(s.mode==="video"){$("#sceneVideo").src=s.media;$("#sceneVideo").classList.remove("hidden")}
  else if(s.mode==="image"){$("#sceneImage").src=s.media;$("#sceneImage").classList.remove("hidden")}
  else{$("#sceneAudio").src=s.media;$("#sceneAudio").classList.remove("hidden");$("#sceneAudio").play().catch(()=>{})}
}
function mediaEl(){return currentScene.mode==="video"?$("#sceneVideo"):currentScene.mode==="audio"?$("#sceneAudio"):null}
function stopMedia(){try{mediaEl()?.pause()}catch{}}

async function startGame(s){
  if(!s)return; currentScene=s;currentLine=0;transcript="";roundStats={timing:0,words:0,energy:0,combo:0};
  $("#gameTitle").textContent=s.name;$("#score").textContent="0";$("#stageEmpty").classList.add("hidden");setupMedia(s);
  showView("game");renderLine();
  if(settings.countdown) await countdown(settings.countdown);
  startMic();
  $("#startRound").textContent="⏸️ PAUSAR";
  playFromStart();
}
function countdown(n){return new Promise(res=>{const c=$("#countdown");c.classList.remove("hidden");let x=n;c.textContent=x;const t=setInterval(()=>{x--;if(x<=0){clearInterval(t);c.classList.add("hidden");res()}else c.textContent=x},1000)})}
function playFromStart(){const m=mediaEl();if(m){m.currentTime=0;m.play().catch(()=>{})} currentLine=0;renderLine();startClock()}
function startClock(){
  clearInterval(gameTimer);gameTimer=setInterval(()=>{
    const m=mediaEl(), t=m?m.currentTime:performance.now()/1000;
    const line=currentScene.lines[currentLine]; if(!line)return;
    const pct=Math.max(0,Math.min(100,(t-line.start)/(line.end-line.start)*100));$("#lineProgress").style.width=pct+"%";$("#timerText").textContent=Math.max(0,t-line.start).toFixed(1)+" s";
    if(t>=line.end){scoreLine();if(currentLine<currentScene.lines.length-1){currentLine++;renderLine()}else finishGame()}
  },50);
}
function renderLine(){
  const l=currentScene.lines[currentLine];if(!l)return;
  $("#roundLabel").textContent=`DIÁLOGO ${currentLine+1} / ${currentScene.lines.length}`;
  $("#speakerBadge").textContent=l.speaker.toUpperCase();$("#dialogueText").textContent=l.text;
  $("#translationText").textContent="";$("#lineProgress").style.width="0%";
}
function normalize(s){return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\p{L}\p{N}\s]/gu,"").trim()}
function wordAccuracy(target,said){
  const a=normalize(target).split(/\s+/).filter(Boolean),b=normalize(said).split(/\s+/).filter(Boolean);if(!a.length)return 1;
  let hits=0;const used=new Set();for(const w of a){const j=b.findIndex((x,i)=>!used.has(i)&&(x===w||x.includes(w)||w.includes(x)));if(j>=0){used.add(j);hits++}}
  return hits/a.length;
}
function scoreLine(){
  const l=currentScene.lines[currentLine], m=mediaEl(), t=m?m.currentTime:l.end;
  const timing=Math.max(0,1-Math.abs((t-l.end))/.9), words=settings.voiceScore?wordAccuracy(l.text,transcript):.7;
  const energy=micEnergy;
  const lineScore=Math.round(10000/currentScene.lines.length*(.4*timing+.45*words+.15*energy));
  roundStats.timing+=timing;roundStats.words+=words;roundStats.energy+=energy;
  roundStats.combo=words>.75?roundStats.combo+1:0;
  const newScore=+$("#score").textContent+lineScore;$("#score").textContent=newScore;$("#transcript").textContent=transcript?`Escuché: “${transcript}”`:"(No se detectó voz)";
  transcript="";
}
function finishGame(){
  clearInterval(gameTimer);stopMedia();stopMic();
  const n=currentScene.lines.length||1, timing=Math.round(roundStats.timing/n*100), words=Math.round(roundStats.words/n*100), energy=Math.round(roundStats.energy/n*100);
  $("#finalScore").textContent=Number($("#score").textContent).toLocaleString("es-MX");$("#timingStat").textContent=timing+"%";$("#wordStat").textContent=words+"%";$("#energyStat").textContent=energy+"%";$("#comboStat").textContent=roundStats.combo+"×";
  $("#rating").textContent="★".repeat(Math.max(1,Math.min(5,Math.ceil(+$("#score").textContent/2000))))+"☆".repeat(5-Math.ceil(+$("#score").textContent/2000));
  showView("results");
}
$("#againBtn").onclick=()=>startGame(currentScene);
$("#quitGame").onclick=()=>{clearInterval(gameTimer);stopMedia();stopMic();showView("play")};
$("#prevLine").onclick=()=>{if(currentLine>0){currentLine--;seekLine()}};
$("#nextLine").onclick=()=>{if(currentLine<currentScene.lines.length-1){currentLine++;seekLine()}};
function seekLine(){const l=currentScene.lines[currentLine],m=mediaEl();if(m)m.currentTime=l.start;renderLine();transcript=""}

let micStream=null,micAudio=null,micEnergy=0;
function startMic(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!navigator.mediaDevices?.getUserMedia){$("#micText").textContent="Micrófono no disponible";return}
  navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{
    micStream=stream;$("#micText").textContent="Micrófono activo";$("#mic-state")?.classList.add("on");$(".mic-state").classList.add("on");
    micAudio=new (window.AudioContext||window.webkitAudioContext)();const src=micAudio.createMediaStreamSource(stream),an=micAudio.createAnalyser();an.fftSize=256;src.connect(an);const data=new Uint8Array(an.frequencyBinCount);
    const meter=()=>{if(!micStream)return;an.getByteTimeDomainData(data);let sum=0;for(const v of data){const x=(v-128)/128;sum+=x*x}micEnergy=Math.min(1,Math.sqrt(sum/data.length)*5);requestAnimationFrame(meter)};meter();
  }).catch(()=>{$("#micText").textContent="Permiso de micrófono rechazado";toast("Activa el permiso del micrófono para puntuar tu voz.")});
  if(SR){
    try{recognition=new SR();recognition.lang=settings.lang;recognition.continuous=true;recognition.interimResults=true;
      recognition.onresult=e=>{let s="";for(let i=e.resultIndex;i<e.results.length;i++)s+=e.results[i][0].transcript+" ";transcript=s.trim()};
      recognition.onerror=()=>{};recognition.onend=()=>{if(micStream)try{recognition.start()}catch{}};recognition.start();
    }catch{}
  }
}
function stopMic(){if(recognition)try{recognition.stop()}catch{};recognition=null;if(micStream){micStream.getTracks().forEach(t=>t.stop());micStream=null}if(micAudio)micAudio.close().catch(()=>{});micAudio=null;$(".mic-state")?.classList.remove("on");$("#micText").textContent="Micrófono apagado";micEnergy=0}

$("#voiceLang").value=settings.lang;$("#voiceScoring").checked=settings.voiceScore;$("#countdownSetting").value=settings.countdown;$("#autoAdvance").checked=settings.auto;
$("#voiceLang").onchange=e=>{settings.lang=e.target.value;localStorage.setItem("dm_lang",settings.lang)}
$("#voiceScoring").onchange=e=>{settings.voiceScore=e.target.checked;localStorage.setItem("dm_voice",settings.voiceScore?"1":"0")}
$("#countdownSetting").onchange=e=>{settings.countdown=+e.target.value;localStorage.setItem("dm_count",settings.countdown)}
$("#autoAdvance").onchange=e=>{settings.auto=e.target.checked;localStorage.setItem("dm_auto",settings.auto)}
$("#wipeData").onclick=async()=>{if(confirm("¿Borrar todas tus escenas?")){await new Promise((res,rej)=>{const r=tx("readwrite").clear();r.onsuccess=res;r.onerror=rej});scenes=[];renderLibrary();toast("Biblioteca borrada")}}

document.addEventListener("keydown",e=>{
  if(!$("#gameView").classList.contains("active"))return;
  if(e.code==="Space"){e.preventDefault();const m=mediaEl();if(m?.paused)m.play();else m?.pause()}
  if(e.key==="ArrowLeft")$("#prevLine").click();if(e.key==="ArrowRight")$("#nextLine").click();
});
async function init(){
  await openDB();scenes=await getScenes();
  if(!scenes.length)await createBuiltIn();
  scenes=await getScenes();renderScenes();
}
async function createBuiltIn(){
  // No copyrighted media is bundled. The built-in scene is a template with a generated poster.
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="100%" height="100%" fill="#160909"/><text x="50%" y="45%" fill="white" font-size="72" font-family="Arial" text-anchor="middle">DOBLA-ME</text><text x="50%" y="58%" fill="#e50914" font-size="30" font-family="Arial" text-anchor="middle">ESCENA DE PRUEBA</text></svg>`;
  const cover="data:image/svg+xml;base64,"+btoa(svg);
  await putScene({id:"demo",name:"Prueba de doblaje",category:"Comedia",mode:"image",media:cover,cover,duration:12,created:Date.now(),
    lines:[{id:0,speaker:"ALEX",start:0,end:3,text:"¿Quién está listo para doblar?"},{id:1,speaker:"SAM",start:3,end:6,text:"¡Yo! Pero necesito mi voz de estrella."},{id:2,speaker:"ALEX",start:6,end:9,text:"Entonces que empiece el espectáculo."},{id:3,speaker:"SAM",start:9,end:12,text:"¡Cámara, micrófono y acción!"}]});
}
init().catch(e=>{console.error(e);toast("No se pudo iniciar la biblioteca")});
