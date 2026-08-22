app.js — DOBLA-ME

(() => {
"use strict";

/* =========================================================
   UTILIDADES
========================================================= */

const $ = id => document.getElementById(id);
const $$ = selector => Array.from(document.querySelectorAll(selector));

const DB_NAME = "doblame-v3";
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

let gameStarted = false;

let scoreData = {
  timing: 0,
  words: 0,
  energy: 0,
  combo: 0
};

const settings = {
  lang: localStorage.getItem("dm-lang") || "es-MX",
  voice: localStorage.getItem("dm-voice") !== "0",
  count: Number(localStorage.getItem("dm-count") || 3)
};


/* =========================================================
   MENSAJES
========================================================= */

function toast(text) {
  const t = $("toast");

  if (!t) return;

  t.textContent = text;
  t.classList.add("show");

  setTimeout(() => {
    t.classList.remove("show");
  }, 2200);
}


/* =========================================================
   SEGURIDAD HTML
========================================================= */

function esc(text) {
  return String(text).replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c])
  );
}


/* =========================================================
   ID
========================================================= */

function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now() + "-" + Math.random();
}


/* =========================================================
   BASE DE DATOS
========================================================= */

function openDB() {
  return new Promise((resolve, reject) => {

    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {

      const database = request.result;

      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, {
          keyPath: "id"
        });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}


function store(mode = "readonly") {
  return db
    .transaction(STORE, mode)
    .objectStore(STORE);
}


function saveScene(scene) {

  return new Promise((resolve, reject) => {

    const request = store("readwrite").put(scene);

    request.onsuccess = () => resolve();

    request.onerror = () => reject(request.error);
  });
}


function loadScenes() {

  return new Promise((resolve, reject) => {

    const request = store().getAll();

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => reject(request.error);
  });
}


function removeScene(id) {

  return new Promise((resolve, reject) => {

    const request = store("readwrite").delete(id);

    request.onsuccess = () => resolve();

    request.onerror = () => reject(request.error);
  });
}


/* =========================================================
   NAVEGACIÓN
========================================================= */

function view(name) {

  $$(".view").forEach(element => {
    element.classList.remove("active");
  });

  const target = $(name + "View");

  if (target) {
    target.classList.add("active");
  }

  if (name === "play") {
    renderScenes();
  }

  if (name === "library") {
    renderLibrary();
  }

  window.scrollTo(0, 0);
}


$$("[data-view]").forEach(button => {

  button.addEventListener("click", () => {
    view(button.dataset.view);
  });

});


if ($("homeBtn")) {

  $("homeBtn").addEventListener("click", () => {
    view("home");
  });

}


/* =========================================================
   DIÁLOGOS
========================================================= */

function parseLines(text) {

  return text
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean)

    .map((line, i) => {

      const parts = line
        .split("|")
        .map(x => x.trim());

      if (parts.length < 4) {
        return null;
      }

      const start = Number(parts[1]);
      const end = Number(parts[2]);

      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start
      ) {
        return null;
      }

      return {
        id: i,
        speaker: parts[0],
        start,
        end,
        text: parts.slice(3).join("|")
      };

    })

    .filter(Boolean)

    .sort((a, b) => a.start - b.start);
}


/* =========================================================
   ESCENAS
========================================================= */

function renderScenes(category = "Todas") {

  const cats = [
    "Todas",
    ...new Set(scenes.map(x => x.category))
  ];

  if ($("filters")) {

    $("filters").innerHTML = cats
      .map(c =>
        `<button class="filter ${
          c === category ? "active" : ""
        }" data-cat="${esc(c)}">${esc(c)}</button>`
      )
      .join("");

    $$(".filter").forEach(button => {

      button.onclick = () => {
        renderScenes(button.dataset.cat);
      };

    });
  }


  const list =
    category === "Todas"
      ? scenes
      : scenes.filter(x => x.category === category);


  if (!$("sceneGrid")) return;


  if (!list.length) {

    $("sceneGrid").innerHTML =
      `<div class="libraryEmpty">
        No hay escenas. Crea una desde <b>Crear</b>.
      </div>`;

    return;
  }


  $("sceneGrid").innerHTML = list
    .map(scene => {

      return `
        <article class="scene" data-id="${scene.id}">

          <div class="cover">
            ${
              scene.cover
                ? `<img src="${scene.cover}" alt="">`
                : "🎬"
            }
          </div>

          <div class="meta">

            <h3>${esc(scene.name)}</h3>

            <p>
              ${esc(scene.category)}
              · ${scene.lines.length} diálogos
              · ${Number(scene.duration || 0).toFixed(1)} s
            </p>

          </div>

        </article>
      `;

    })
    .join("");


  $$(".scene").forEach(card => {

    card.onclick = () => {

      const scene = scenes.find(
        x => x.id === card.dataset.id
      );

      if (scene) {
        startGame(scene);
      }

    };

  });
}


/* =========================================================
   BIBLIOTECA
========================================================= */

function renderLibrary() {

  if (!$("library")) return;


  if (!scenes.length) {

    $("library").innerHTML =
      `<div class="libraryEmpty">
        Tu biblioteca está vacía.
      </div>`;

    return;
  }


  $("library").innerHTML = scenes
    .map(scene => {

      return `
        <div class="libraryItem">

          <div class="thumb">
            ${
              scene.cover
                ? `<img src="${scene.cover}" alt="">`
                : "🎬"
            }
          </div>

          <div class="grow">

            <h3>${esc(scene.name)}</h3>

            <p>
              ${esc(scene.category)}
              · ${scene.lines.length} diálogos
            </p>

          </div>

          <button
            class="primary play"
            data-id="${scene.id}">
            Jugar
          </button>

          <button
            class="danger del"
            data-id="${scene.id}">
            Borrar
          </button>

        </div>
      `;

    })
    .join("");


  $$(".play").forEach(button => {

    button.onclick = () => {

      const scene = scenes.find(
        x => x.id === button.dataset.id
      );

      if (scene) {
        startGame(scene);
      }

    };

  });


  $$(".del").forEach(button => {

    button.onclick = async () => {

      if (!confirm("¿Borrar esta escena?")) {
        return;
      }

      await removeScene(button.dataset.id);

      scenes = await loadScenes();

      renderLibrary();

      toast("Escena borrada");
    };

  });
}


/* =========================================================
   ARCHIVOS
========================================================= */

function fileData(file) {

  return new Promise((resolve, reject) => {

    if (!file) {
      resolve(null);
      return;
    }

    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);

    reader.onerror = () => reject(reader.error);

    reader.readAsDataURL(file);
  });
}


/* =========================================================
   PREVISUALIZACIÓN
========================================================= */

if ($("mediaFile")) {

  $("mediaFile").addEventListener("change", () => {

    const file = $("mediaFile").files[0];

    const preview = $("preview");

    if (!file) {

      preview.textContent =
        "Aquí aparecerá la vista previa.";

      return;
    }


    const url = URL.createObjectURL(file);


    if (file.type.startsWith("video/")) {

      preview.innerHTML = `
        <video
          src="${url}"
          controls
          playsinline
          preload="metadata">
        </video>
      `;

    }

    else if (file.type.startsWith("image/")) {

      preview.innerHTML = `
        <img src="${url}" alt="">
      `;

    }

    else if (file.type.startsWith("audio/")) {

      preview.innerHTML = `
        <audio
          src="${url}"
          controls>
        </audio>
      `;
    }

  });

}


/* =========================================================
   CREAR ESCENA
========================================================= */

if ($("sceneForm")) {

  $("sceneForm").addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      const file =
        $("mediaFile").files[0];

      const cover =
        $("coverFile").files[0];

      const lines =
        parseLines($("dialogues").value);


      if (!file) {

        toast(
          "Selecciona un archivo multimedia."
        );

        return;
      }


      if (!lines.length) {

        toast(
          "Escribe al menos un diálogo válido."
        );

        return;
      }


      let mode = "image";


      if (file.type.startsWith("video/")) {

        mode = "video";

      }

      else if (file.type.startsWith("audio/")) {

        mode = "audio";

      }


      toast("Guardando escena...");


      try {

        const mediaData =
          await fileData(file);

        const coverData =
          await fileData(cover);


        const scene = {

          id: newId(),

          name:
            $("name").value.trim(),

          category:
            $("category").value,

          mode,

          media: mediaData,

          cover: coverData,

          fileName: file.name,

          fileType: file.type,

          fileSize: file.size,

          lines,

          duration:
            Math.max(
              ...lines.map(x => x.end)
            ),

          created:
            Date.now()
        };


        await saveScene(scene);


        scenes =
          await loadScenes();


        event.target.reset();


        $("preview").textContent =
          "Aquí aparecerá la vista previa.";


        toast(
          "Escena guardada correctamente."
        );


        view("play");


      }

      catch (error) {

        console.error(
          "Error guardando escena:",
          error
        );

        toast(
          "No se pudo guardar la escena."
        );
      }

    }
  );

}


/* =========================================================
   LIMPIAR FORMULARIO
========================================================= */

if ($("clearBtn")) {

  $("clearBtn").addEventListener(
    "click",
    () => {

      $("sceneForm").reset();

      $("preview").textContent =
        "Aquí aparecerá la vista previa.";

    }
  );

}


/* =========================================================
   ESCENA DEMO
========================================================= */

if ($("demoBtn")) {

  $("demoBtn").addEventListener(
    "click",
    () => {

      $("name").value =
        "La escena imposible";

      $("category").value =
        "Comedia";

      $("dialogues").value =
`ALEX | 0 | 3 | ¿Quién está listo para doblar?
SAM | 3 | 6 | ¡Yo! Pero necesito mi voz de estrella.
ALEX | 6 | 9 | Entonces que empiece el espectáculo.
SAM | 9 | 12 | ¡Cámara, micrófono y acción!`;

      toast(
        "Ejemplo cargado. Ahora selecciona tu video."
      );

    }
  );

}


/* =========================================================
   MULTIMEDIA
========================================================= */

function mediaElement() {

  if (!currentScene) {
    return null;
  }


  if (currentScene.mode === "video") {
    return $("video");
  }


  if (currentScene.mode === "audio") {
    return $("audio");
  }


  return null;
}


/* =========================================================
   PREPARAR VIDEO / AUDIO / IMAGEN
========================================================= */

function setupMedia(scene) {

  const video = $("video");
  const image = $("image");
  const audio = $("audio");


  if (!video || !image || !audio) {
    return;
  }


  try {
    video.pause();
  } catch {}


  try {
    audio.pause();
  } catch {}


  video.removeAttribute("src");
  audio.removeAttribute("src");
  image.removeAttribute("src");


  video.load();
  audio.load();


  video.classList.add("hidden");
  image.classList.add("hidden");
  audio.classList.add("hidden");


  $("stageMessage").classList.remove("hidden");


  if (!scene.media) {

    $("stageMessage").textContent =
      "No hay archivo multimedia.";

    return;
  }


  if (scene.mode === "video") {

    video.src = scene.media;

    video.controls = true;
    video.playsInline = true;

    video.load();

    video.classList.remove("hidden");

    $("stageMessage").classList.add(
      "hidden"
    );

    video.onerror = () => {

      console.error(
        "Error del video:",
        video.error
      );

      $("stageMessage").textContent =
        "No se pudo reproducir este video.";

      $("stageMessage").classList.remove(
        "hidden"
      );

      toast(
        "El navegador no puede reproducir este video."
      );
    };


  }

  else if (scene.mode === "image") {

    image.src = scene.media;

    image.classList.remove("hidden");

    $("stageMessage").classList.add(
      "hidden"
    );


  }

  else {

    audio.src = scene.media;

    audio.controls = true;

    audio.load();

    audio.classList.remove("hidden");

    $("stageMessage").textContent =
      "Audio listo";

    $("stageMessage").classList.remove(
      "hidden"
    );
  }
}


/* =========================================================
   ESPERAR METADATA DEL VIDEO
========================================================= */

function waitVideo(video) {

  return new Promise(resolve => {

    if (
      video.readyState >= 2 &&
      Number.isFinite(video.duration)
    ) {

      resolve();

      return;
    }


    let finished = false;


    const done = () => {

      if (finished) return;

      finished = true;

      video.removeEventListener(
        "loadedmetadata",
        done
      );

      video.removeEventListener(
        "canplay",
        done
      );

      resolve();
    };


    video.addEventListener(
      "loadedmetadata",
      done,
      { once: true }
    );


    video.addEventListener(
      "canplay",
      done,
      { once: true }
    );


    setTimeout(done, 5000);
  });
}


/* =========================================================
   INICIAR JUEGO
========================================================= */

async function startGame(scene) {

  if (!scene) {
    return;
  }


  stopGame();


  currentScene = scene;

  currentLine = 0;

  spokenText = "";

  gameStarted = false;


  scoreData = {
    timing: 0,
    words: 0,
    energy: 0,
    combo: 0
  };


  $("gameTitle").textContent =
    scene.name;

  $("score").textContent =
    "0";


  setupMedia(scene);


  view("game");


  renderLine();


  const media =
    mediaElement();


  if (
    media &&
    scene.mode === "video"
  ) {

    try {

      await waitVideo(media);

      media.currentTime = 0;

    }

    catch (error) {

      console.error(
        "Error preparando video:",
        error
      );
    }
  }


  /*
    IMPORTANTE:

    AQUÍ YA NO REPRODUCIMOS EL VIDEO.

    Antes se llamaba playScene()
    automáticamente y Android podía
    bloquear la reproducción.

    Ahora esperamos al botón
    🎙️ EMPEZAR.
  */


  $("startBtn").textContent =
    "🎙️ EMPEZAR";


  $("micText").textContent =
    "Micrófono apagado";


  $("heard").textContent = "";

}


/* =========================================================
   CUENTA REGRESIVA
========================================================= */

function doCountdown(seconds) {

  return new Promise(resolve => {

    const element =
      $("countdown");


    element.classList.remove(
      "hidden"
    );


    let number = seconds;

    element.textContent =
      number;


    const interval =
      setInterval(() => {

        number--;


        if (number <= 0) {

          clearInterval(interval);

          element.classList.add(
            "hidden"
          );

          resolve();

        }

        else {

          element.textContent =
            number;

        }

      }, 1000);
  });
}


/* =========================================================
   INICIAR REPRODUCCIÓN
========================================================= */

async function playScene() {

  const media =
    mediaElement();


  if (!media) {
    return false;
  }


  try {

    media.currentTime = 0;

    /*
      El play() se ejecuta directamente
      desde la acción del usuario.
    */

    await media.play();


    gameStarted = true;


    $("startBtn").textContent =
      "⏸️ PAUSAR";


    currentLine = 0;

    renderLine();

    startTimer();


    return true;

  }

  catch (error) {

    console.error(
      "Error reproduciendo:",
      error
    );


    toast(
      "Pulsa ▶ en el video para iniciar."
    );


    return false;
  }
}


/* =========================================================
   TEMPORIZADOR
========================================================= */

function startTimer() {

  clearInterval(timer);


  timer = setInterval(() => {

    if (!currentScene) {
      return;
    }


    const line =
      currentScene.lines[currentLine];


    if (!line) {
      return;
    }


    const media =
      mediaElement();


    const time =
      media
        ? media.currentTime
        : line.start;


    const progress =
      Math.max(
        0,
        Math.min(
          100,
          (
            (time - line.start) /
            (line.end - line.start)
          ) * 100
        )
      );


    $("bar").style.width =
      progress + "%";


    $("time").textContent =
      Math.max(
        0,
        time - line.start
      ).toFixed(1) + " s";


    if (time >= line.end) {

      scoreCurrentLine();


      if (
        currentLine <
        currentScene.lines.length - 1
      ) {

        currentLine++;

        renderLine();

      }

      else {

        finishGame();
      }
    }

  }, 50);
}


/* =========================================================
   MOSTRAR DIÁLOGO
========================================================= */

function renderLine() {

  const line =
    currentScene?.lines[currentLine];


  if (!line) {
    return;
  }


  $("roundLabel").textContent =
    `DIÁLOGO ${
      currentLine + 1
    } / ${
      currentScene.lines.length
    }`;


  $("speaker").textContent =
    line.speaker.toUpperCase();


  $("dialogue").textContent =
    line.text;


  $("bar").style.width =
    "0%";


  $("time").textContent =
    "0.0 s";
}


/* =========================================================
   PUNTUACIÓN
========================================================= */

function clean(text) {

  return String(text)

    .toLowerCase()

    .normalize("NFD")

    .replace(
      /[\u0300-\u036f]/g,
      ""
    )

    .replace(
      /[^\p{L}\p{N}\s]/gu,
      ""
    )

    .trim();
}


function accuracy(target, spoken) {

  const a =
    clean(target)
      .split(/\s+/)
      .filter(Boolean);


  const b =
    clean(spoken)
      .split(/\s+/)
      .filter(Boolean);


  if (!a.length) {
    return 1;
  }


  let hits = 0;

  const used =
    new Set();


  a.forEach(word => {

    const index =
      b.findIndex(
        (x, n) =>

          !used.has(n) &&

          (
            x === word ||
            x.includes(word) ||
            word.includes(x)
          )
      );


    if (index >= 0) {

      used.add(index);

      hits++;
    }

  });


  return hits / a.length;
}


function scoreCurrentLine() {

  if (!currentScene) {
    return;
  }


  const line =
    currentScene.lines[currentLine];


  if (!line) {
    return;
  }


  const media =
    mediaElement();


  const now =
    media
      ? media.currentTime
      : line.end;


  const timing =
    Math.max(
      0,
      1 -
      Math.abs(
        now - line.end
      ) / 1
    );


  const words =
    settings.voice
      ? accuracy(
          line.text,
          spokenText
        )
      : 0.7;


  const energy =
    micEnergy;


  scoreData.timing +=
    timing;

  scoreData.words +=
    words;

  scoreData.energy +=
    energy;


  if (words >= 0.75) {

    scoreData.combo++;

  }

  else {

    scoreData.combo = 0;
  }


  const points =
    Math.round(

      (10000 /
        currentScene.lines.length) *

      (
        timing * 0.4 +
        words * 0.45 +
        energy * 0.15
      )
    );


  $("score").textContent =
    Number(
      $("score").textContent
    ) + points;


  $("heard").textContent =
    spokenText

      ? `Escuché: "${spokenText}"`

      : "No se detectó voz.";


  spokenText = "";
}


/* =========================================================
   FINALIZAR
========================================================= */

function finishGame() {

  clearInterval(timer);


  stopMedia();

  stopMicrophone();


  gameStarted = false;


  const n =
    currentScene.lines.length || 1;


  const timing =
    Math.round(
      scoreData.timing /
      n * 100
    );


  const words =
    Math.round(
      scoreData.words /
      n * 100
    );


  const energy =
    Math.round(
      scoreData.energy /
      n * 100
    );


  const score =
    Number(
      $("score").textContent
    );


  $("finalScore").textContent =
    score.toLocaleString("es-MX");


  $("timing").textContent =
    timing + "%";


  $("words").textContent =
    words + "%";


  $("energy").textContent =
    energy + "%";


  $("combo").textContent =
    scoreData.combo + "×";


  const stars =
    Math.max(
      1,
      Math.min(
        5,
        Math.ceil(score / 2000)
      )
    );


  $("stars").textContent =
    "★".repeat(stars) +
    "☆".repeat(5 - stars);


  view("results");
}


/* =========================================================
   BOTÓN SALIR
========================================================= */

if ($("quitBtn")) {

  $("quitBtn").addEventListener(
    "click",
    () => {

      stopGame();

      view("play");
    }
  );

}


/* =========================================================
   JUGAR OTRA VEZ
========================================================= */

if ($("againBtn")) {

  $("againBtn").addEventListener(
    "click",
    () => {

      if (currentScene) {
        startGame(currentScene);
      }

    }
  );

}


/* =========================================================
   ANTERIOR
========================================================= */

if ($("prevBtn")) {

  $("prevBtn").addEventListener(
    "click",
    () => {

      if (
        !currentScene ||
        currentLine <= 0
      ) {
        return;
      }


      currentLine--;

      seekLine();

    }
  );

}


/* =========================================================
   SIGUIENTE
========================================================= */

if ($("nextBtn")) {

  $("nextBtn").addEventListener(
    "click",
    () => {

      if (
        !currentScene ||
        currentLine >=
          currentScene.lines.length - 1
      ) {
        return;
      }


      currentLine++;

      seekLine();

    }
  );

}


/* =========================================================
   BOTÓN EMPEZAR / PAUSAR
========================================================= */

if ($("startBtn")) {

  $("startBtn").addEventListener(
    "click",
    async () => {

      const media =
        mediaElement();


      if (!media) {

        toast(
          "Esta escena no tiene reproducción temporal."
        );

        return;
      }


      /*
        PRIMER CLIC:

        Inicia todo.
      */

      if (!gameStarted) {

        /*
          Si hay cuenta regresiva,
          la hacemos antes del video.
        */

        if (settings.count > 0) {

          await doCountdown(
            settings.count
          );

        }


        /*
          Activamos micrófono.

          No esperamos a que termine
          para reproducir el video,
          porque getUserMedia puede
          tardar en Android.
        */

        startMicrophone();


        /*
          IMPORTANTE:

          playScene() se llama como
          consecuencia directa del
          botón del usuario.
        */

        const started =
          await playScene();


        if (!started) {

          gameStarted = false;

          $("startBtn").textContent =
            "🎙️ EMPEZAR";
        }


        return;
      }


      /*
        SI YA ESTÁ JUGANDO:

        Pausar.
      */

      if (!media.paused) {

        media.pause();

        clearInterval(timer);


        $("startBtn").textContent =
          "▶️ CONTINUAR";

      }

      else {

        try {

          await media.play();

          $("startBtn").textContent =
            "⏸️ PAUSAR";

          startTimer();

        }

        catch (error) {

          console.error(error);

          toast(
            "No se pudo continuar el video."
          );
        }
      }

    }
  );

}


/* =========================================================
   IR A UNA LÍNEA
========================================================= */

function seekLine() {

  const line =
    currentScene.lines[currentLine];


  const media =
    mediaElement();


  if (media) {

    try {

      media.currentTime =
        line.start;

    }

    catch {}
  }


  spokenText = "";

  renderLine();
}


/* =========================================================
   MICRÓFONO
========================================================= */

async function startMicrophone() {

  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {

    $("micText").textContent =
      "Micrófono no disponible";

    return;
  }


  /*
    Si ya está activo,
    no volvemos a pedir permiso.
  */

  if (micStream) {
    return;
  }


  try {

    micStream =
      await navigator.mediaDevices.getUserMedia({
        audio: true
      });


    $("micText").textContent =
      "Micrófono activo";


    $(".mic").classList.add(
      "on"
    );


    const AC =
      window.AudioContext ||
      window.webkitAudioContext;


    if (AC) {

      audioContext =
        new AC();


      const source =
        audioContext
          .createMediaStreamSource(
            micStream
          );


      const analyser =
        audioContext
          .createAnalyser();


      analyser.fftSize = 256;


      source.connect(
        analyser
      );


      const data =
        new Uint8Array(
          analyser.frequencyBinCount
        );


      const measure = () => {

        if (!micStream) {
          return;
        }


        analyser.getByteTimeDomainData(
          data
        );


        let sum = 0;


        for (const value of data) {

          const x =
            (value - 128) / 128;

          sum += x * x;
        }


        micEnergy =
          Math.min(
            1,
            Math.sqrt(
              sum / data.length
            ) * 5
          );


        requestAnimationFrame(
          measure
        );
      };


      measure();
    }


    setupSpeechRecognition();

  }

  catch (error) {

    console.error(
      "Micrófono:",
      error
    );


    $("micText").textContent =
      "Micrófono bloqueado";


    toast(
      "Permite el micrófono para puntuar tu voz."
    );
  }
}


/* =========================================================
   RECONOCIMIENTO DE VOZ
========================================================= */

function setupSpeechRecognition() {

  const SR =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;


  if (!SR) {

    $("micText").textContent =
      "Micrófono activo";

    return;
  }


  try {

    recognition =
      new SR();


    recognition.lang =
      settings.lang;


    recognition.continuous =
      true;


    recognition.interimResults =
      true;


    recognition.onresult = event => {

      let text = "";


      for (
        let i = event.resultIndex;
        i < event.results.length;
        i++
      ) {

        text +=
          event.results[i][0].transcript +
          " ";
      }


      spokenText =
        text.trim();
    };


    recognition.onerror =
      event => {

        console.log(
          "Reconocimiento:",
          event.error
        );
      };


    recognition.onend = () => {

      if (micStream && recognition) {

        try {
          recognition.start();
        }

        catch {}
      }

    };


    recognition.start();

  }

  catch (error) {

    console.log(
      "Error reconocimiento:",
      error
    );
  }
}


/* =========================================================
   DETENER MICRÓFONO
========================================================= */

function stopMicrophone() {

  if (recognition) {

    try {
      recognition.stop();
    }

    catch {}

    recognition = null;
  }


  if (micStream) {

    micStream
      .getTracks()
      .forEach(track => {
        track.stop();
      });


    micStream = null;
  }


  if (audioContext) {

    audioContext
      .close()
      .catch(() => {});


    audioContext = null;
  }


  $(".mic")?.classList.remove(
    "on"
  );


  if ($("micText")) {

    $("micText").textContent =
      "Micrófono apagado";
  }


  micEnergy = 0;
}


/* =========================================================
   DETENER VIDEO
========================================================= */

function stopMedia() {

  const media =
    mediaElement();


  if (media) {

    try {
      media.pause();
    }

    catch {}


    try {
      media.currentTime = 0;
    }

    catch {}
  }
}


/* =========================================================
   DETENER JUEGO
========================================================= */

function stopGame() {

  clearInterval(timer);

  timer = null;


  stopMedia();

  stopMicrophone();


  gameStarted = false;
}


/* =========================================================
   AJUSTES
========================================================= */

if ($("lang")) {

  $("lang").value =
    settings.lang;


  $("lang").addEventListener(
    "change",
    event => {

      settings.lang =
        event.target.value;

      localStorage.setItem(
        "dm-lang",
        settings.lang
      );

    }
  );
}


if ($("voiceScore")) {

  $("voiceScore").checked =
    settings.voice;


  $("voiceScore").addEventListener(
    "change",
    event => {

      settings.voice =
        event.target.checked;


      localStorage.setItem(
        "dm-voice",
        event.target.checked
          ? "1"
          : "0"
      );

    }
  );
}


if ($("count")) {

  $("count").value =
    String(settings.count);


  $("count").addEventListener(
    "change",
    event => {

      settings.count =
        Number(
          event.target.value
        );


      localStorage.setItem(
        "dm-count",
        settings.count
      );

    }
  );
}


/* =========================================================
   BORRAR TODAS LAS ESCENAS
========================================================= */

if ($("deleteAll")) {

  $("deleteAll").addEventListener(
    "click",
    async () => {

      if (
        !confirm(
          "¿Borrar todas tus escenas?"
        )
      ) {
        return;
      }


      await new Promise(
        (resolve, reject) => {

          const request =
            store("readwrite")
              .clear();


          request.onsuccess =
            resolve;


          request.onerror =
            reject;

        }
      );


      scenes = [];


      renderLibrary();


      renderScenes();


      toast(
        "Biblioteca borrada."
      );

    }
  );
}


/* =========================================================
   TECLADO
========================================================= */

document.addEventListener(
  "keydown",
  event => {

    if (
      !$("gameView") ||
      !$("gameView")
        .classList
        .contains("active")
    ) {
      return;
    }


    if (event.key === "ArrowLeft") {

      $("prevBtn")?.click();
    }


    if (event.key === "ArrowRight") {

      $("nextBtn")?.click();
    }


    if (event.code === "Space") {

      event.preventDefault();

      $("startBtn")?.click();
    }

  }
);


/* =========================================================
   MANEJO DEL VIDEO
========================================================= */

if ($("video")) {

  $("video").addEventListener(
    "play",
    () => {

      if (gameStarted) {

        $("startBtn").textContent =
          "⏸️ PAUSAR";
      }

    }
  );


  $("video").addEventListener(
    "pause",
    () => {

      if (gameStarted) {

        $("startBtn").textContent =
          "▶️ CONTINUAR";
      }

    }
  );


  $("video").addEventListener(
    "ended",
    () => {

      if (
        currentScene &&
        gameStarted
      ) {

        finishGame();
      }

    }
  );


  $("video").addEventListener(
    "error",
    () => {

      console.error(
        "Video error:",
        $("video").error
      );

    }
  );
}


/* =========================================================
   INICIO
========================================================= */

async function init() {

  try {

    await openDB();


    scenes =
      await loadScenes();


    renderScenes();

    renderLibrary();


    console.log(
      "DOBLA-ME iniciado correctamente."
    );

  }

  catch (error) {

    console.error(
      "Error iniciando aplicación:",
      error
    );


    toast(
      "Error iniciando la aplicación."
    );
  }
}


init();

})();
