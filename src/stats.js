// Todas as metricas do painel. Puro (o progresso entra por callback) -> testavel em node.
import { locate, havKm, isLand } from "./geo.js";

export const REACH_KM = 25;      // raio alcancado a pe/de carro a partir de onde a foto foi tirada
const CELL = 0.1;                // grade do teste de area, ~11 km
const RAD = Math.PI / 180, R = 6371;
const LATS = 1800, LNGS = 3600;  // 180/CELL e 360/CELL

/**
 * Area de terra firme a ate REACH_KM de alguma foto.
 *
 * Rasteriza em vez de fazer uniao de circulos: marcar celulas numa grade resolve a
 * sobreposicao de graca (duas fotos na mesma rua marcam as mesmas celulas) e deixa
 * testar terra/mar celula a celula. Sem isso, um mar aberto a 20 km da praia contaria
 * como chao pisado.
 * ponytail: terra/mar decidido pelo centro da celula, entao a costa tem erro de ~11 km
 *   pra mais ou pra menos; diminuir CELL melhora, e custa tempo linearmente.
 */
function reach(idx, pts, onProgress) {
  const marked = new Set();
  for (let i = 0; i < pts.length; i++) {
    const { lat, lng } = pts[i];
    if ((i & 2047) === 0) onProgress?.(i / pts.length);
    const dLat = REACH_KM / 110.574;
    const dLng = Math.min(180, REACH_KM / (111.32 * Math.max(.01, Math.cos(lat * RAD))));
    for (let a = Math.floor((lat - dLat) / CELL); a <= Math.floor((lat + dLat) / CELL); a++) {
      if (a < -LATS / 2 || a >= LATS / 2) continue;
      const cy = (a + .5) * CELL;
      for (let b = Math.floor((lng - dLng) / CELL); b <= Math.floor((lng + dLng) / CELL); b++) {
        const j = ((b + LNGS / 2) % LNGS + LNGS) % LNGS - LNGS / 2;   // fecha a volta no antimeridiano
        if (havKm(lat, lng, cy, (j + .5) * CELL) > REACH_KM) continue;  // circulo, nao quadrado
        marked.add((a + LATS / 2) * LNGS + (j + LNGS / 2));
      }
    }
  }
  let area = 0, done = 0;
  for (const key of marked) {
    if ((done++ & 4095) === 0) onProgress?.(1);
    const a = Math.floor(key / LNGS) - LATS / 2, j = key % LNGS - LNGS / 2;
    if (!isLand(idx, (j + .5) * CELL, (a + .5) * CELL)) continue;
    // area exata da celula na esfera: R^2 * dLambda * (sen phi2 - sen phi1)
    area += R * R * CELL * RAD * (Math.sin((a + 1) * CELL * RAD) - Math.sin(a * CELL * RAD));
  }
  return { area, cells: marked.size };
}

export function analyze(idx, pts, onProgress, onReach) {
  const perCountry = new Map(), continents = new Set(), cells = new Set(), visited = new Set();
  const ext = { n: null, s: null, e: null, w: null };
  const withTime = [];
  const lat = new Float32Array(pts.length), lng = new Float32Array(pts.length);

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    lat[i] = p.lat; lng[i] = p.lng;
    if ((i & 2047) === 0) onProgress?.(i / pts.length);

    const pr = locate(idx, p.lng, p.lat);
    // ~0.2 grau ≈ 20 km: aproxima "cidades" sem servidor nenhum
    // roadmap: trocar por vizinho mais proximo em GeoNames cities15000 (k-d tree) -> nomes de cidade
    cells.add(Math.round(p.lat / .2) + ":" + Math.round(p.lng / .2));
    if (pr) {
      const nm = pr.NAME_PT || pr.NAME;
      let c = perCountry.get(nm);
      if (!c) perCountry.set(nm, c = { name: nm, count: 0, cont: pr.CONTINENT });
      c.count++;
      visited.add(pr.NAME);
      if (pr.CONTINENT && pr.CONTINENT !== "Seven seas (open ocean)") continents.add(pr.CONTINENT);
    }
    const here = { lat: p.lat, lng: p.lng, name: pr ? (pr.NAME_PT || pr.NAME) : "mar aberto" };
    if (!ext.n || p.lat > ext.n.lat) ext.n = here;
    if (!ext.s || p.lat < ext.s.lat) ext.s = here;
    if (!ext.e || p.lng > ext.e.lng) ext.e = here;
    if (!ext.w || p.lng < ext.w.lng) ext.w = here;
    if (p.t) withTime.push(p);
  }

  const r = reach(idx, pts, onReach);

  // maior salto entre duas fotos consecutivas no tempo
  // roadmap: esta mesma serie ordenada alimenta a animacao temporal
  withTime.sort((a, b) => a.t - b.t);
  let jump = null;
  for (let i = 1; i < withTime.length; i++) {
    const a = withTime[i - 1], b = withTime[i];
    const d = havKm(a.lat, a.lng, b.lat, b.lng);
    if (!jump || d > jump.d) jump = { d, from: nameAt(idx, a), to: nameAt(idx, b) };
  }

  let latMin = 90, latMax = -90, lngMin = 180, lngMax = -180;
  for (const p of pts) {
    if (p.lat < latMin) latMin = p.lat; if (p.lat > latMax) latMax = p.lat;
    if (p.lng < lngMin) lngMin = p.lng; if (p.lng > lngMax) lngMax = p.lng;
  }

  return {
    lat, lng, total: pts.length,
    countries: [...perCountry.values()].sort((a, b) => b.count - a.count),
    nContinents: continents.size, continents: [...continents], nCells: cells.size,
    visitedNames: [...visited], landAreaTotal: idx.landAreaTotal,
    reachArea: r.area, reachKm: REACH_KM,
    pct: idx.landAreaTotal ? r.area / idx.landAreaTotal * 100 : 0,
    ext, jump, latSpan: latMax - latMin, lngSpan: lngMax - lngMin,
    bounds: [lngMin, latMin, lngMax, latMax],
    tRange: withTime.length ? [withTime[0].t, withTime[withTime.length - 1].t] : null,
  };
}
const nameAt = (idx, p) => { const c = locate(idx, p.lng, p.lat); return c ? (c.NAME_PT || c.NAME) : "mar aberto"; };
