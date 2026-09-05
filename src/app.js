const $ = id => document.getElementById(id);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const BORDERS = new URL("../public/borders.json", import.meta.url);
const COUNTRIES_TOTAL = 195, CONTINENTS_TOTAL = 7;
const CONT_PT = {
  "Africa": "África", "Antarctica": "Antártida", "Asia": "Ásia", "Europe": "Europa",
  "North America": "América do Norte", "Oceania": "Oceania", "South America": "América do Sul",
};

/* ---------- projecao Natural Earth 1 ----------
   Mesmo polinomio do d3-geo, 8 linhas. Vale mais que a dependencia: o d3 so entra
   por CDN, e a pagina inteira promete que nada sai do navegador. */
const RAD = Math.PI / 180;
function project(lng, lat) {
  const l = lng * RAD, p = lat * RAD, p2 = p * p, p4 = p2 * p2;
  return [
    l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))),
    -p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))),
  ];
}
const WX = project(180, 0)[0], WY = project(0, -90)[1];   // meia-largura e meia-altura do mundo

/* ---------- mapa: canvas cru ----------
   Cada pais vira um Path2D ja projetado, uma vez so. A projecao e fixa, entao mover e
   dar zoom continua sendo transformacao afim: um setTransform por quadro, zero
   reprojecao em JS. E o que segura 50 mil pontos a 60 fps. */
const cv = $("map"), ctx = cv.getContext("2d", { alpha: false });
let shapes = [], sphere = null, graticule = null;
let visited = new Set(), pts = null;
let view = { x0: -WX, y0: -WY, s: 1 }, dpr = 1, W = 0, H = 0, dragging = false;

const fitScale = () => Math.min(W / (2 * WX), H / (2 * WY));
const clampS = s => Math.min(fitScale() * 24, Math.max(fitScale(), s));
const center = () => [view.x0 + W / (2 * view.s), view.y0 + H / (2 * view.s)];

function setView(cx, cy, s) {
  view.s = clampS(s);
  view.x0 = Math.max(-WX, Math.min(WX, cx)) - W / (2 * view.s);
  view.y0 = Math.max(-WY, Math.min(WY, cy)) - H / (2 * view.s);
  invalidate();
}
function resize() {
  if (cv.clientWidth === 0) return;                       // ainda escondido
  dpr = Math.min(2, devicePixelRatio || 1);
  const [cx, cy] = W ? center() : [0, 0];
  W = cv.clientWidth; H = cv.clientHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  setView(cx, cy, Math.max(view.s, fitScale()));
}

let raf = 0;
const invalidate = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

/**
 * Desenha o mapa em qualquer contexto e qualquer enquadramento — a tela usa a view
 * atual, o PNG exportado usa o mundo inteiro centralizado.
 * @param w,h    tamanho do alvo, em pixels de verdade
 * @param s      pixels por unidade de mundo
 * @param unit   quantos pixels do alvo valem um "pixel de desenho" (traco, ponto)
 * @param stride 1 desenha todo ponto; maior desenha uma amostra
 */
function paint(g, w, h, x0, y0, s, unit, stride = 1) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  // a agua vai pintada dentro do canvas (e nao so no CSS do cartao) pro PNG sair igual
  const water = g.createLinearGradient(0, 0, 0, h);
  water.addColorStop(0, "#0a1a2d"); water.addColorStop(1, "#071322");
  g.fillStyle = water; g.fillRect(0, 0, w, h);
  if (!shapes.length) return;

  // as coordenadas do gradiente sao lidas na hora do fill, ja sob a transformacao
  const warm = g.createLinearGradient(-WX, 0, WX, 0);
  warm.addColorStop(0, "#ffc24a"); warm.addColorStop(.45, "#ff9a3c"); warm.addColorStop(1, "#ff6248");

  g.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
  const px = unit / s;                                     // 1 px de desenho, em unidades de mundo
  const vb = [x0, y0, x0 + w / s, y0 + h / s];

  g.fillStyle = "rgba(255,255,255,.025)"; g.fill(sphere);
  g.strokeStyle = "rgba(255,255,255,.05)"; g.lineWidth = .6 * px; g.stroke(graticule);

  g.lineJoin = "round";
  for (const sh of shapes) {
    if (!hits(sh.bbox, vb)) continue;
    const on = visited.has(sh.name);
    g.fillStyle = on ? warm : "#2b3a51";
    g.strokeStyle = on ? "rgba(255,220,160,.5)" : "#17263a";
    g.lineWidth = .6 * px;
    g.fill(sh.path, "evenodd");            // evenodd: buracos certos sem depender da orientacao dos aneis
    g.stroke(sh.path);
  }

  if (pts) {
    const n = pts.x.length, r = 2.4 * px, dots = new Path2D();
    for (let i = 0; i < n; i += stride) {
      const x = pts.x[i], y = pts.y[i];
      if (x < vb[0] || x > vb[2] || y < vb[1] || y > vb[3]) continue;
      dots.moveTo(x + r, y);
      dots.arc(x, y, r, 0, 6.2832);
    }
    // Chapado, sem contorno e sem halo: onde as fotos se amontoam, borda e brilho
    // empilham e viram mingau. O --ink da paleta e a unica cor que se segura nos tres
    // fundos que existem aqui — pais laranja, terra nao visitada e mar.
    g.fillStyle = "#e9f0f9";
    g.fill(dots);
  }
}

function draw() {
  if (!W) return;
  // arrastando: desenha uma amostra pra manter o gesto a 60 fps; ao soltar, tudo
  const stride = dragging && pts ? Math.max(1, Math.ceil(pts.x.length / 9000)) : 1;
  paint(ctx, cv.width, cv.height, view.x0, view.y0, view.s * dpr, dpr, stride);
}

const hits = (b, v) => !(b[2] < v[0] || b[0] > v[2] || b[3] < v[1] || b[1] > v[3]);

function buildShapes(gj) {
  sphere = new Path2D();
  for (let lat = -90, first = true; lat <= 90; lat += 2, first = false) {
    const [x, y] = project(-180, lat); first ? sphere.moveTo(x, y) : sphere.lineTo(x, y);
  }
  for (let lat = 90; lat >= -90; lat -= 2) { const [x, y] = project(180, lat); sphere.lineTo(x, y); }
  sphere.closePath();

  graticule = new Path2D();
  for (let lng = -180; lng <= 180; lng += 10) {            // meridianos sao curvos nesta projecao
    for (let lat = -90; lat <= 90; lat += 5) {
      const [x, y] = project(lng, lat); lat === -90 ? graticule.moveTo(x, y) : graticule.lineTo(x, y);
    }
  }
  for (let lat = -80; lat <= 80; lat += 10) {              // paralelos sao retos
    const a = project(-180, lat), b = project(180, lat);
    graticule.moveTo(a[0], a[1]); graticule.lineTo(b[0], b[1]);
  }

  return gj.features.map(f => {
    const raw = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const path = new Path2D();
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const rings of raw) for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const [x, y] = project(ring[i][0], ring[i][1]);
        i ? path.lineTo(x, y) : path.moveTo(x, y);
        if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y;
      }
      path.closePath();
    }
    return { name: f.properties.NAME, path, bbox: [a, b, c, d] };
  });
}

/* ---------- gestos ---------- */
const pointers = new Map();
let pinch = null;
const gap = () => {
  const [a, b] = [...pointers.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
};
cv.addEventListener("pointerdown", e => {
  try { cv.setPointerCapture(e.pointerId); } catch { /* pointer sintetico: segue sem captura */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  dragging = true;
  if (pointers.size === 2) pinch = gap();
});
cv.addEventListener("pointermove", e => {
  const p = pointers.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  const [cx, cy] = center();
  if (pointers.size === 2) {                               // pinca: o ponto medio move, a distancia da zoom
    const g = gap();
    setView(cx - (g.mx - pinch.mx) / view.s, cy - (g.my - pinch.my) / view.s, view.s * (g.d / pinch.d));
    pinch = g;
  } else setView(cx - dx / view.s, cy - dy / view.s, view.s);
});
const endPointer = e => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!pointers.size) { dragging = false; invalidate(); }
};
cv.addEventListener("pointerup", endPointer);
cv.addEventListener("pointercancel", endPointer);

cv.addEventListener("wheel", e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  const wx = view.x0 + px / view.s, wy = view.y0 + py / view.s;   // ponto sob o cursor, em unidades de mundo
  const s = clampS(view.s * Math.exp(-e.deltaY * (e.deltaMode ? .06 : .0015)));
  setView(wx + (W / 2 - px) / s, wy + (H / 2 - py) / s, s);       // ancora esse ponto onde ele estava
}, { passive: false });

cv.addEventListener("keydown", e => {
  const step = 40 / view.s, [cx, cy] = center();
  const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (k) setView(cx + k[0], cy + k[1], view.s);
  else if (e.key === "+" || e.key === "=") setView(cx, cy, view.s * 1.5);
  else if (e.key === "-") setView(cx, cy, view.s / 1.5);
  else if (e.key === "Home") setView(0, 0, 0);
  else return;
  e.preventDefault();
});
addEventListener("resize", () => { resize(); });

/* ---------- painel ---------- */
const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const fmt = (v, dec = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const coord = (v, pos, neg) => `${fmt(Math.abs(v), 4)}° ${v >= 0 ? pos : neg}`;

function countUp(root) {
  for (const el of root.querySelectorAll("[data-count]")) {
    const to = parseFloat(el.dataset.count), dec = +(el.dataset.dec || 0);
    if (reduce) { el.textContent = fmt(to, dec); continue; }
    const t0 = performance.now();
    (function step(now) {
      const p = Math.min(1, (now - t0) / 1100);
      el.textContent = fmt(to * (1 - Math.pow(1 - p, 3)), dec);
      if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(to, dec);
    })(t0);
  }
  for (const el of root.querySelectorAll("[data-fill]"))
    requestAnimationFrame(() => el.style.width = el.dataset.fill + "%");
}

const card = (cls, k, num, dec, of, fill) => `<div class="card ${cls}">
  <p class="k">${k}</p>
  <div class="v"><span class="num" data-count="${num}"${dec ? ` data-dec="${dec}"` : ""}>0</span>${of ? `<span class="of">${of}</span>` : ""}</div>
  ${fill != null ? `<div class="track"><i data-fill="${fill}"></i></div>` : ""}</div>`;

function render(A, secs) {
  visited = new Set(A.visitedNames);

  // projeta os pontos uma vez; dai em diante mover/zoom e so transformacao afim
  const n = A.lat.length, x = new Float32Array(n), y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = project(A.lng[i], A.lat[i]);
    x[i] = p[0]; y[i] = p[1];
  }
  pts = { x, y };

  $("empty").hidden = true; $("dash").hidden = false;
  resize();
  setView(0, 0, 0);                                        // mundo inteiro: o vazio do mapa e metade da historia

  const nc = A.countries.length, dec = A.pct >= 10 ? 1 : A.pct >= 1 ? 2 : 3;
  const missing = Object.keys(CONT_PT).filter(c => !A.continents.includes(c));
  const contOf = missing.length === 1 ? `de 7 — só falta a ${CONT_PT[missing[0]]}` : "de 7";

  $("pct").dataset.count = A.pct; $("pct").dataset.dec = dec;
  $("herocap").innerHTML = `da terra firme do planeta.
    <span>Foram cerca de ${fmt(Math.round(A.reachArea))} km² de terra explorados,
    espalhados por ${nc} ${nc === 1 ? "país" : "países"}.</span>`;

  $("cards").innerHTML =
    card("lead", "Países visitados", nc, 0, `de ~${COUNTRIES_TOTAL}`, (nc / COUNTRIES_TOTAL * 100).toFixed(1)) +
    card("mid", "Continentes", A.nContinents, 0, contOf, (A.nContinents / CONTINENTS_TOTAL * 100).toFixed(1)) +
    card("small", "Lugares distintos", A.nCells, 0, "a ~20 km um do outro") +
    card("small", "Chão coberto", Math.round(A.reachArea), 0, "km²") +
    card("small", "Fotos com GPS", A.total, 0, `de ${fmt(A.scanned)} lidas`);

  const max = A.countries[0] ? A.countries[0].count : 1;
  $("rank").innerHTML = A.countries.slice(0, 8).map((c, i) => `<li>
    <span class="i">${String(i + 1).padStart(2, "0")}</span>
    <span><span class="nm">${esc(c.name)}</span><span class="rb"><i data-fill="${(c.count / max * 100).toFixed(1)}"
      style="background:linear-gradient(90deg,#ffc24a,${i < 3 ? "#ff6248" : "#ff8a48"})"></i></span></span>
    <span class="ct">${fmt(c.count)}</span></li>`).join("");

  const row = (dir, p) => p ? `<div class="row"><span class="dir">${dir}</span>
    <span class="pl">${esc(p.name)}</span>
    <span class="co">${coord(p.lat, "N", "S")}<br>${coord(p.lng, "L", "O")}</span></div>` : "";
  $("extrows").innerHTML = row("Norte", A.ext.n) + row("Sul", A.ext.s) + row("Leste", A.ext.e) + row("Oeste", A.ext.w);

  const facts = [];
  facts.push(`Você pôs o pé em <b>${nc} ${nc === 1 ? "país" : "países"}</b> e em <b>${A.nContinents} dos 7</b> continentes.`);
  if (A.jump && A.jump.d > 200)
    facts.push(`Seu maior salto foi de <b>${esc(A.jump.from)}</b> a <b>${esc(A.jump.to)}</b>, cerca de <b>${fmt(Math.round(A.jump.d))} km</b>.`);
  if (A.ext.n && A.ext.s)
    facts.push(`Suas fotos abrem <b>${fmt(A.latSpan, 1)}°</b> de latitude — de ${esc(A.ext.s.name)} a ${esc(A.ext.n.name)}.`);
  facts.push(`Elas se espalham por <b>${Math.min(24, Math.round(A.lngSpan / 15))}</b> fusos de longitude.`);
  if (A.tRange) {
    const o = { year: "numeric", month: "short" }, d = t => new Date(t * 1000).toLocaleDateString("pt-BR", o);
    facts.push(`O histórico vai de <b>${d(A.tRange[0])}</b> a <b>${d(A.tRange[1])}</b>.`);
  }
  if (A.countries[0])
    facts.push(`<b>${esc(A.countries[0].name)}</b> sozinho responde por <b>${(A.countries[0].count / A.total * 100).toFixed(0)}%</b> das suas fotos com GPS.`);
  facts.push(`Faltam <b>${COUNTRIES_TOTAL - nc} países</b> para o mapa fechar. Há tempo.`);
  $("facts").innerHTML = facts.map(f => `<li>${f}</li>`).join("");

  const disco = Math.round(Math.PI * A.reachKm ** 2);
  $("note").innerHTML =
      `<b>Como a porcentagem é calculada.</b> Cada foto define uma área circular de ${A.reachKm} km de raio ao redor do ponto `
    + `onde foi tirada. Essas áreas são somadas uma única vez — fotos próximas não contam o mesmo chão duas vezes — e apenas as `
    + `porções em terra firme entram no total, que é dividido pela área de terra firme do planeta.<br><br>`

    + `O mapa pinta por inteiro todo país em que há ao menos uma foto, porque as áreas de `
    + `${A.reachKm} km seriam invisíveis nessa escala. Uma única foto em Vladivostok pinta a Rússia inteira no mapa e acrescenta `
    + `cerca de ${fmt(disco)} km² à porcentagem, ou ${fmt(disco / A.landAreaTotal * 100, 3)}% da terra firme. As duas leituras `
    + `são deliberadamente diferentes: o mapa responde onde você esteve, a porcentagem responde quanto de chão você cobriu.<br><br>`

    + `<b>Limitações.</b> “Lugares distintos” agrupa fotos numa grade de ~20 km, e não é uma lista de cidades. As fronteiras vêm `
    + `do Natural Earth 50m: pontos no mar a até 75 km da costa são atribuídos ao país mais próximo, e ilhas pequenas demais para `
    + `esse dataset — Fernando de Noronha, entre elas — contam como mar aberto.`;
  const dur = secs >= 1 ? `${fmt(secs, 1)} s` : `${Math.round(secs * 1000)} ms`;
  $("footnote").textContent = `Processado localmente em ${dur} · ${fmt(A.scanned)} fotos lidas · nenhum byte saiu deste aparelho.`;

  countUp(document.getElementById("dash"));
  scrollTo(0, 0);
}

/* ---------- fluxo ---------- */
const toast = msg => {
  const t = $("toast"); t.textContent = msg; t.style.display = "block";
  clearTimeout(t._h); t._h = setTimeout(() => t.style.display = "none", 5000);
};
const progress = (label, frac) => {
  $("loading").classList.toggle("on", frac != null);
  if (frac == null) return;
  $("loadmsg").textContent = label;
  $("barfill").style.width = Math.round(frac * 100) + "%";
};

let t0 = 0;
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
worker.onmessage = ({ data }) => {
  if (data.type === "progress") return progress(data.label, data.frac);
  progress(null, null);
  if (data.type === "empty") return toast("Nenhuma foto com localização nesses arquivos.");
  if (data.type === "error") return toast("Deu ruim ao ler: " + data.message);
  render(data, (performance.now() - t0) / 1000);
};
// Falha ao CARREGAR o worker chega como Event puro — sem message, sem filename — entao
// "e.message" viraria a string "undefined". O motivo real (import quebrado, arquivo
// faltando) so aparece reimportando o mesmo grafo de modulos aqui na thread principal.
worker.onerror = async e => {
  progress(null, null);
  let why = e.message;
  if (!why) {
    try { await import("./worker.js"); why = "o worker não carregou (veja o console)"; }
    catch (err) { why = err.message; }
  }
  console.error("worker:", why, e);
  toast("Erro no processamento: " + why);
};
worker.onmessageerror = () => { progress(null, null); toast("Não consegui ler a resposta do worker."); };

function handleFiles(files) {
  files = [...files].filter(f => /\.(zip|json|csv)$/i.test(f.name));
  if (!files.length) return toast("Mande os .zip do Takeout, .json soltos ou um .csv.");
  t0 = performance.now();
  progress("lendo arquivo…", .01);
  worker.postMessage({ files });
}

const drop = $("drop");
drop.onclick = () => $("file").click();
drop.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } };
$("file").onchange = e => handleFiles(e.target.files);
$("demo").onclick = async e => {
  e.stopPropagation();                                     // o clique e do link, nao do cartao
  t0 = performance.now();
  progress("carregando exemplo…", .01);
  const r = await fetch(new URL("../public/sample.csv", import.meta.url));
  handleFiles([new File([await r.blob()], "sample.csv")]);
};
for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); });
for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, e => {
  if (ev === "dragleave" && e.relatedTarget && drop.contains(e.relatedTarget)) return;
  drop.classList.remove("over");
});
drop.addEventListener("drop", e => {
  e.preventDefault();
  if (e.dataTransfer?.files.length) handleFiles(e.dataTransfer.files);
});

$("reset").onclick = () => {
  $("dash").hidden = true; $("empty").hidden = false;
  $("file").value = ""; progress(null, null); scrollTo(0, 0);
};
$("save").onclick = () => {
  // ignora de proposito o zoom e o arrasto da tela: o mapa que se compartilha e o
  // mundo inteiro, centralizado, com todos os pontos
  const w = 2400, h = 1200, s = Math.min(w / (2 * WX), h / (2 * WY));
  const off = document.createElement("canvas");
  off.width = w; off.height = h;
  paint(off.getContext("2d"), w, h, -w / (2 * s), -h / (2 * s), s, 2);
  off.toBlob(b => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = "vibeglobe.png"; a.click();
    URL.revokeObjectURL(a.href);
  }, "image/png");
};

/* roadmap: hexagonos H3 ("exploracao real") entram como mais um Path2D projetado aqui,
   e a animacao temporal como um corte por indice em pts.x/pts.y antes do fill. */
fetch(BORDERS).then(r => r.json()).then(gj => { shapes = buildShapes(gj); invalidate(); })
  .catch(() => toast("Não consegui carregar public/borders.json."));
