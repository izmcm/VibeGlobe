// Todo o trabalho pesado mora aqui: descompactar, parsear, geocodificar, somar.
// A thread principal so recebe numeros prontos e desenha.
import { buildIndex } from "./geo.js";
import { fromTakeout, fromCsv } from "./parse.js";
import { jsonEntries } from "./zip.js";
import { analyze } from "./stats.js";

const say = (label, frac) => postMessage({ type: "progress", label, frac });

let idx = null;
async function index() {
  if (idx) return idx;
  say("carregando fronteiras…", 0.02);
  const gj = await (await fetch(new URL("../public/borders.json", import.meta.url))).json();
  return (idx = buildIndex(gj));
}

async function collect(files) {
  const pts = [];
  let scanned = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i], low = file.name.toLowerCase();
    const base = i / files.length, span = 1 / files.length;
    // com varias partes o nome do arquivo nao diz nada e ainda estoura a barra;
    // "parte 3 de 8" diz o que a pessoa quer saber
    const qual = files.length > 1 ? `parte ${i + 1} de ${files.length}` : file.name;
    if (low.endsWith(".zip")) {
      for await (const e of jsonEntries(file, (done, total) =>
        (done % 200 === 0) && say(`lendo ${qual}…`, .05 + .45 * (base + span * done / total)))) {
        try { scanned += fromTakeout(JSON.parse(e.text), pts); } catch { /* json que nao e de foto */ }
      }
    } else if (low.endsWith(".json")) {
      try { scanned += fromTakeout(JSON.parse(await file.text()), pts); } catch { /* idem */ }
    } else if (low.endsWith(".csv")) {
      scanned += fromCsv(await file.text(), pts);
    }
    say(`lendo ${qual}…`, .05 + .45 * (base + span));
  }
  return { pts, scanned };
}

onmessage = async ({ data }) => {
  try {
    const i = await index();
    const { pts, scanned } = await collect(data.files);
    if (!pts.length) return postMessage({ type: "empty" });
    const out = { type: "done", scanned, ...analyze(i, pts,
      f => say("localizando fotos…", .5 + .35 * f),
      f => say("medindo o chão alcançado…", .85 + .14 * f)) };
    postMessage(out, [out.lat.buffer, out.lng.buffer]);
  } catch (e) {
    postMessage({ type: "error", message: String(e && e.message || e) });
  }
};
