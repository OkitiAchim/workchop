import { MAX_IMAGE_BYTES } from '../../../shared/whiteboard';
import { UploadError } from '../../uploads';

/** Bound actual raster dimensions before browsers decode; SVG/HTML and remote URLs aren't accepted. */
export function validateDiagram(data: Buffer, declared: string): void {
  if (data.length > MAX_IMAGE_BYTES) throw new UploadError(413, 'Diagrams must be 5 MB or smaller.');
  let type = '', w = 0, h = 0;
  if (data.length >= 33 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.toString('ascii', 12, 16) === 'IHDR') {
    type = 'image/png'; w = data.readUInt32BE(16); h = data.readUInt32BE(20);
  } else if (data.length >= 12 && data[0] === 0xff && data[1] === 0xd8) {
    type = 'image/jpeg';
    for (let at = 2; at + 4 < data.length;) {
      if (data[at++] !== 0xff) break;
      while (data[at] === 0xff) at++;
      const marker = data[at++];
      if (marker === 0xda || marker === 0xd9) break;
      const size = data.readUInt16BE(at);
      if (size < 2 || at + size > data.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 7) { h = data.readUInt16BE(at + 3); w = data.readUInt16BE(at + 5); break; }
      at += size;
    }
  } else if (data.length >= 30 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    type = 'image/webp';
    const chunk = data.toString('ascii', 12, 16);
    if (chunk === 'VP8X') { w = 1 + data.readUIntLE(24, 3); h = 1 + data.readUIntLE(27, 3); }
    else if (chunk === 'VP8 ' && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) { w = data.readUInt16LE(26) & 0x3fff; h = data.readUInt16LE(28) & 0x3fff; }
    else if (chunk === 'VP8L' && data[20] === 0x2f) { const bits = data.readUInt32LE(21); w = (bits & 0x3fff) + 1; h = ((bits >>> 14) & 0x3fff) + 1; }
  }
  if (!type || type !== declared || !w || !h || w > 8192 || h > 8192 || w * h > 16_777_216) {
    throw new UploadError(400, 'Choose a valid PNG, JPEG or WebP diagram up to 16 megapixels.');
  }
}
