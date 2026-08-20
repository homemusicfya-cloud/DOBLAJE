const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const DB_NAME = "doblame-db";
const STORE = "scenes";

let db;
let scenes = [];
let currentScene = null;
let currentLine = 0;
let gameTimer = null;
let recognition = null;
let transcript = "";
let micStream = null;
let micAudio = null;
let micEnergy = 0;

let roundStats = {
  timing: 0,
  words: 0,
  energy: 0,
  combo: 0
};

const settings = {
  lang: localStorage.getItem("dm_lang") || "es-MX",
  voiceScore: localStorage.getItem("dm_voice") !== "0",
  countdown: +(localStorage.getItem("dm_count") || 3),
  auto: localStorage.getItem("dm_auto") !== "0"
};


/* =========================================================
   BASE DE DATOS
========================================================= */

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, {
        keyPath: "id"
      });
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}

function tx(mode = "readonly") {
  return db.transaction(STORE, mode).objectStore(STORE);
}

async function putScene(scene) {
  return new Promise((resolve, reject) => {
    const request = tx("readwrite").put(scene);

    request.onsuccess = () => resolve(scene);
    request.onerror = () => reject(request.error);
  });
}

async function delScene(id) {
  return new Promise((resolve, reject) => {
    const request = tx("readwrite").delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getScenes() {
  return new Promise((resolve, reject) => {
    const request = tx().getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}


/* =========================================================
   NAVEGACIÓN
========================================================= */

function showView(name) {
  $$(".view").forEach(view => {
    view.classList.remove("active");
  });

  const target = $("#" + name + "View");

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
    showView(button.dataset.view);
  });
});


/* =========================================================
   UTILIDADES
========================================================= */

function toast(message) {
  const element = $("#toast");

  if (!element) return;

  element.textContent = message;
  element.classList.add("show");

  setTimeout(() => {
    element.classList.remove("show");
  }, 2200);
}

function generateId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return Date.now() + "-" + Math.random();
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char];
  });
}


/* =========================================================
   DIÁLOGOS
========================================================= */

function parseDialogue(raw) {
  return raw
    .split(/\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {

      const parts = line
        .split("|")
        .map(value => value.trim());

      if (parts.length < 4) {
        return null;
      }

      const start = parseFloat(parts[1]);
      const end = parseFloat(parts[2]);

      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start
      ) {
        return null;
      }

      return {
        id: index,
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

function coverHTML(scene) {
  if (scene.cover) {
    return `<img src="${scene.cover}" alt="">`;
  }

  return "🎬";
}

function renderScenes(filter = "Todas") {

  const categories = [
    "Todas",
    ...new Set(scenes.map(scene => scene.category))
  ];

  $("#categoryChips").innerHTML =
    categories
      .map(category => `
        <button
          class="chip ${category === filter ? "active" : ""}"
          data-cat="${escapeHTML(category)}">
          ${escapeHTML(category)}
        </button>
      `)
      .join("");

  $$("#categoryChips .chip").forEach(button => {
    button.onclick = () => {
      renderScenes(button.dataset.cat);
    };
  });

  const list =
    filter === "Todas"
      ? scenes
      : scenes.filter(scene => scene.category === filter);

  if (!list.length) {

    $("#sceneGrid").innerHTML = `
      <div class="card">
        <h3>No hay escenas.</h3>
        <p class="muted">
          Crea una escena para comenzar.
        </p>
      </div>
    `;

    return;
  }

  $("#sceneGrid").innerHTML = list
    .map(scene => `
      <article
        class="scene-card"
        data-id="${scene.id}">

        <div class="scene-cover">
          ${coverHTML(scene)}
        </div>

        <div class="scene-meta">
          <h3>${escapeHTML(scene.name)}</h3>

          <p>
            ${escapeHTML(scene.category)}
            · ${scene.lines.length} líneas
            · ${scene.duration.toFixed(1)} s
          </p>
        </div>

      </article>
    `)
    .join("");

  $$("#sceneGrid .scene-card").forEach(card => {

    card.onclick = () => {

      const scene = scenes.find(
        scene => scene.id === card.dataset.id
      );

      startGame(scene);
    };
  });
}


/* =========================================================
   BIBLIOTECA
========================================================= */

function renderLibrary() {

  if (!scenes.length) {

    $("#libraryList").innerHTML = `
      <div class="card">
        <h3>Biblioteca vacía</h3>

        <p class="muted">
          Tus escenas aparecerán aquí.
        </p>
      </div>
    `;

    return;
  }

  $("#libraryList").innerHTML = scenes
    .map(scene => `

      <div class="library-item">

        <div class="thumb">
          ${
            scene.cover
              ? `<img src="${scene.cover}">`
              : "🎬"
          }
        </div>

        <div class="grow">

          <h3>
            ${escapeHTML(scene.name)}
          </h3>

          <p>
            ${escapeHTML(scene.category)}
            · ${scene.lines.length} diálogos
          </p>

        </div>

        <button
          class="primary playLib"
          data-id="${scene.id}">
          Jugar
        </button>

        <button
          class="danger delLib"
          data-id="${scene.id}">
          Borrar
        </button>

      </div>

    `)
    .join("");

  $$(".playLib").forEach(button => {

    button.onclick = () => {

      const scene = scenes.find(
        scene => scene.id === button.dataset.id
      );

      startGame(scene);
    };
  });

  $$(".delLib").forEach(button => {

    button.onclick = async () => {

      if (!confirm("¿Borrar esta escena?")) {
        return;
      }

      await delScene(button.dataset.id);

      scenes = await getScenes();

      renderLibrary();

      toast("Escena borrada");
    };
  });
}


/* =========================================================
   ARCHIVOS
========================================================= */

async function mediaToDataURL(file) {

  if (!file) {
    return null;
  }

  return new Promise((resolve, reject) => {

    const reader = new FileReader();

    reader.onload = () => {
      resolve(reader.result);
    };

    reader.onerror = reject;

    reader.readAsDataURL(file);
  });
}


/* =========================================================
   PREVISUALIZACIÓN DEL VIDEO
========================================================= */

$("#mediaFile").addEventListener("change", event => {

  const file = event.target.files[0];
  const preview = $("#mediaPreview");

  if (!file) {

    preview.textContent =
      "Selecciona un archivo para previsualizarlo.";

    return;
  }

  const url = URL.createObjectURL(file);

  if (file.type.startsWith("video/")) {

    preview.innerHTML = `
      <video
        src="${url}"
        controls
        playsinline
        preload="metadata"
        style="max-width:100%;max-height:300px">
      </video>
    `;

  } else if (file.type.startsWith("image/")) {

    preview.innerHTML = `
      <img
        src="${url}"
        style="max-width:100%;max-height:300px">
    `;

  } else if (file.type.startsWith("audio/")) {

    preview.innerHTML = `
      <audio
        src="${url}"
        controls>
      </audio>
    `;

  } else {

    preview.textContent =
      "Formato no compatible.";
  }
});


/* =========================================================
   CREAR ESCENA
========================================================= */

$("#sceneForm").addEventListener("submit", async event => {

  event.preventDefault();

  const mediaFile =
    $("#mediaFile").files[0];

  const coverFile =
    $("#coverFile").files[0];

  const lines =
    parseDialogue(
      $("#dialogueInput").value
    );

  if (!mediaFile) {

    toast("Selecciona un video, imagen o audio.");

    return;
  }

  if (!lines.length) {

    toast("Agrega al menos una línea válida.");

    return;
  }

  const media =
    await mediaToDataURL(mediaFile);

  const cover =
    await mediaToDataURL(coverFile);

  const duration =
    Math.max(
      ...lines.map(line => line.end)
    );

  const scene = {

    id: generateId(),

    name:
      $("#sceneName").value.trim(),

    category:
      $("#sceneCategory").value,

    mode:
      $("#sceneMode").value,

    media,

    cover,

    lines,

    duration,

    created:
      Date.now()
  };

  await putScene(scene);

  scenes = await getScenes();

  toast("Escena guardada correctamente.");

  $("#sceneForm").reset();

  $("#mediaPreview").textContent =
    "Selecciona un archivo para previsualizarlo.";

  showView("play");
});


/* =========================================================
   LIMPIAR FORMULARIO
========================================================= */

$("#clearForm").onclick = () => {

  $("#sceneForm").reset();

  $("#mediaPreview").textContent =
    "Selecciona un archivo para previsualizarlo.";
};


/* =========================================================
   EJEMPLO
========================================================= */

$("#loadDemo").onclick = () => {

  $("#sceneName").value =
    "La escena imposible";

  $("#sceneCategory").value =
    "Comedia";

  $("#sceneMode").value =
    "image";

  $("#dialogueInput").value =
`ALEX | 0 | 3 | ¿Quién dejó esto aquí?
SAM | 3 | 6 | Yo no fui.
ALEX | 6 | 9 | Claro... y yo soy astronauta.
SAM | 9 | 12 | ¡Pues felicidades!`;

  toast("Ejemplo cargado.");
};


/* =========================================================
   ELEMENTOS MULTIMEDIA
========================================================= */

function setupMedia(scene) {

  const video = $("#sceneVideo");
  const image = $("#sceneImage");
  const audio = $("#sceneAudio");

  video.pause();
  audio.pause();

  video.removeAttribute("src");
  audio.removeAttribute("src");

  video.classList.add("hidden");
  image.classList.add("hidden");
  audio.classList.add("hidden");

  if (scene.mode === "video") {

    video.src = scene.media;

    video.load();

    video.classList.remove("hidden");

  } else if (scene.mode === "image") {

    image.src = scene.media;

    image.classList.remove("hidden");

  } else if (scene.mode === "audio") {

    audio.src = scene.media;

    audio.load();

    audio.classList.remove("hidden");
  }
}


function mediaEl() {

  if (!currentScene) {
    return null;
  }

  if (currentScene.mode === "video") {
    return $("#sceneVideo");
  }

  if (currentScene.mode === "audio") {
    return $("#sceneAudio");
  }

  return null;
}


function stopMedia() {

  const media = mediaEl();

  if (!media) {
    return;
  }

  try {
    media.pause();
  } catch {}
}


/* =========================================================
   INICIAR JUEGO
========================================================= */

async function startGame(scene) {

  if (!scene) {
    return;
  }

  currentScene = scene;

  currentLine = 0;

  transcript = "";

  roundStats = {
    timing: 0,
    words: 0,
    energy: 0,
    combo: 0
  };

  $("#gameTitle").textContent =
    scene.name;

  $("#score").textContent = "0";

  $("#stageEmpty")
    .classList
    .add("hidden");

  setupMedia(scene);

  showView("game");

  renderLine();


  /*
    IMPORTANTE:

    Para videos esperamos a que el navegador
    conozca sus metadatos antes de comenzar.
  */

  const media = mediaEl();

  if (media && scene.mode === "video") {

    try {

      await waitForVideoReady(media);

      media.currentTime = 0;

      /*
        Intentamos reproducir una vez para que
        el navegador prepare el elemento.

        Se pausa inmediatamente.
      */

      media.muted = true;

      try {
        await media.play();
        media.pause();
      } catch (error) {
        console.log(
          "El navegador bloqueó la pre-reproducción:",
          error
        );
      }

      media.currentTime = 0;

    } catch (error) {

      console.error(
        "No se pudo preparar el video:",
        error
      );

      toast(
        "No se pudo preparar el video."
      );
    }
  }


  if (settings.countdown) {

    await countdown(
      settings.countdown
    );
  }

  startMic();

  $("#startRound").textContent =
    "⏸️ PAUSAR";

  playFromStart();
}


/* =========================================================
   ESPERAR VIDEO
========================================================= */

function waitForVideoReady(video) {

  return new Promise(resolve => {

    if (
      video.readyState >= 2 &&
      video.duration
    ) {
      resolve();

      return;
    }

    const done = () => {

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

    /*
      Seguridad:
      no esperamos indefinidamente.
    */

    setTimeout(resolve, 5000);
  });
}


/* =========================================================
   CUENTA REGRESIVA
========================================================= */

function countdown(seconds) {

  return new Promise(resolve => {

    const element =
      $("#countdown");

    element.classList.remove(
      "hidden"
    );

    let number = seconds;

    element.textContent =
      number;

    const timer =
      setInterval(() => {

        number--;

        if (number <= 0) {

          clearInterval(timer);

          element.classList.add(
            "hidden"
          );

          resolve();

          return;
        }

        element.textContent =
          number;

      }, 1000);
  });
}


/* =========================================================
   REPRODUCIR DESDE INICIO
========================================================= */

function playFromStart() {

  const media = mediaEl();

  if (media) {

    try {

      media.currentTime = 0;

    } catch {}

    /*
      Para videos usamos muted inicialmente
      para evitar que Chrome bloquee autoplay.
    */

    if (
      currentScene.mode === "video"
    ) {

      media.muted = true;
    }

    const playPromise =
      media.play();

    if (
      playPromise &&
      typeof playPromise.catch === "function"
    ) {

      playPromise.catch(error => {

        console.warn(
          "Reproducción bloqueada:",
          error
        );

        toast(
          "Pulsa ▶ para iniciar el video."
        );
      });
    }
  }

  currentLine = 0;

  renderLine();

  startClock();
}


/* =========================================================
   RELOJ
========================================================= */

function startClock() {

  clearInterval(gameTimer);

  gameTimer =
    setInterval(() => {

      if (!currentScene) {
        return;
      }

      const media =
        mediaEl();

      let time;

      if (media) {

        time =
          media.currentTime;

      } else {

        time =
          performance.now() / 1000;
      }

      const line =
        currentScene.lines[currentLine];

      if (!line) {
        return;
      }

      const percentage =
        Math.max(
          0,
          Math.min(
            100,
            ((time - line.start) /
              (line.end - line.start)) *
              100
          )
        );

      $("#lineProgress")
        .style
        .width =
        percentage + "%";

      $("#timerText")
        .textContent =
        Math.max(
          0,
          time - line.start
        ).toFixed(1) + " s";


      if (time >= line.end) {

        scoreLine();

        if (
          currentLine <
          currentScene.lines.length - 1
        ) {

          currentLine++;

          renderLine();

        } else {

          finishGame();
        }
      }

    }, 50);
}


/* =========================================================
   MOSTRAR DIÁLOGO
========================================================= */

function renderLine() {

  if (!currentScene) {
    return;
  }

  const line =
    currentScene.lines[currentLine];

  if (!line) {
    return;
  }

  $("#roundLabel").textContent =
    `DIÁLOGO ${currentLine + 1} / ${currentScene.lines.length}`;

  $("#speakerBadge").textContent =
    line.speaker.toUpperCase();

  $("#dialogueText").textContent =
    line.text;

  $("#translationText").textContent =
    "";

  $("#lineProgress").style.width =
    "0%";

  $("#timerText").textContent =
    "0.0 s";
}


/* =========================================================
   COMPARACIÓN DE VOZ
========================================================= */

function normalize(text) {

  return text
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


function wordAccuracy(target, spoken) {

  const targetWords =
    normalize(target)
      .split(/\s+/)
      .filter(Boolean);

  const spokenWords =
    normalize(spoken)
      .split(/\s+/)
      .filter(Boolean);

  if (!targetWords.length) {
    return 1;
  }

  let hits = 0;

  const used = new Set();

  for (
    const word of targetWords
  ) {

    const index =
      spokenWords.findIndex(
        (spokenWord, i) => {

          return (
            !used.has(i) &&
            (
              spokenWord === word ||
              spokenWord.includes(word) ||
              word.includes(spokenWord)
            )
          );
        }
      );

    if (index >= 0) {

      used.add(index);

      hits++;
    }
  }

  return (
    hits /
    targetWords.length
  );
}


/* =========================================================
   PUNTUACIÓN
========================================================= */

function scoreLine() {

  const line =
    currentScene.lines[currentLine];

  const media =
    mediaEl();

  const currentTime =
    media
      ? media.currentTime
      : line.end;

  const timing =
    Math.max(
      0,
      1 -
      Math.abs(
        currentTime -
        line.end
      ) / 0.9
    );

  const words =
    settings.voiceScore
      ? wordAccuracy(
          line.text,
          transcript
        )
      : 0.7;

  const energy =
    micEnergy;

  const lineScore =
    Math.round(
      10000 /
      currentScene.lines.length *
      (
        timing * 0.4 +
        words * 0.45 +
        energy * 0.15
      )
    );

  roundStats.timing += timing;

  roundStats.words += words;

  roundStats.energy += energy;

  if (words > 0.75) {

    roundStats.combo++;

  } else {

    roundStats.combo = 0;
  }

  const score =
    Number($("#score").textContent) +
    lineScore;

  $("#score").textContent =
    score;

  if (transcript) {

    $("#transcript").textContent =
      `Escuché: "${transcript}"`;

  } else {

    $("#transcript").textContent =
      "No se detectó voz.";
  }

  transcript = "";
}


/* =========================================================
   FINAL
========================================================= */

function finishGame() {

  clearInterval(gameTimer);

  stopMedia();

  stopMic();

  const total =
    currentScene.lines.length || 1;

  const timing =
    Math.round(
      roundStats.timing /
      total *
      100
    );

  const words =
    Math.round(
      roundStats.words /
      total *
      100
    );

  const energy =
    Math.round(
      roundStats.energy /
      total *
      100
    );

  const score =
    Number(
      $("#score").textContent
    );

  $("#finalScore")
    .textContent =
    score.toLocaleString(
      "es-MX"
    );

  $("#timingStat")
    .textContent =
    timing + "%";

  $("#wordStat")
    .textContent =
    words + "%";

  $("#energyStat")
    .textContent =
    energy + "%";

  $("#comboStat")
    .textContent =
    roundStats.combo + "×";

  const stars =
    Math.max(
      1,
      Math.min(
        5,
        Math.ceil(score / 2000)
      )
    );

  $("#rating")
    .textContent =
    "★".repeat(stars) +
    "☆".repeat(5 - stars);

  showView("results");
}


/* =========================================================
   BOTONES DEL JUEGO
========================================================= */

$("#againBtn").onclick =
  () => {

    startGame(
      currentScene
    );
  };


$("#quitGame").onclick =
  () => {

    clearInterval(gameTimer);

    stopMedia();

    stopMic();

    showView("play");
  };


$("#prevLine").onclick =
  () => {

    if (currentLine > 0) {

      currentLine--;

      seekLine();
    }
  };


$("#nextLine").onclick =
  () => {

    if (
      currentLine <
      currentScene.lines.length - 1
    ) {

      currentLine++;

      seekLine();
    }
  };


function seekLine() {

  const line =
    currentScene.lines[currentLine];

  const media =
    mediaEl();

  if (media) {

    media.currentTime =
      line.start;
  }

  transcript = "";

  renderLine();
}


/* =========================================================
   MICROFONO
========================================================= */

function startMic() {

  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {

    $("#micText").textContent =
      "Micrófono no disponible";

    return;
  }

  navigator.mediaDevices
    .getUserMedia({
      audio: true
    })
    .then(stream => {

      micStream = stream;

      $("#micText").textContent =
        "Micrófono activo";

      $(".mic-state")
        .classList
        .add("on");


      const AudioContext =
        window.AudioContext ||
        window.webkitAudioContext;

      micAudio =
        new AudioContext();

      const source =
        micAudio
          .createMediaStreamSource(
            stream
          );

      const analyser =
        micAudio.createAnalyser();

      analyser.fftSize = 256;

      source.connect(analyser);

      const data =
        new Uint8Array(
          analyser.frequencyBinCount
        );


      function meter() {

        if (!micStream) {
          return;
        }

        analyser.getByteTimeDomainData(
          data
        );

        let sum = 0;

        for (const value of data) {

          const x =
            (value - 128) /
            128;

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
          meter
        );
      }

      meter();

    })
    .catch(error => {

      console.error(
        error
      );

      $("#micText").textContent =
        "Permiso rechazado";

      toast(
        "Permite el acceso al micrófono."
      );
    });


  if (SpeechRecognition) {

    try {

      recognition =
        new SpeechRecognition();

      recognition.lang =
        settings.lang;

      recognition.continuous =
        true;

      recognition.interimResults =
        true;


      recognition.onresult =
        event => {

          let text = "";

          for (
            let i =
              event.resultIndex;
            i <
              event.results.length;
            i++
          ) {

            text +=
              event.results[i][0]
                .transcript +
              " ";
          }

          transcript =
            text.trim();
        };


      recognition.onerror =
        error => {

          console.log(
            "SpeechRecognition:",
            error
          );
        };


      recognition.onend =
        () => {

          if (micStream) {

            try {
              recognition.start();
            } catch {}
          }
        };


      recognition.start();

    } catch (error) {

      console.log(
        "Reconocimiento no disponible:",
        error
      );
    }
  }
}


function stopMic() {

  if (recognition) {

    try {
      recognition.stop();
    } catch {}

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

  if (micAudio) {

    micAudio
      .close()
      .catch(() => {});

    micAudio = null;
  }

  $(".mic-state")
    ?.classList
    .remove("on");

  $("#micText").textContent =
    "Micrófono apagado";

  micEnergy = 0;
}


/* =========================================================
   AJUSTES
========================================================= */

$("#voiceLang").value =
  settings.lang;

$("#voiceScoring").checked =
  settings.voiceScore;

$("#countdownSetting").value =
  settings.countdown;

$("#autoAdvance").checked =
  settings.auto;


$("#voiceLang").onchange =
  event => {

    settings.lang =
      event.target.value;

    localStorage.setItem(
      "dm_lang",
      settings.lang
    );
  };


$("#voiceScoring").onchange =
  event => {

    settings.voiceScore =
      event.target.checked;

    localStorage.setItem(
      "dm_voice",
      settings.voiceScore
        ? "1"
        : "0"
    );
  };


$("#countdownSetting").onchange =
  event => {

    settings.countdown =
      Number(
        event.target.value
      );

    localStorage.setItem(
      "dm_count",
      settings.countdown
    );
  };


$("#autoAdvance").onchange =
  event => {

    settings.auto =
      event.target.checked;

    localStorage.setItem(
      "dm_auto",
      settings.auto
        ? "1"
        : "0"
    );
};


/* =========================================================
   BORRAR BIBLIOTECA
========================================================= */

$("#wipeData").onclick =
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
          tx("readwrite").clear();

        request.onsuccess =
          resolve;

        request.onerror =
          reject;
      }
    );

    scenes = [];

    renderLibrary();

    toast(
      "Biblioteca borrada"
    );
  };


/* =========================================================
   TECLADO
========================================================= */

document.addEventListener(
  "keydown",
  event => {

    if (
      !$("#gameView")
        .classList
        .contains("active")
    ) {
      return;
    }

    const media =
      mediaEl();


    if (event.code === "Space") {

      event.preventDefault();

      if (!media) {
        return;
      }

      if (media.paused) {

        media.play();

      } else {

        media.pause();
      }
    }


    if (
      event.key === "ArrowLeft"
    ) {

      $("#prevLine").click();
    }


    if (
      event.key === "ArrowRight"
    ) {

      $("#nextLine").click();
    }
  }
);


/* =========================================================
   ESCENA DE PRUEBA
========================================================= */

async function createBuiltIn() {

  const svg = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1280"
    height="720">

    <rect
      width="100%"
      height="100%"
      fill="#160909"/>

    <text
      x="50%"
      y="45%"
      fill="white"
      font-size="72"
      font-family="Arial"
      text-anchor="middle">
      DOBLA-ME
    </text>

    <text
      x="50%"
      y="58%"
      fill="#e50914"
      font-size="30"
      font-family="Arial"
      text-anchor="middle">
      ESCENA DE PRUEBA
    </text>

  </svg>
  `;

  const cover =
    "data:image/svg+xml;base64," +
    btoa(svg);


  await putScene({

    id: "demo",

    name:
      "Prueba de doblaje",

    category:
      "Comedia",

    mode:
      "image",

    media:
      cover,

    cover:
      cover,

    duration:
      12,

    created:
      Date.now(),

    lines: [

      {
        id: 0,
        speaker: "ALEX",
        start: 0,
        end: 3,
        text:
          "¿Quién está listo para doblar?"
      },

      {
        id: 1,
        speaker: "SAM",
        start: 3,
        end: 6,
        text:
          "¡Yo! Pero necesito mi voz de estrella."
      },

      {
        id: 2,
        speaker: "ALEX",
        start: 6,
        end: 9,
        text:
          "Entonces que empiece el espectáculo."
      },

      {
        id: 3,
        speaker: "SAM",
        start: 9,
        end: 12,
        text:
          "¡Cámara, micrófono y acción!"
      }

    ]
  });
}


/* =========================================================
   INICIAR
========================================================= */

async function init() {

  try {

    await openDB();

    scenes =
      await getScenes();

    if (!scenes.length) {

      await createBuiltIn();
    }

    scenes =
      await getScenes();

    renderScenes();

  } catch (error) {

    console.error(
      error
    );

    toast(
      "No se pudo iniciar la biblioteca."
    );
  }
}


init();
