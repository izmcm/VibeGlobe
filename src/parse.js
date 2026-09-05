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

// ponytail: split por virgula, sem campos entre aspas. Um CSV de coordenadas nao tem
// virgula dentro do campo; se algum dia tiver, troque por um parser de verdade.
/** @returns quantas linhas de dado o arquivo tinha */
export function fromCsv(text, pts) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return 0;
  const cell = s => s.trim().replace(/^"|"$/g, "");
  const head = lines[0].split(",").map(s => cell(s).toLowerCase());
  const iLat = head.findIndex(h => /^lat/.test(h)), iLng = head.findIndex(h => /^(lng|lon)/.test(h));
  if (iLat < 0 || iLng < 0) return 0;
  const iEp = head.indexOf("epoch"), iTs = head.indexOf("timestamp");
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const lat = parseFloat(cell(c[iLat] ?? "")), lng = parseFloat(cell(c[iLng] ?? ""));
    if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    let t = null;
    if (iEp >= 0) t = parseInt(cell(c[iEp] ?? ""), 10) || null;
    else if (iTs >= 0) t = Math.floor(Date.parse(cell(c[iTs] ?? "")) / 1000) || null;
    pts.push({ lat, lng, t });
  }
  return lines.length - 1;
}
