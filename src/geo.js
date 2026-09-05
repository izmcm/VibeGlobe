// Reverse geocoding offline: ponto-em-poligono contra Natural Earth 50m.
// Modulo puro (sem DOM) -> roda igual no Web Worker e no `node --test`.

export const SNAP_KM = 75;   // costa/ilha/jitter de GPS: ate esta distancia, cola no pais
const CELL = 10;             // grade de pre-filtro, em graus
const MARGIN = 1;            // folga (graus) da bbox no fallback

const rad = v => v * Math.PI / 180;

export function havKm(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(s));
}

function ringHas(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// primeiro anel = contorno, demais = buracos (lagos, enclaves)
function polyHas(rings, x, y) {
  if (!ringHas(rings[0], x, y)) return false;
  for (let k = 1; k < rings.length; k++) if (ringHas(rings[k], x, y)) return false;
  return true;
}
function bboxOf(rings) {
  let a = 180, b = 90, c = -180, d = -90;
  for (const [x, y] of rings[0]) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
  return [a, b, c, d];
}
function ringMinKm(ring, x, y) {
  let m = Infinity;
  for (const [vx, vy] of ring) { const d = havKm(y, x, vy, vx); if (d < m) m = d; }
  return m;
}

// area geodesica do anel (m2), formula de excesso esferico
function ringArea(c) {
  const R = 6378137;
  let a = 0; const n = c.length;
  if (n > 2) {
    for (let i = 0; i < n; i++) {
      const p1 = c[i], p2 = c[(i + 1) % n];
      a += rad(p2[0] - p1[0]) * (2 + Math.sin(rad(p1[1])) + Math.sin(rad(p2[1])));
    }
    a = a * R * R / 2;
  }
  return Math.abs(a);
}
const polyArea = r => { let a = ringArea(r[0]); for (let i = 1; i < r.length; i++) a -= ringArea(r[i]); return a; };

const cellKey = (x, y) => Math.floor(x / CELL) + ":" + Math.floor(y / CELL);

/**
 * Indexa CADA poligono do MultiPolygon com bbox propria. Sem isso, paises que cruzam
 * o antimeridiano (NZ, Russia, EUA, Fiji) ganham uma bbox de -180 a 180 e "capturam"
 * o planeta inteiro no pre-filtro.
 */
export function buildIndex(gj) {
  const countries = [], grid = new Map();
  let landAreaTotal = 0;
  for (const f of gj.features) {
    const raw = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const country = { props: f.properties, area: raw.reduce((s, r) => s + polyArea(r), 0) / 1e6, parts: [] };
    for (const rings of raw) {
      const part = { rings, bbox: bboxOf(rings), country };
      country.parts.push(part);
      const [x0, y0, x1, y1] = part.bbox;
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
        for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
          const k = cx + ":" + cy;
          const bucket = grid.get(k);
          if (bucket) bucket.push(part); else grid.set(k, [part]);
        }
    }
    if (f.properties.CONTINENT !== "Antarctica") landAreaTotal += country.area;
    countries.push(country);
  }
  return { countries, grid, landAreaTotal };
}

// ponto-em-poligono puro, so nos poligonos da celula
function hit(idx, lng, lat) {
  const here = idx.grid.get(cellKey(lng, lat));
  if (here) for (const p of here) {
    const b = p.bbox;
    if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
    if (polyHas(p.rings, lng, lat)) return p;
  }
  return null;
}

/**
 * O ponto cai em terra firme? Sem o encaixe de costa de propósito: ele existe pra
 * salvar a foto tirada na praia, mas aqui mediria area — e faria toda celula de mar
 * ate 75 km da costa contar como chao.
 */
export const isLand = (idx, lng, lat) => hit(idx, lng, lat) !== null;

/** @returns properties do pais, ou null (mar aberto) */
export function locate(idx, lng, lat) {
  const p = hit(idx, lng, lat);
  if (p) return p.country.props;
  // fallback costa/ilha/jitter: vertice mais proximo por distancia REAL.
  //    Distancia ate a bbox nao serve - Lisboa cai dentro da bbox da Espanha.
  let best = null, bd = Infinity;
  for (const k of neighbours(lng, lat)) {
    const bucket = idx.grid.get(k);
    if (!bucket) continue;
    for (const p of bucket) {
      const b = p.bbox;
      if (lng < b[0] - MARGIN || lng > b[2] + MARGIN || lat < b[1] - MARGIN || lat > b[3] + MARGIN) continue;
      const d = ringMinKm(p.rings[0], lng, lat);
      if (d < bd) { bd = d; best = p.country; }
    }
  }
  return (best && bd <= SNAP_KM) ? best.props : null;
}
// celulas tocadas pela caixa de folga (a folga < CELL, entao no maximo 4)
function neighbours(lng, lat) {
  const ks = new Set();
  for (const x of [lng - MARGIN, lng + MARGIN]) for (const y of [lat - MARGIN, lat + MARGIN]) ks.add(cellKey(x, y));
  return ks;
}

export const nameOf = p => p ? (p.NAME_PT || p.NAME) : null;
