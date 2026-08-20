(() => {
"use strict";

/* =========================
   UTILIDADES
========================= */
const $ = id => document.getElementById(id);
const $$ = selector => Array.from(document.querySelectorAll(selector));

const DB_NAME = "doblame-v2";
const STORE = "scenes";

let db = null;
let scenes = [];
let currentScene = null;
let currentLine = 0;
let timer = null;
let recognition = null;
let micStream = null;
let audioContext = null;
let micEnergy = 0;
let spokenText = "";
let scoreData = {timing:0,words:0,energy:0,combo:0};

const settings = {
  lang: localStorage.getItem("dm-lang") || "es-MX",
  voice: localStorage.getItem("dm-voice") !== "0",
  count: Number(localStorage.getItem("dm-count") || 3)
};

function toast(text){
  const t=$("toast");
  t.textContent=text;
  t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"),2200);
}

function esc(text){
  return String(text).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

function newId(){
  return crypto.randomUUID ? crypto.randomUUID() : Date.now()+"-"+Math.random();
}

/* =========================
   BASE DE DATOS
========================= */
function openDB(){
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,1);
    r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:"id"});
    r.onsuccess=()=>{db=r.result;resolve()};
    r.onerror=()=>reject(r.error);
  });
}

function store(mode="readonly"){
  return db.transaction(STORE,mode).objectStore(STORE);
}

function saveScene(scene){
  return new Promise((resolve,reject)=>{
    const r=store("readwrite").put(scene);
    r.onsuccess=()=>resolve();
    r.onerror=()=>reject(r.error);
  });
}

function loadScenes(){
  return new Promise((resolve,reject)=>{
    const r=store().getAll();
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>reject(r.error);
  });
}

function removeScene(id){
  return new Promise((resolve,reject)=>{
    const r=store("readwrite").delete(id);
    r.onsuccess=()=>resolve();
    r.onerror=()=>reject(r.error);
  });
}

/* =========================
   NAVEGACIÓN
========================= */
function view(name){
  $$(".view").forEach(x=>x.classList.remove("active"));
  const target=$(name+"View");
  if(target) target.classList.add("active");

  if(name==="play") renderScenes();
  if(name==="library") renderLibrary();

  window.scrollTo(0,0);
}

$$("[data-view]").forEach(button=>{
  button.addEventListener("click",()=>view(button.dataset.view));
});

$("homeBtn").addEventListener("click",()=>view("home"));

/* =========================
   ESCENAS
========================= */
function parseLines(text){
  return text.split(/\r?\n/)
    .map(x=>x.trim())
    .filter(Boolean)
    .map((line,i)=>{
      const p=line.split("|").map(x=>x.trim());
      if(p.length<4) return null;

      const start=Number(p[1]);
      const end=Number(p[2]);

      if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start) return null;

      return {
        id:i,
        speaker:p[0],
        start,
        end,
        text:p.slice(3).join("|")
      };
    })
    .filter(Boolean)
    .sort((a,b)=>a.start-b.start);
}

function renderScenes(category="Todas"){
  const cats=["Todas",...new Set(scenes.map(x=>x.category))];

  $("filters").innerHTML=cats.map(c=>
    `<button class="filter ${c===category?"active":""}" data-cat="${esc(c)}">${esc(c)}</button>`
  ).join("");

  $$(".filter").forEach(b=>b.onclick=()=>renderScenes(b.dataset.cat));

  const list=category==="Todas" ? scenes : scenes.filter(x=>x.category===category);

  if(!list.length){
    $("sceneGrid").innerHTML=`<div class="libraryEmpty">No hay escenas. Crea una desde <b>Crear</b>.</div>`;
    return;
  }

  $("sceneGrid").innerHTML=list.map(s=>`
    <article class="scene" data-id="${s.id}">
      <div class="cover">${s.cover?`<img src="${s.cover}">`:"🎬"}</div>
      <div class="meta">
        <h3>${esc(s.name)}</h3>
        <p>${esc(s.category)} · ${s.lines.length} diálogos · ${s.duration.toFixed(1)} s</p>
      </div>
    </article>
  `).join("");

  $$(".scene").forEach(card=>{
    card.onclick=()=>{
      const s=scenes.find(x=>x.id===card.dataset.id);
      startGame(s);
    };
  });
}

function renderLibrary(){
  if(!scenes.length){
    $("library").innerHTML=`<div class="libraryEmpty">Tu biblioteca está vacía.</div>`;
    return;
  }

  $("library").innerHTML=scenes.map(s=>`
    <div class="libraryItem">
      <div class="thumb">${s.cover?`<img src="${s.cover}">`:"🎬"}</div>
      <div class="grow"><h3>${esc(s.name)}</h3><p>${esc(s.category)} · ${s.lines.length} diálogos</p></div>
      <button class="primary play" data-id="${s.id}">Jugar</button>
      <button class="danger del" data-id="${s.id}">Borrar</button>
    </div>
  `).join("");

  $$(".play").forEach(b=>b.onclick=()=>{
    startGame(scenes.find(s=>s.id===b.dataset.id));
  });

  $$(".del").forEach(b=>b.onclick=async()=>{
    if(!confirm("¿Borrar esta escena?")) return;
    await removeScene(b.dataset.id);
    scenes=await loadScenes();
    renderLibrary();
    toast("Escena borrada");
  });
}

/* =========================
   ARCHIVOS
========================= */
function fileData(file){
  return new Promise((resolve,reject)=>{
    if(!file){resolve(null);return;}
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}

$("mediaFile").addEventListener("change",()=>{
  const f=$("mediaFile").files[0];
  const p=$("preview");

  if(!f){
    p.textContent="Aquí aparecerá la vista previa.";
    return;
  }

  const url=URL.createObjectURL(f);

  if(f.type.startsWith("video/")){
    p.innerHTML=`<video src="${url}" controls playsinline preload="metadata"></video>`;
  }else if(f.type.startsWith("image/")){
    p.innerHTML=`<img src="${url}" alt="">`;
  }else if(f.type.startsWith("audio/")){
    p.innerHTML=`<audio src="${url}" controls></audio>`;
  }
});

/* =========================
   CREAR ESCENA
========================= */
$("sceneForm").addEventListener("submit",async e=>{
  e.preventDefault();

  const file=$("mediaFile").files[0];
  const cover=$("coverFile").files[0];
  const lines=parseLines($("dialogues").value);

  if(!file){
    toast("Selecciona un archivo multimedia.");
    return;
  }

  if(!lines.length){
    toast("Escribe al menos un diálogo válido.");
    return;
  }

  let mode="image";
  if(file.type.startsWith("video/")) mode="video";
  else if(file.type.startsWith("audio/")) mode="audio";

  const scene={
    id:newId(),
    name:$("name").value.trim(),
    category:$("category").value,
    mode,
    media:await fileData(file),
    cover:await fileData(cover),
    lines,
    duration:Math.max(...lines.map(x=>x.end)),
    created:Date.now()
  };

  try{
    await saveScene(scene);
    scenes=await loadScenes();
    e.target.reset();
    $("preview").textContent="Aquí aparecerá la vista previa.";
    toast("Escena guardada correctamente.");
    view("play");
  }catch(err){
    console.error(err);
    toast("No se pudo guardar la escena.");
  }
});

$("clearBtn").addEventListener("click",()=>{
  $("sceneForm").reset();
  $("preview").textContent="Aquí aparecerá la vista previa.";
});

$("demoBtn").addEventListener("click",()=>{
  $("name").value="La escena imposible";
  $("category").value="Comedia";
  $("dialogues").value=
`ALEX | 0 | 3 | ¿Quién está listo para doblar?
SAM | 3 | 6 | ¡Yo! Pero necesito mi voz de estrella.
ALEX | 6 | 9 | Entonces que empiece el espectáculo.
SAM | 9 | 12 | ¡Cámara, micrófono y acción!`;
  toast("Ejemplo cargado. Ahora selecciona tu video.");
});

/* =========================
   MULTIMEDIA
========================= */
function mediaElement(){
  if(!currentScene) return null;
  if(currentScene.mode==="video") return $("video");
  if(currentScene.mode==="audio") return $("audio");
  return null;
}

function setupMedia(scene){
  const video=$("video");
  const image=$("image");
  const audio=$("audio");

  video.pause();
  audio.pause();

  video.removeAttribute("src");
  audio.removeAttribute("src");
  image.removeAttribute("src");

  video.classList.add("hidden");
  image.classList.add("hidden");
  audio.classList.add("hidden");

  $("stageMessage").classList.remove("hidden");

  if(scene.mode==="video"){
    video.src=scene.media;
    video.load();
    video.classList.remove("hidden");
    $("stageMessage").classList.add("hidden");
  }else if(scene.mode==="image"){
    image.src=scene.media;
    image.classList.remove("hidden");
    $("stageMessage").classList.add("hidden");
  }else{
    audio.src=scene.media;
    audio.load();
    audio.classList.remove("hidden");
    $("stageMessage").textContent="Audio listo";
  }
}

function waitVideo(video){
  return new Promise(resolve=>{
    if(video.readyState>=2 && Number.isFinite(video.duration)){
      resolve();
      return;
    }

    const done=()=>{
      video.removeEventListener("loadedmetadata",done);
      video.removeEventListener("canplay",done);
      resolve();
    };

    video.addEventListener("loadedmetadata",done,{once:true});
    video.addEventListener("canplay",done,{once:true});
    setTimeout(resolve,5000);
  });
}

/* =========================
   JUEGO
========================= */
async function startGame(scene){
  if(!scene) return;

  stopGame();

  currentScene=scene;
  currentLine=0;
  spokenText="";
  scoreData={timing:0,words:0,energy:0,combo:0};

  $("gameTitle").textContent=scene.name;
  $("score").textContent="0";

  setupMedia(scene);
  view("game");
  renderLine();

  const media=mediaElement();

  if(media && scene.mode==="video"){
    try{
      await waitVideo(media);
      media.currentTime=0;
    }catch(err){
      console.error(err);
    }
  }

  if(settings.count>0){
    await doCountdown(settings.count);
  }

  startMicrophone();
  playScene();
}

function doCountdown(n){
  return new Promise(resolve=>{
    const el=$("countdown");
    el.classList.remove("hidden");
    let x=n;
    el.textContent=x;

    const t=setInterval(()=>{
      x--;
      if(x<=0){
        clearInterval(t);
        el.classList.add("hidden");
        resolve();
      }else{
        el.textContent=x;
      }
    },1000);
  });
}

function playScene(){
  const media=mediaElement();

  if(media){
    media.currentTime=0;

    /*
      NO forzamos muted.
      El usuario ya inició la partida pulsando
      un botón, por lo que el navegador permite
      la reproducción con sonido.
    */

    const p=media.play();

    if(p) p.catch(err=>{
      console.error("play()",err);
      toast("Pulsa el botón ▶ del video para iniciar.");
    });
  }

  currentLine=0;
  renderLine();
  startTimer();
}

function startTimer(){
  clearInterval(timer);

  timer=setInterval(()=>{
    if(!currentScene) return;

    const line=currentScene.lines[currentLine];
    if(!line) return;

    const media=mediaElement();
    const time=media ? media.currentTime : line.start;

    const progress=Math.max(
      0,
      Math.min(
        100,
        ((time-line.start)/(line.end-line.start))*100
      )
    );

    $("bar").style.width=progress+"%";
    $("time").textContent=Math.max(0,time-line.start).toFixed(1)+" s";

    if(time>=line.end){
      scoreCurrentLine();

      if(currentLine<currentScene.lines.length-1){
        currentLine++;
        renderLine();
      }else{
        finishGame();
      }
    }
  },50);
}

function renderLine(){
  const line=currentScene?.lines[currentLine];
  if(!line) return;

  $("roundLabel").textContent=
    `DIÁLOGO ${currentLine+1} / ${currentScene.lines.length}`;

  $("speaker").textContent=line.speaker.toUpperCase();
  $("dialogue").textContent=line.text;
  $("bar").style.width="0%";
  $("time").textContent="0.0 s";
}

/* =========================
   PUNTUACIÓN
========================= */
function clean(text){
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^\p{L}\p{N}\s]/gu,"")
    .trim();
}

function accuracy(target,spoken){
  const a=clean(target).split(/\s+/).filter(Boolean);
  const b=clean(spoken).split(/\s+/).filter(Boolean);

  if(!a.length) return 1;

  let hits=0;
  const used=new Set();

  a.forEach(word=>{
    const i=b.findIndex((x,n)=>
      !used.has(n) &&
      (x===word || x.includes(word) || word.includes(x))
    );

    if(i>=0){
      used.add(i);
      hits++;
    }
  });

  return hits/a.length;
}

function scoreCurrentLine(){
  const line=currentScene.lines[currentLine];
  const media=mediaElement();

  const now=media ? media.currentTime : line.end;
  const timing=Math.max(
    0,
    1-Math.abs(now-line.end)/1
  );

  const words=settings.voice
    ? accuracy(line.text,spokenText)
    : .7;

  const energy=micEnergy;

  scoreData.timing+=timing;
  scoreData.words+=words;
  scoreData.energy+=energy;

  if(words>=.75) scoreData.combo++;
  else scoreData.combo=0;

  const points=Math.round(
    (10000/currentScene.lines.length) *
    (timing*.4 + words*.45 + energy*.15)
  );

  $("score").textContent=
    Number($("score").textContent)+points;

  $("heard").textContent=
    spokenText
      ? `Escuché: "${spokenText}"`
      : "No se detectó voz.";

  spokenText="";
}

function finishGame(){
  clearInterval(timer);
  stopMedia();
  stopMicrophone();

  const n=currentScene.lines.length||1;
  const timing=Math.round(scoreData.timing/n*100);
  const words=Math.round(scoreData.words/n*100);
  const energy=Math.round(scoreData.energy/n*100);
  const score=Number($("score").textContent);

  $("finalScore").textContent=score.toLocaleString("es-MX");
  $("timing").textContent=timing+"%";
  $("words").textContent=words+"%";
  $("energy").textContent=energy+"%";
  $("combo").textContent=scoreData.combo+"×";

  const stars=Math.max(1,Math.min(5,Math.ceil(score/2000)));
  $("stars").textContent="★".repeat(stars)+"☆".repeat(5-stars);

  view("results");
}

/* =========================
   BOTONES DEL JUEGO
========================= */
$("quitBtn").addEventListener("click",()=>{
  stopGame();
  view("play");
});

$("againBtn").addEventListener("click",()=>{
  startGame(currentScene);
});

$("prevBtn").addEventListener("click",()=>{
  if(!currentScene || currentLine<=0) return;
  currentLine--;
  seekLine();
});

$("nextBtn").addEventListener("click",()=>{
  if(!currentScene || currentLine>=currentScene.lines.length-1) return;
  currentLine++;
  seekLine();
});

$("startBtn").addEventListener("click",async()=>{
  const media=mediaElement();

  if(!media){
    toast("Esta escena no tiene reproducción temporal.");
    return;
  }

  if(media.paused){
    try{
      await media.play();
      $("startBtn").textContent="⏸️ PAUSAR";
    }catch(err){
      console.error(err);
      toast("El navegador bloqueó la reproducción.");
    }
  }else{
    media.pause();
    $("startBtn").textContent="▶ CONTINUAR";
  }
});

function seekLine(){
  const line=currentScene.lines[currentLine];
  const media=mediaElement();

  if(media) media.currentTime=line.start;

  spokenText="";
  renderLine();
}

/* =========================
   MICRÓFONO
========================= */
async function startMicrophone(){
  if(!navigator.mediaDevices?.getUserMedia){
    $("micText").textContent="Micrófono no disponible";
    return;
  }

  try{
    micStream=await navigator.mediaDevices.getUserMedia({audio:true});

    $("micText").textContent="Micrófono activo";
    $(".mic").classList.add("on");

    const AC=window.AudioContext||window.webkitAudioContext;

    if(AC){
      audioContext=new AC();

      const source=audioContext.createMediaStreamSource(micStream);
      const analyser=audioContext.createAnalyser();

      analyser.fftSize=256;
      source.connect(analyser);

      const data=new Uint8Array(analyser.frequencyBinCount);

      const measure=()=>{
        if(!micStream) return;

        analyser.getByteTimeDomainData(data);

        let sum=0;

        for(const value of data){
          const x=(value-128)/128;
          sum+=x*x;
        }

        micEnergy=Math.min(
          1,
          Math.sqrt(sum/data.length)*5
        );

        requestAnimationFrame(measure);
      };

      measure();
    }

    setupSpeechRecognition();

  }catch(err){
    console.error(err);
    $("micText").textContent="Micrófono bloqueado";
    toast("Permite el micrófono para puntuar tu voz.");
  }
}

function setupSpeechRecognition(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;

  if(!SR){
    $("micText").textContent="Micrófono activo";
    return;
  }

  try{
    recognition=new SR();
    recognition.lang=settings.lang;
    recognition.continuous=true;
    recognition.interimResults=true;

    recognition.onresult=e=>{
      let text="";

      for(let i=e.resultIndex;i<e.results.length;i++){
        text+=e.results[i][0].transcript+" ";
      }

      spokenText=text.trim();
    };

    recognition.onerror=e=>{
      console.log("Reconocimiento:",e.error);
    };

    recognition.onend=()=>{
      if(micStream){
        try{recognition.start()}catch{}
      }
    };

    recognition.start();
  }catch(err){
    console.log(err);
  }
}

function stopMicrophone(){
  if(recognition){
    try{recognition.stop()}catch{}
    recognition=null;
  }

  if(micStream){
    micStream.getTracks().forEach(t=>t.stop());
    micStream=null;
  }

  if(audioContext){
    audioContext.close().catch(()=>{});
    audioContext=null;
  }

  $(".mic").classList.remove("on");
  $("micText").textContent="Micrófono apagado";
  micEnergy=0;
}

function stopMedia(){
  const media=mediaElement();
  if(media){
    try{media.pause()}catch{}
  }
}

function stopGame(){
  clearInterval(timer);
  stopMedia();
  stopMicrophone();
}

/* =========================
   AJUSTES
========================= */
$("lang").value=settings.lang;
$("voiceScore").checked=settings.voice;
$("count").value=String(settings.count);

$("lang").addEventListener("change",e=>{
  settings.lang=e.target.value;
  localStorage.setItem("dm-lang",settings.lang);
});

$("voiceScore").addEventListener("change",e=>{
  settings.voice=e.target.checked;
  localStorage.setItem("dm-voice",e.target.checked?"1":"0");
});

$("count").addEventListener("change",e=>{
  settings.count=Number(e.target.value);
  localStorage.setItem("dm-count",settings.count);
});

$("deleteAll").addEventListener("click",async()=>{
  if(!confirm("¿Borrar todas tus escenas?")) return;

  await new Promise((resolve,reject)=>{
    const r=store("readwrite").clear();
    r.onsuccess=resolve;
    r.onerror=reject;
  });

  scenes=[];
  renderLibrary();
  toast("Biblioteca borrada.");
});

/* =========================
   TECLADO
========================= */
document.addEventListener("keydown",e=>{
  if(!$("gameView").classList.contains("active")) return;

  if(e.key==="ArrowLeft") $("prevBtn").click();
  if(e.key==="ArrowRight") $("nextBtn").click();

  if(e.code==="Space"){
    e.preventDefault();
    $("startBtn").click();
  }
});

/* =========================
   INICIO
========================= */
async function init(){
  try{
    await openDB();
    scenes=await loadScenes();

    renderScenes();
    renderLibrary();

    console.log("DOBLA-ME iniciado correctamente.");
  }catch(err){
    console.error(err);
    toast("Error iniciando la aplicación.");
  }
}

init();

})();