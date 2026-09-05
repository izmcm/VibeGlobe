import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildIndex } from "../src/geo.js";
import { fromCsv } from "../src/parse.js";
import { analyze, REACH_KM } from "../src/stats.js";

const idx = buildIndex(JSON.parse(await readFile(new URL("../public/borders.json", import.meta.url), "utf8")));
const pts = [];
fromCsv(await readFile(new URL("../public/sample.csv", import.meta.url), "utf8"), pts);
const A = analyze(idx, pts);

test("o csv de exemplo produz o painel esperado", () => {
  assert.equal(A.total, 30);
  assert.equal(A.countries[0].name, "Brasil");
  assert.equal(A.countries[0].count, 5);              // Noronha nao conta: fora do dataset 50m
  assert.equal(A.nContinents, 6);                     // falta a Antartida
  assert.equal(A.nCells, 29);                         // 30 fotos, mas casa e boa viagem ficam a 1 km
  assert.equal(A.countries.length, 22);
});

test("extremos e salto batem com a geografia", () => {
  assert.equal(A.ext.n.name, "Alemanha");             // Berlim, 52.52 N
  assert.equal(A.ext.s.name, "Nova Zelândia");        // Auckland
  assert.equal(A.ext.e.name, "Nova Zelândia");        // Auckland, 174.76 E
  assert.equal(A.ext.w.name, "Estados Unidos");       // Las Vegas, 115 W
  assert.equal(A.jump.from, "África do Sul");         // Cidade do Cabo -> Tóquio
  assert.equal(Math.round(A.jump.d), 14731);
});

test("area alcancada: discos de 25 km ao redor de cada foto, so em terra", () => {
  const teto = pts.length * Math.PI * REACH_KM ** 2;   // 30 discos sem sobreposicao nem mar
  assert.ok(A.reachArea < teto, `${A.reachArea} deveria ser menor que o teto ${teto}`);
  assert.ok(A.reachArea > teto * .5, `${A.reachArea} caiu demais abaixo do teto ${teto}`);
  assert.equal(Math.round(A.reachArea), 43558);
  assert.equal(A.pct.toFixed(4), "0.0323");            // 43,6 mil km2 de 134,7 milhoes
  assert.ok(Math.abs(A.pct - A.reachArea / A.landAreaTotal * 100) < 1e-9);
});

test("o mar nao entra na conta", () => {
  // uma foto no meio do Atlantico nao alcanca chao nenhum
  const mar = analyze(idx, [{ lat: -20, lng: -25, t: null }]);
  assert.equal(mar.reachArea, 0);
  assert.equal(mar.pct, 0);
  // e uma foto na praia alcanca menos que uma no interior, no mesmo raio
  const praia = analyze(idx, [{ lat: -8.14, lng: -34.90, t: null }]);   // Boa Viagem
  const dentro = analyze(idx, [{ lat: -15.79, lng: -47.88, t: null }]); // Brasilia
  assert.ok(praia.reachArea < dentro.reachArea * .75,
    `praia ${Math.round(praia.reachArea)} vs interior ${Math.round(dentro.reachArea)}`);
});

test("fotos na mesma rua nao contam area duas vezes", () => {
  const uma = analyze(idx, [{ lat: -15.79, lng: -47.88, t: null }]);
  const dez = analyze(idx, Array.from({ length: 10 }, (_, i) =>
    ({ lat: -15.79 + i * 1e-4, lng: -47.88, t: null })));         // ~100 m de espalhamento
  // a uniao e por celula, entao 10 fotos coladas nao viram 10 vezes a area. A folga de
  // 15% e a grade de ~11 km: deslocar o centro faz uma celula de borda entrar ou sair.
  assert.ok(dez.reachArea < uma.reachArea * 1.15,
    `${Math.round(dez.reachArea)} vs ${Math.round(uma.reachArea)}`);
});

/* ---------------------------------------------------------------------------
   Acervo realista: ninguem tira uma foto por cidade. Tira 400 na mesma praia,
   e os discos de 25 km se sobrepoem quase todos. E aqui que a uniao tem que
   funcionar — se cada foto contasse seu disco inteiro, 20 cidades dariam 11%
   do planeta.
---------------------------------------------------------------------------- */
const lcg = s => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const LUGARES = [
  [-8.05, -34.90], [-8.13, -34.92], [-7.99, -34.84],   // Recife: 3 bairros, discos colados
  [-23.55, -46.63], [-23.60, -46.70], [-22.97, -43.18],
  [-27.60, -48.55], [-3.73, -38.52], [-15.79, -47.88],
  [38.72, -9.14], [41.15, -8.61], [40.42, -3.70],
  [48.85, 2.35], [51.50, -0.12], [41.90, 12.50],
  [35.68, 139.69], [35.01, 135.77], [13.76, 100.50],
  [40.71, -74.00], [37.77, -122.42],
];
/** @param perLugar fotos por destino @param spreadKm o quanto a pessoa circulou na cidade */
function acervo(perLugar, spreadKm = 4, seed = 42) {
  const r = lcg(seed), out = [];
  for (const [lat, lng] of LUGARES)
    for (let i = 0; i < perLugar; i++) out.push({
      lat: lat + (r() - .5) * 2 * spreadKm / 110.574,
      lng: lng + (r() - .5) * 2 * spreadKm / (111.32 * Math.cos(lat * Math.PI / 180)),
      t: 1600000000 + out.length * 60,
    });
  return out;
}
const DISCO = Math.PI * REACH_KM ** 2;   // 1.963 km², um disco isolado

test("sobreposicao: duplicar o acervo inteiro nao muda um km2 sequer", () => {
  const base = acervo(100);                       // 2.000 fotos
  assert.equal(base.length, 2000);
  const uma = analyze(idx, base).reachArea;
  const duas = analyze(idx, [...base, ...base]).reachArea;
  // igualdade exata: a uniao e um Set de celulas, entao a mesma celula nao soma duas vezes
  assert.equal(duas, uma);
});

test("sobreposicao: 400x mais fotos nos mesmos lugares nao multiplica a area", () => {
  const poucas = analyze(idx, acervo(1));         // 20 fotos
  const muitas = analyze(idx, acervo(400));       // 8.000 fotos
  assert.equal(muitas.total, 8000);
  assert.equal(Math.round(poucas.reachArea), 26807);
  assert.equal(Math.round(muitas.reachArea), 37498);
  // 400x as fotos, 1,4x a area: o que cresce e o quanto a pessoa circulou (spread de
  // 4 km), nao a repeticao. Se a sobreposicao contasse, seriam 15,7 milhoes de km².
  assert.ok(muitas.reachArea < poucas.reachArea * 1.5);
  assert.ok(muitas.reachArea < 8000 * DISCO * .01, "menos de 1% da soma ingenua dos discos");
});

test("sobreposicao: a area cresce com lugares, nao com fotos", () => {
  const meio = analyze(idx, acervo(100).filter((_, i) => i % 200 < 100));  // metade dos lugares
  const todo = analyze(idx, acervo(100));
  assert.ok(todo.reachArea > meio.reachArea * 1.6,
    `${Math.round(todo.reachArea)} deveria ser bem maior que ${Math.round(meio.reachArea)}`);
});

test("sobreposicao: a uniao de dois discos bate com a formula analitica", () => {
  // area exata da uniao de dois circulos de raio r com centros a distancia d
  const uniao = (d, r) => d >= 2 * r ? 2 * Math.PI * r * r
    : 2 * Math.PI * r * r - (2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d));
  const medir = d => analyze(idx, [
    { lat: -15.79, lng: -47.88, t: null },                          // Brasilia, longe do mar
    { lat: -15.79 + d / 110.574, lng: -47.88, t: null },
  ]).reachArea;
  const base = medir(0);
  for (const d of [10, 25, 40, 60]) {
    const esperado = uniao(d, REACH_KM) / uniao(0, REACH_KM);       // em multiplos de um disco
    const obtido = medir(d) / base;
    // razoes, pra cancelar o vies da grade; a folga de 15% e a quantizacao de ~11 km,
    // que num disco pequeno vale +-1 celula (~120 km², ~6%)
    assert.ok(Math.abs(obtido - esperado) / esperado < .15,
      `${d} km: medido ${obtido.toFixed(2)} discos, analitico ${esperado.toFixed(2)}`);
  }
});
