import { test } from "node:test";
import assert from "node:assert/strict";
import { openAsBlob } from "node:fs";
import { fromTakeout, fromCsv } from "../src/parse.js";
import { jsonEntries } from "../src/zip.js";

test("takeout: pega geoData, ignora 0,0, cai pro geoDataExif", () => {
  const pts = [];
  let lidas = 0;
  lidas += fromTakeout({ geoData: { latitude: -8.13, longitude: -34.9 }, photoTakenTime: { timestamp: "1552219200" } }, pts);
  lidas += fromTakeout({ geoData: { latitude: 0, longitude: 0 }, geoDataExif: { latitude: 38.72, longitude: -9.14 } }, pts);
  lidas += fromTakeout({ geoData: { latitude: 0, longitude: 0 }, title: "sem gps.jpg" }, pts);
  lidas += fromTakeout([{ geoData: { latitude: 1, longitude: 2 } }], pts);
  lidas += fromTakeout({ albumData: { title: "Viagem" } }, pts);   // nao e foto: nao conta
  assert.deepEqual(pts, [
    { lat: -8.13, lng: -34.9, t: 1552219200 },
    { lat: 38.72, lng: -9.14, t: null },
    { lat: 1, lng: 2, t: null },
  ]);
  assert.equal(lidas, 4, "3 com GPS + 1 sem, e o album fora da conta");
});

test("csv: virgula dentro de campo citado nao desloca as colunas", () => {
  const pts = [];
  // sem tratar as aspas, c[1] viraria " Recife" e a linha inteira sumiria calada
  const n = fromCsv('name,latitude,longitude,timestamp\n'
    + '"Boa Viagem, Recife",-8.13,-34.90,2019-03-10T12:00:00Z\n'
    + '"Diz ""oi"", Olinda",-8.01,-34.85,2019-09-15T10:00:00Z\n', pts);
  assert.equal(n, 2);
  assert.deepEqual(pts, [
    { lat: -8.13, lng: -34.9, t: 1552219200 },
    { lat: -8.01, lng: -34.85, t: 1568541600 },
  ]);
});

test("csv: header flexivel, epoch ou timestamp, linha ruim ignorada", () => {
  const pts = [];
  assert.equal(fromCsv('name,Latitude,Longitude,timestamp\ncasa,-8.13,-34.90,2019-03-10T12:00:00Z\nruim,,,\n', pts), 2);
  assert.equal(fromCsv('lat,lon,epoch\n48.85,2.35,1681812000\n999,0,1\n', pts), 2);
  assert.deepEqual(pts, [
    { lat: -8.13, lng: -34.9, t: 1552219200 },
    { lat: 48.85, lng: 2.35, t: 1681812000 },
  ]);
});

for (const f of ["fixture.zip", "fixture-zip64.zip"]) {
  test(`zip: le so os .json de ${f}`, async () => {
    const pts = [];
    let n = 0;
    for await (const e of jsonEntries(await openAsBlob(new URL(f, import.meta.url)))) {
      n += fromTakeout(JSON.parse(e.text), pts);
    }
    assert.equal(n, 3, "3 json de foto, o .txt fica de fora");
    assert.equal(pts.length, 3);
    assert.deepEqual(pts[0], { lat: -8.13, lng: -34.9, t: 1652547601 });
  });
}
