import { parseMidi } from './midi.js';
import { parseMusicXml } from './musicxml.js';

// Bounds apply before decompression, and actual expanded output is checked too.
const MAX_INPUT = 32 * 1024 * 1024;
const MAX_XML = 20 * 1024 * 1024;
const MAX_CONTAINER = 128 * 1024;
const MAX_EXPANDED = 64 * 1024 * 1024;
const MAX_ENTRIES = 512;
const MAX_RATIO = 500;
const ZIP_CHUNK = 1024;
const MUSICXML_TYPE = 'application/vnd.recordare.musicxml+xml';
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function fail(message) { throw new Error(`Arquivo MXL inválido: ${message}`); }
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}
function safePath(value) {
  if (!value || value.length > 1024 || /[\\:\x00-\x1f\x7f]/.test(value) || value.startsWith('/') || /%(?:2e|2f|5c|00)/i.test(value)) fail('caminho de arquivo inseguro no ZIP ou container.');
  const segments = value.endsWith('/') ? value.slice(0, -1).split('/') : value.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) fail('caminho relativo com travessia de diretórios não é permitido.');
  return value;
}
function decodeXml(bytes) {
  let encoding = 'utf-8';
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0)) encoding = 'utf-16le';
  else if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c)) encoding = 'utf-16be';
  else {
    const prefix = String.fromCharCode(...bytes.subarray(0, 256));
    const declared = /^\s*(?:\u00ef\u00bb\u00bf)?<\?xml\s[^?]*encoding\s*=\s*["']([^"']+)["']/i.exec(prefix);
    if (declared) encoding = declared[1];
  }
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error(`O XML usa uma codificação inválida ou não suportada: ${encoding}.`); }
}
function elements(parent, name) { return [...parent.children].filter(element => element.localName === name); }

/** Validate ZIP metadata and local headers without extracting any file. */
function inspectZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ensure = (offset, length) => { if (offset < 0 || length < 0 || offset + length > bytes.length) fail('ZIP truncado.'); };
  const u16 = offset => { ensure(offset, 2); return view.getUint16(offset, true); };
  const u32 = offset => { ensure(offset, 4); return view.getUint32(offset, true); };
  const nameAt = (offset, length) => {
    ensure(offset, length);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + length)); }
    catch { fail('nomes de arquivos do ZIP precisam estar em UTF-8.'); }
  };
  if (bytes.length < 22 || u32(0) !== 0x04034b50) fail('cabeçalho ZIP ausente.');
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0) fail('diretório final ZIP ausente ou truncado.');
  const count = u16(end + 10);
  const directorySize = u32(end + 12);
  const directoryStart = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count) fail('arquivos ZIP divididos em volumes não são suportados.');
  if (count === 0xffff || directorySize === 0xffffffff || directoryStart === 0xffffffff) fail('ZIP64 não é suportado.');
  if (!count || count > MAX_ENTRIES) fail(`o ZIP deve conter de 1 a ${MAX_ENTRIES} entradas.`);
  if (directoryStart + directorySize !== end) fail('tamanho ou posição do diretório ZIP inconsistente.');
  ensure(directoryStart, directorySize);
  const entries = new Map();
  const ranges = [];
  let expanded = 0;
  let position = directoryStart;
  for (let index = 0; index < count; index++) {
    ensure(position, 46);
    if (u32(position) !== 0x02014b50) fail('entrada do diretório ZIP inválida.');
    const flags = u16(position + 8);
    const method = u16(position + 10);
    const crc = u32(position + 16);
    const compressed = u32(position + 20);
    const uncompressed = u32(position + 24);
    const nameLength = u16(position + 28);
    const extraLength = u16(position + 30);
    const commentLength = u16(position + 32);
    const localOffset = u32(position + 42);
    const recordEnd = position + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > end) fail('entrada ZIP ultrapassa o diretório.');
    if (flags & 0x41) fail('arquivos ZIP criptografados não são suportados.');
    if (method !== 0 && method !== 8) fail('somente ZIP armazenado ou DEFLATE é suportado.');
    if (u16(position + 34)) fail('entrada ZIP em outro volume.');
    if ([compressed, uncompressed, localOffset].includes(0xffffffff)) fail('ZIP64 não é suportado.');
    if ((u32(position + 38) >>> 16 & 0xf000) === 0xa000) fail('links simbólicos não são aceitos no ZIP.');
    const name = safePath(nameAt(position + 46, nameLength));
    if (entries.has(name)) fail('nomes duplicados no ZIP.');
    expanded += uncompressed;
    if (expanded > MAX_EXPANDED || uncompressed > MAX_EXPANDED) fail('expansão ZIP excede o limite de 64 MB.');
    if (uncompressed > 1024 * 1024 && uncompressed > Math.max(1, compressed) * MAX_RATIO) fail('taxa de expansão ZIP excessiva (possível zip bomb).');
    if (method === 0 && compressed !== uncompressed) fail('tamanhos de entrada ZIP sem compressão são inconsistentes.');
    let extraPosition = position + 46 + nameLength;
    const extraEnd = extraPosition + extraLength;
    while (extraPosition < extraEnd) {
      if (extraPosition + 4 > extraEnd) fail('campo extra ZIP truncado.');
      const extraType = u16(extraPosition);
      const length = u16(extraPosition + 2);
      extraPosition += 4 + length;
      if (extraPosition > extraEnd) fail('campo extra ZIP inválido.');
      if (extraType === 1) fail('ZIP64 não é suportado.');
    }
    ensure(localOffset, 30);
    if (u32(localOffset) !== 0x04034b50 || u16(localOffset + 6) !== flags || u16(localOffset + 8) !== method) fail('cabeçalho local ZIP inconsistente.');
    const localNameLength = u16(localOffset + 26);
    const dataOffset = localOffset + 30 + localNameLength + u16(localOffset + 28);
    if (nameAt(localOffset + 30, localNameLength) !== name) fail('nome do cabeçalho local ZIP inconsistente.');
    if (!(flags & 8) && (u32(localOffset + 14) !== crc || u32(localOffset + 18) !== compressed || u32(localOffset + 22) !== uncompressed)) fail('metadados do cabeçalho local ZIP inconsistentes.');
    if (dataOffset + compressed > directoryStart) fail('dados ZIP ultrapassam o limite do arquivo.');
    ranges.push({ start: localOffset, end: dataOffset + compressed });
    entries.set(name, { name, method, crc, compressed, uncompressed, dataOffset });
    position = recordEnd;
  }
  if (position !== end) fail('quantidade ou tamanho das entradas ZIP inconsistente.');
  ranges.sort((a, b) => a.start - b.start);
  for (let index = 1; index < ranges.length; index++) if (ranges[index].start < ranges[index - 1].end) fail('entradas ZIP sobrepostas.');
  return entries;
}

async function readMxl(bytes, title) {
  const entries = inspectZip(bytes);
  // The browser ESM build is shipped locally with the production dependency.
  const { Inflate } = await import('../vendor/fflate.js');
  function extract(entry, limit) {
    if (!entry || entry.name.endsWith('/')) fail('arquivo referenciado não encontrado no ZIP.');
    if (entry.uncompressed > limit) fail(`o arquivo ${entry.name} excede o limite de expansão permitido.`);
    const input = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressed);
    let result;
    if (entry.method === 0) result = input;
    else {
      let size = 0;
      const chunks = [];
      const stream = new Inflate(chunk => {
        size += chunk.length;
        if (size > limit || size > entry.uncompressed) fail('dados descomprimidos excedem o tamanho declarado ou o limite de segurança.');
        chunks.push(chunk);
      });
      try {
        for (let offset = 0; offset < input.length; offset += ZIP_CHUNK) stream.push(input.subarray(offset, offset + ZIP_CHUNK), offset + ZIP_CHUNK >= input.length);
      } catch (error) { fail(`falha ao descomprimir ${entry.name}: ${error.message}`); }
      result = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    }
    if (result.length !== entry.uncompressed) fail('tamanho descomprimido difere do diretório ZIP.');
    if (crc32(result) !== entry.crc) fail('verificação CRC32 falhou; o ZIP está corrompido.');
    return result;
  }
  const containerBytes = extract(entries.get('META-INF/container.xml'), MAX_CONTAINER);
  const containerText = decodeXml(containerBytes);
  if (/<!ENTITY\s/i.test(containerText)) fail('entidades XML não são permitidas no container.');
  const document = new DOMParser().parseFromString(containerText, 'application/xml');
  const root = document.documentElement;
  if (root?.localName !== 'container' || document.getElementsByTagNameNS('*', 'parsererror').length) fail('META-INF/container.xml está malformado.');
  const rootfilesElements = elements(root, 'rootfiles');
  if (rootfilesElements.length !== 1) fail('o container deve ter um elemento rootfiles.');
  const rootfiles = elements(rootfilesElements[0], 'rootfile');
  if (!rootfiles.length) fail('rootfile ausente no container.');
  const mediaType = rootfiles[0].getAttribute('media-type');
  if (mediaType && mediaType !== MUSICXML_TYPE) fail('o primeiro rootfile do container precisa ser MusicXML.');
  const rootPath = safePath(rootfiles[0].getAttribute('full-path'));
  const score = extract(entries.get(rootPath), MAX_XML);
  return parseMusicXml(decodeXml(score), title);
}

/** Import MIDI, MusicXML or compressed MXL directly in memory, without extraction to disk. */
export async function parseMusicFile(input, name = 'Música') {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!bytes) throw new TypeError('O arquivo precisa ser Uint8Array ou ArrayBuffer.');
  if (!bytes.length || bytes.length > MAX_INPUT) throw new Error('O arquivo precisa conter de 1 byte a 32 MB.');
  const title = String(name).split(/[\\/]/).at(-1).replace(/\.(?:midi?|musicxml|xml|mxl)$/i, '') || 'Música';
  const midi = bytes.length >= 4 && bytes[0] === 77 && bytes[1] === 84 && bytes[2] === 104 && bytes[3] === 100;
  if (midi) return parseMidi(bytes, title);
  const zip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (zip || /\.mxl$/i.test(name)) return readMxl(bytes, title);
  if (bytes.length > MAX_XML) throw new Error('O MusicXML não comprimido excede o limite de 20 MB.');
  return parseMusicXml(decodeXml(bytes), title);
}
