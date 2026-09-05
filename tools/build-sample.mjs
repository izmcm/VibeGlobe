// Gera public/sample.csv: um acervo de fotos plausivel, nao uma foto por cidade.
// Deterministico (seed fixa), entao os testes podem travar os numeros. uso: npm run sample
import { writeFile } from "node:fs/promises";

// [lugar, lat, lng, fotos, primeiro dia, dias de permanencia]
const DESTINOS = [
  ["Boa Viagem, Recife",   -8.130, -34.903, 96, "2019-02-04", 330],   // casa: o ano inteiro
  ["Olinda",               -8.009, -34.855, 34, "2019-04-20",  40],
  ["Casa Forte, Recife",   -8.033, -34.918, 41, "2019-05-11", 210],
  ["Porto de Galinhas",    -8.508, -35.005, 28, "2019-11-15",   4],
  ["São Paulo",           -23.550, -46.633, 52, "2020-01-18",   6],
  ["Rio de Janeiro",      -22.971, -43.182, 63, "2020-02-22",   5],
  ["Fernando de Noronha",  -3.854, -32.424, 44, "2020-07-09",   6],
  ["Buenos Aires",        -34.603, -58.381, 58, "2021-03-03",   5],
  ["Santiago",            -33.447, -70.673, 31, "2021-03-10",   3],
  ["Lima",                -12.046, -77.043, 37, "2021-03-17",   4],
  ["Cidade do México",     19.433, -99.133, 49, "2021-11-05",   6],
  ["Nova York",            40.713, -74.006, 71, "2022-05-12",   7],
  ["Las Vegas",            36.170,-115.140, 22, "2022-05-19",   3],
  ["Lisboa",               38.722,  -9.139, 66, "2022-09-27",   6],
  ["Porto",                41.158,  -8.629, 38, "2022-10-03",   4],
  ["Madri",                40.417,  -3.704, 43, "2022-10-08",   4],
  ["Paris",                48.857,   2.352, 74, "2023-04-15",   6],
  ["Londres",              51.507,  -0.128, 57, "2023-04-22",   5],
  ["Amsterdã",             52.370,   4.895, 33, "2023-04-28",   3],
  ["Roma",                 41.902,  12.496, 61, "2023-08-09",   5],
  ["Berlim",               52.520,  13.405, 39, "2023-08-15",   4],
  ["Marrakech",            31.630,  -7.989, 45, "2024-01-13",   5],
  ["Cidade do Cabo",      -33.925,  18.424, 54, "2024-02-01",   7],
  ["Tóquio",               35.682, 139.690, 88, "2024-06-19",   7],
  ["Kyoto",                35.011, 135.768, 47, "2024-06-26",   4],
  ["Seul",                 37.567, 126.978, 36, "2024-07-01",   4],
  ["Bangkok",              13.756, 100.502, 42, "2024-11-16",   5],
  ["Sydney",              -33.869, 151.209, 51, "2025-01-05",   6],
  ["Auckland",            -36.848, 174.763, 29, "2025-01-13",   4],
  ["Dubai",                25.205,  55.271, 24, "2025-05-04",   3],
  ["Istambul",             41.008,  28.978, 46, "2025-09-10",   5],
];

let seed = 20240905;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

const rows = [];
for (const [nome, lat, lng, n, inicio, dias] of DESTINOS) {
  const t0 = Date.parse(inicio + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    // 4 em 5 fotos no centro da cidade, 1 em 5 num passeio mais longe
    const raio = rnd() < .8 ? 3 : 13;
    const dLat = (rnd() - .5) * 2 * raio / 110.574;
    const dLng = (rnd() - .5) * 2 * raio / (111.32 * Math.cos(lat * Math.PI / 180));
    const t = t0 + Math.floor(rnd() * dias) * 864e5 + (8 + Math.floor(rnd() * 12)) * 36e5 + Math.floor(rnd() * 36e5);
    rows.push([`"${nome}"`, (lat + dLat).toFixed(5), (lng + dLng).toFixed(5), new Date(t).toISOString().slice(0, 19) + "Z", t]);
  }
}
rows.sort((a, b) => a[4] - b[4]);

await writeFile("public/sample.csv",
  "name,latitude,longitude,timestamp\n" + rows.map(r => r.slice(0, 4).join(",")).join("\n") + "\n");
console.log(rows.length, "fotos em", DESTINOS.length, "destinos");
