import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, BOARD_MARGIN, BOARD_WIDTH, BOARD_SURFACE_HEIGHT, BOARD_SURFACE_WIDTH, fitBoardObject, parseBoardDocument, parseBoardObject, putObject, type BoardObject } from '../shared/whiteboard';
import { validateDiagram } from '../server/features/whiteboard/images';

export const textObject = (id = 'text'): BoardObject => ({ id, type: 'text', x: 100, y: 100, w: 300, h: 140, color: '#123456', fill: 'transparent', size: 24, weight: 3, text: 'Hello board' });
describe('whiteboard document boundaries', () => {
  it('keeps editable content and strips executable or library-specific properties', () => {
    expect(parseBoardObject({ ...textObject(), src: 'https://remote.example/a.svg', onload: 'bad', arbitrary: true })).toEqual(textObject());
  });
  it.each([NaN, Infinity, -Infinity, '12', null])('rejects nonfinite or nonnumeric positions %s', (x) => {
    expect(() => parseBoardObject({ ...textObject(), x })).toThrow();
  });
  it('rejects duplicate IDs, oversized documents, malformed strokes and tables', () => {
    expect(() => parseBoardDocument({ objects: [textObject(), textObject()] })).toThrow();
    expect(() => parseBoardDocument({ objects: Array.from({ length: 501 }, (_, i) => textObject(`id${i}`)) })).toThrow();
    expect(() => parseBoardObject({ ...textObject(), type: 'stroke', points: [0, 0, 2, 1] })).toThrow();
    expect(() => parseBoardObject({ ...textObject(), type: 'table', cells: [['a'], ['b', 'c']] })).toThrow();
    expect(() => parseBoardObject({ ...textObject(), text: 'x'.repeat(5001) })).toThrow();
  });
  it('replaces exactly one object without mutating a saved snapshot', () => {
    const before = { objects: [textObject()] };
    expect(putObject(before, { ...textObject(), text: 'Changed' }).objects[0].text).toBe('Changed');
    expect(before.objects[0].text).toBe('Hello board');
  });
  it('rejects remote diagrams and malformed asset IDs', () => {
    for (const asset of ['https://a.example/a.png', 'aaaaaaaa----------------------------', '<svg/>']) expect(() => parseBoardObject({ ...textObject(), type: 'image', asset })).toThrow();
  });
  it('uses exactly the physical board aspect ratio', () => {
    expect(BOARD_SURFACE_WIDTH / BOARD_SURFACE_HEIGHT).toBeCloseTo(BOARD_WIDTH / BOARD_HEIGHT, 12);
  });
  it.each([0, 25, 45, 90, 135, 180, 270, 359])('keeps all rotated corners within the fixed board margin at %s degrees', (angle) => {
    const o = fitBoardObject({ ...textObject(), x: -400, y: 4000, w: 3200, h: 1800, angle });
    const c = Math.cos(angle * Math.PI / 180), s = Math.sin(angle * Math.PI / 180);
    for (const [x, y] of [[0, 0], [o.w, 0], [0, o.h], [o.w, o.h]]) {
      expect(o.x + c * x - s * y).toBeGreaterThanOrEqual(BOARD_MARGIN - 1e-8);
      expect(o.x + c * x - s * y).toBeLessThanOrEqual(BOARD_WIDTH - BOARD_MARGIN + 1e-8);
      expect(o.y + s * x + c * y).toBeGreaterThanOrEqual(BOARD_MARGIN - 1e-8);
      expect(o.y + s * x + c * y).toBeLessThanOrEqual(BOARD_HEIGHT - BOARD_MARGIN + 1e-8);
    }
  });
  it('normalizes legacy off-board content without losing its text or changing an in-bounds arrangement', () => {
    const inside = textObject(); expect(fitBoardObject(inside)).toEqual(inside);
    const legacy = parseBoardObject({ ...inside, x: 1590, y: 890 });
    expect(legacy.text).toBe(inside.text); expect(legacy.x + legacy.w).toBe(BOARD_WIDTH - BOARD_MARGIN);
    expect(legacy.y + legacy.h).toBe(BOARD_HEIGHT - BOARD_MARGIN);
    expect(fitBoardObject(legacy)).toEqual(legacy);
  });
});

export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
describe('diagram validation', () => {
  it('accepts a bounded PNG and rejects SVG, spoofed types and large dimensions', () => {
    expect(() => validateDiagram(png, 'image/png')).not.toThrow();
    expect(() => validateDiagram(png, 'image/jpeg')).toThrow();
    expect(() => validateDiagram(Buffer.from('<svg/>'), 'image/png')).toThrow();
    const bomb = Buffer.from(png); bomb.writeUInt32BE(100_000, 16);
    expect(() => validateDiagram(bomb, 'image/png')).toThrow();
    expect(() => validateDiagram(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png')).toThrow();
  });
  it('rejects truncated or zero-sized images', () => {
    for (let i = 0; i < 33; i++) expect(() => validateDiagram(png.subarray(0, i), 'image/png')).toThrow();
    const empty = Buffer.from(png); empty.writeUInt32BE(0, 20); expect(() => validateDiagram(empty, 'image/png')).toThrow();
  });
});
