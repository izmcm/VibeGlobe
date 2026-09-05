import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildIndex, locate, nameOf } from "../src/geo.js";

const idx = buildIndex(JSON.parse(await readFile(new URL("../public/borders.json", import.meta.url), "utf8")));
const at = (lat, lng) => { const p = locate(idx, lng, lat); return p && p.NAME; };

test("costeiro: Recife / Boa Viagem cai no Brasil", () => {
  assert.equal(at(-8.13, -34.90), "Brazil");
  assert.equal(at(-8.14, -34.90), "Brazil");
});

// Limite conhecido do dataset 50m: ilhas minusculas nao existem nele. Fernando de
// Noronha fica a 364 km do vertice brasileiro mais proximo -> alem do SNAP de 75 km.
// Subir o SNAP resolveria Noronha e quebraria voos transatlanticos. Fica como "mar aberto".
test("ilha ausente no 50m nao vira palpite errado", () => {
  assert.equal(at(-3.85, -32.42), null);
});

test("vizinho colado: Lisboa e Portugal, nao Espanha", () => {
  assert.equal(at(38.72, -9.14), "Portugal");
  assert.equal(at(41.16, -8.61), "Portugal");           // Porto
  assert.equal(at(40.42, -3.70), "Spain");              // Madri
});

test("antimeridiano: NZ / Russia / EUA nao capturam o mundo", () => {
  assert.equal(at(-36.85, 174.76), "New Zealand");      // Auckland
  assert.equal(at(43.12, 131.89), "Russia");            // Vladivostok
  assert.equal(at(21.31, -157.86), "United States of America"); // Honolulu
  assert.equal(at(-18.14, 178.44), "Fiji");             // Suva
});

test("mar aberto: meio do Atlantico nao e pais nenhum", () => {
  assert.equal(at(-20, -25), null);
  assert.equal(at(0, -140), null);                      // meio do Pacifico
});

test("area: terra firme total bate com a realidade (~134M km2, sem Antartida)", () => {
  assert.ok(idx.landAreaTotal > 125e6 && idx.landAreaTotal < 140e6, idx.landAreaTotal);
});

test("nomes em pt-BR quando existem", () => {
  assert.equal(nameOf(locate(idx, 2.35, 48.85)), "França");
});
