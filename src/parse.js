// Extracao de pontos a partir dos formatos aceitos. Modulo puro -> testavel em node.

const isNum = v => typeof v === "number" && isFinite(v);

/** geoData (do Google Fotos) ou geoDataExif; 0,0 e o "sem GPS" do Takeout, nao a ilha nula */
function geoOf(o) {
  for (const k of ["geoData", "geoDataExif"]) {
    const g = o[k];
    if (g && isNum(g.latitude) && isNum(g.longitude) && !(g.latitude === 0 && g.longitude === 0))
      return [g.latitude, g.longitude];
  }
  return null;
}
const timeOf = o => {
  for (const k of ["photoTakenTime", "creationTime"]) {
    const t = o[k];
    if (t && t.timestamp) return parseInt(t.timestamp, 10) || null;
  }
  return null;
};

/**
 * Um .json do Takeout (objeto de foto, ou array deles). Acumula em `pts`.
 * @returns quantas fotos foram lidas — com ou sem GPS, pro "N de M" do painel
 */
export function fromTakeout(o, pts) {
  if (Array.isArray(o)) { let n = 0; for (const x of o) n += fromTakeout(x, pts); return n; }
  if (!o || typeof o !== "object") return 0;
  const g = geoOf(o);
  if (g) pts.push({ lat: g[0], lng: g[1], t: timeOf(o) });
  // conta como foto lida se tem GPS ou cara de foto; os outros arquivos do Takeout
  // (albuns, comentarios, preferencias) ficam de fora do "N de M"
  return (g || o.photoTakenTime || o.creationTime || typeof o.title === "string") ? 1 : 0;
}

// Divide uma linha respeitando aspas: "Boa Viagem, Recife" e UM campo, nao dois.
// Sem isso a virgula no nome desloca todas as colunas e o arquivo inteiro e descartado
// em silencio — planilha e export de Takeout citam campos assim o tempo todo.
// ponytail: nao trata quebra de linha dentro de campo citado, porque as linhas ja vem
//   separadas antes. Se aparecer, aí sim vale um parser de CSV de verdade.
function fields(line) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') cur += c;
      else if (line[i + 1] === '"') { cur += '"'; i++; }   // "" escapa uma aspa
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** @returns quantas linhas de dado o arquivo tinha */
export function fromCsv(text, pts) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return 0;
  const head = fields(lines[0]).map(h => h.trim().toLowerCase());
  const iLat = head.findIndex(h => /^lat/.test(h)), iLng = head.findIndex(h => /^(lng|lon)/.test(h));
  if (iLat < 0 || iLng < 0) return 0;
  const iEp = head.indexOf("epoch"), iTs = head.indexOf("timestamp");
  for (let i = 1; i < lines.length; i++) {
    const c = fields(lines[i]);
    const lat = parseFloat(c[iLat]), lng = parseFloat(c[iLng]);
    if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    let t = null;
    if (iEp >= 0) t = parseInt(c[iEp], 10) || null;
    else if (iTs >= 0) t = Math.floor(Date.parse((c[iTs] || "").trim()) / 1000) || null;
    pts.push({ lat, lng, t });
  }
  return lines.length - 1;
}
