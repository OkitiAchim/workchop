import type { Role } from './workspace';

export const BOARD_WIDTH = 1600;
export const BOARD_HEIGHT = 900;
export const BOARD_MARGIN = 16;
export const BOARD_SURFACE_WIDTH = 1.86;
export const BOARD_SURFACE_HEIGHT = BOARD_SURFACE_WIDTH * BOARD_HEIGHT / BOARD_WIDTH;
export const BOARD_LEASE_MS = 20_000;
export const MAX_BOARD_OBJECTS = 500;
export const MAX_BOARD_BYTES = 1_000_000;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const BOARD_TYPES = ['stroke', 'text', 'note', 'rect', 'ellipse', 'line', 'arrow', 'table', 'image'] as const;
export type BoardType = typeof BOARD_TYPES[number];

/** A portable, allowlisted document; never deserialize arbitrary canvas-library objects. */
export interface BoardObject {
  id: string;
  type: BoardType;
  x: number; y: number; w: number; h: number;
  angle?: number;
  color: string; fill: string; size: number; weight: number;
  text?: string;
  /** Stroke points normalized to its box, so moving/resizing retains an editable stroke. */
  points?: number[];
  cells?: string[][];
  asset?: string;
}
export interface BoardDocument { objects: BoardObject[] }
export interface BoardEditor { id: string; name: string; expires: number }
export interface BoardState {
  boardId: string; revision: number; document: BoardDocument;
  editor: BoardEditor | null; preview: BoardObject | null;
  undo: boolean; redo: boolean; recovery: boolean;
}
export type BoardChange = { type: 'put'; object: BoardObject } | { type: 'delete'; id: string } |
  { type: 'clear' | 'undo' | 'redo' | 'restore' };
export interface BoardMutation { token: string; revision: number; operationId: string; change: BoardChange }
export type BoardResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string; state?: BoardState };

export const mayEditBoard = (role: Role | null) => role === 'owner' || role === 'admin' || role === 'member';
export const boardId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
export const assetId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
const number = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const color = (v: unknown): v is string => typeof v === 'string' && (/^#[0-9a-f]{6}$/i.test(v) || v === 'transparent');
const string = (v: unknown, limit: number): v is string => typeof v === 'string' && v.length <= limit && !/\u0000/.test(v);

/** The entire rotated object stays inside the same fixed safe area in every view. */
export function fitBoardObject(object: BoardObject): BoardObject {
  const angle = (object.angle ?? 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const ac = Math.abs(c), as = Math.abs(s), base = ac + as;
  const roomW = BOARD_WIDTH - 2 * BOARD_MARGIN, roomH = BOARD_HEIGHT - 2 * BOARD_MARGIN;
  const w = Math.max(1, object.w), h = Math.max(1, object.h);
  const ratio = Math.min(1, (roomW - base) / Math.max(1, ac * (w - 1) + as * (h - 1)),
    (roomH - base) / Math.max(1, as * (w - 1) + ac * (h - 1)));
  const width = 1 + (w - 1) * ratio, height = 1 + (h - 1) * ratio;
  const xs = [0, c * width, -s * height, c * width - s * height];
  const ys = [0, s * width, c * height, s * width + c * height];
  return { ...object, w: width, h: height,
    x: Math.max(BOARD_MARGIN - Math.min(...xs), Math.min(BOARD_WIDTH - BOARD_MARGIN - Math.max(...xs), object.x)),
    y: Math.max(BOARD_MARGIN - Math.min(...ys), Math.min(BOARD_HEIGHT - BOARD_MARGIN - Math.max(...ys), object.y)) };
}

export function parseBoardObject(raw: unknown): BoardObject {
  const o = raw as Partial<BoardObject> | null;
  if (!o || typeof o !== 'object' || !boardId(o.id) || !BOARD_TYPES.includes(o.type as BoardType) ||
    !number(o.x, -BOARD_WIDTH, BOARD_WIDTH * 2) || !number(o.y, -BOARD_HEIGHT, BOARD_HEIGHT * 2) ||
    !number(o.w, 1, BOARD_WIDTH * 2) || !number(o.h, 1, BOARD_HEIGHT * 2) || !color(o.color) || !color(o.fill) ||
    !number(o.size, 10, 96) || !number(o.weight, 1, 24)) throw new Error('Invalid whiteboard object.');
  const out: BoardObject = { id: o.id, type: o.type!, x: o.x, y: o.y, w: o.w, h: o.h,
    color: o.color, fill: o.fill, size: o.size, weight: o.weight };
  if (o.angle !== undefined) {
    if (!number(o.angle, -360, 360)) throw new Error('Invalid rotation.'); out.angle = o.angle;
  }
  if (o.type === 'text' || o.type === 'note') {
    if (!string(o.text, 5000)) throw new Error('Text is too long.');
    out.text = o.text;
  }
  if (o.type === 'stroke') {
    if (!Array.isArray(o.points) || o.points.length < 4 || o.points.length > 6000 || o.points.length % 2 ||
      !o.points.every((p) => number(p, 0, 1))) throw new Error('Invalid drawing.');
    out.points = [...o.points];
  }
  if (o.type === 'table') {
    const cells = o.cells;
    if (!Array.isArray(cells) || cells.length < 1 || cells.length > 20 || !Array.isArray(cells[0]) || cells[0].length < 1 || cells[0].length > 12 ||
      !cells.every((row) => Array.isArray(row) && row.length === cells[0].length && row.every((cell) => string(cell, 500)))) throw new Error('Tables support up to 20 rows and 12 columns.');
    out.cells = cells.map((row) => [...row]);
  }
  if (o.type === 'image') {
    if (!assetId(o.asset)) throw new Error('Invalid diagram attachment.');
    out.asset = o.asset;
  }
  return fitBoardObject(out);
}

export function parseBoardDocument(raw: unknown): BoardDocument {
  const objects = (raw as BoardDocument | null)?.objects;
  if (!Array.isArray(objects) || objects.length > MAX_BOARD_OBJECTS) throw new Error(`A board can hold ${MAX_BOARD_OBJECTS} objects.`);
  const document = { objects: objects.map(parseBoardObject) };
  if (new Set(document.objects.map((o) => o.id)).size !== objects.length || new TextEncoder().encode(JSON.stringify(document)).length > MAX_BOARD_BYTES ||
    document.objects.reduce((pixels, o) => pixels + Math.min(1_048_576, o.w * o.h), 0) > 32_000_000 || document.objects.filter((o) => o.type === 'image').length > 20) throw new Error('This board is too large or contains duplicate objects. Use up to 20 diagrams.');
  return document;
}

export function putObject(document: BoardDocument, object: BoardObject): BoardDocument {
  return parseBoardDocument({ objects: document.objects.some((o) => o.id === object.id) ? document.objects.map((o) => o.id === object.id ? object : o) : [...document.objects, object] });
}

declare module './types' {
  interface ClientToServerEvents {
    'board:watch': (id: string, ack: (result: BoardResult<{ state: BoardState }>) => void) => void;
    'board:claim': (id: string, ack: (result: BoardResult<{ state: BoardState; token: string }>) => void) => void;
    'board:heartbeat': (id: string, token: string, ack: (result: BoardResult) => void) => void;
    'board:release': (id: string, token: string, ack: (result: BoardResult) => void) => void;
    'board:force-release': (id: string, ack: (result: BoardResult) => void) => void;
    'board:request': (id: string, ack: (result: BoardResult) => void) => void;
    'board:change': (id: string, mutation: BoardMutation, ack: (result: BoardResult<{ state: BoardState }>) => void) => void;
    'board:preview': (id: string, token: string, object: BoardObject | null) => void;
  }
  interface ServerToClientEvents {
    'board:state': (state: BoardState) => void;
    'board:preview': (id: string, object: BoardObject | null) => void;
    'board:requested': (id: string, name: string) => void;
    'board:gone': (id: string) => void;
  }
}
