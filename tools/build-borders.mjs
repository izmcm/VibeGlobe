// Baixa o Natural Earth 50m e gera public/borders.json (só o que o app usa).
// uso: node tools/build-borders.mjs
const URL_NE = "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_0_countries.geojson";
const src = process.argv[2] ? JSON.parse(await (await import("node:fs/promises")).readFile(process.argv[2], "utf8"))
                            : await (await fetch(URL_NE)).json();
// 4 casas ~= 11 m: precisão de sobra pra fronteiras a partir de fotos de GPS.
const round = c => Array.isArray(c[0]) ? c.map(round) : [Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4];
const out = {
  type: "FeatureCollection",
  features: src.features.map(f => ({
    type: "Feature",
    properties: { NAME: f.properties.NAME, NAME_PT: f.properties.NAME_PT, CONTINENT: f.properties.CONTINENT },
    geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) }
  }))
};
await (await import("node:fs/promises")).writeFile("public/borders.json", JSON.stringify(out));
console.log(out.features.length, "países");
