// Leitor de .zip so-leitura, via diretorio central + DecompressionStream nativo.
// Motivo de nao usar JSZip: ele carrega o arquivo inteiro na memoria, e um zip do
// Takeout tem 2-10 GB. Aqui as fotos (99% dos bytes) nunca sao lidas - so fatiamos
// e inflamos as entradas .json, que sao os metadados.
// ponytail: sem criptografia e sem zips multi-volume; o Takeout nao usa nenhum dos dois.

const u16 = (dv, o) => dv.getUint16(o, true);
const u32 = (dv, o) => dv.getUint32(o, true);
const u64 = (dv, o) => Number(dv.getBigUint64(o, true));

async function view(file, start, len) {
  return new DataView(await file.slice(start, start + len).arrayBuffer());
}

async function centralDirectory(file) {
  // EOCD fica no fim, depois de um comentario de ate 64 KB
  const tail = Math.min(file.size, 65557 + 20);
  const dv = await view(file, file.size - tail, tail);
  let eocd = -1;
  for (let i = tail - 22; i >= 0; i--) if (u32(dv, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("nao parece um .zip");

  let count = u16(dv, eocd + 10), size = u32(dv, eocd + 12), offset = u32(dv, eocd + 16);
  // >65535 entradas ou >4 GB: os campos estouram e o valor real esta no EOCD64.
  // Um zip do Google Fotos passa dos 65535 arquivos com facilidade, entao isso importa.
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    let loc = -1;
    for (let i = eocd - 20; i >= 0; i--) if (u32(dv, i) === 0x07064b50) { loc = i; break; }
    if (loc < 0) throw new Error("zip64 sem localizador");
    const z = await view(file, u64(dv, loc + 8), 56);
    if (u32(z, 0) !== 0x06064b50) throw new Error("zip64 invalido");
    count = u64(z, 32); size = u64(z, 40); offset = u64(z, 48);
  }
  return { dv: await view(file, offset, size), count };
}

/** Percorre as entradas .json do zip, uma a uma. @returns AsyncGenerator<{name,text}> */
export async function* jsonEntries(file, onProgress) {
  const { dv, count } = await centralDirectory(file);
  const dec = new TextDecoder();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (u32(dv, p) !== 0x02014b50) break;
    const nameLen = u16(dv, p + 28), extraLen = u16(dv, p + 30), commentLen = u16(dv, p + 32);
    const name = dec.decode(new Uint8Array(dv.buffer, dv.byteOffset + p + 46, nameLen));
    const method = u16(dv, p + 10);
    let comp = u32(dv, p + 20), uncomp = u32(dv, p + 24), local = u32(dv, p + 42);

    if (comp === 0xffffffff || uncomp === 0xffffffff || local === 0xffffffff) {
      // extra field 0x0001: so os campos que estouraram, nesta ordem
      let e = p + 46 + nameLen; const end = e + extraLen;
      while (e + 4 <= end) {
        const id = u16(dv, e), len = u16(dv, e + 2); let q = e + 4;
        if (id === 0x0001) {
          if (uncomp === 0xffffffff) { uncomp = u64(dv, q); q += 8; }
          if (comp === 0xffffffff) { comp = u64(dv, q); q += 8; }
          if (local === 0xffffffff) local = u64(dv, q);
          break;
        }
        e += 4 + len;
      }
    }
    p += 46 + nameLen + extraLen + commentLen;
    onProgress?.(i, count);
    if (!name.toLowerCase().endsWith(".json") || uncomp === 0) continue;

    // o header local tem tamanhos proprios de nome/extra; so ele diz onde os bytes comecam
    const lh = await view(file, local, 30);
    const data = file.slice(local + 30 + u16(lh, 26) + u16(lh, 28), local + 30 + u16(lh, 26) + u16(lh, 28) + comp);
    try {
      const text = method === 0
        ? await data.text()
        : await new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
      yield { name, text };
    } catch { /* entrada corrompida: segue o baile */ }
  }
}
