import type { BoardObject } from '../../../../shared/whiteboard';

export interface TextCell { row: number; column: number }
export function inlineBox(object: BoardObject, viewport: readonly number[], cell?: TextCell) {
  let left = 0, top = 0, width = object.w, height = object.h;
  if (object.type === 'note') { left = Math.min(12, Math.max(0, (width - 1) / 2)); top = Math.min(12, Math.max(0, (height - 1) / 2)); width -= left * 2; height -= top * 2; }
  if (object.type === 'table' && object.cells) {
    const row = Math.max(0, Math.min(object.cells.length - 1, cell?.row ?? 0));
    const column = Math.max(0, Math.min(object.cells[0].length - 1, cell?.column ?? 0));
    width /= object.cells[0].length; height /= object.cells.length;
    const xPad = Math.min(8, Math.max(0, (width - 1) / 2)), yPad = Math.min(8, Math.max(0, (height - 1) / 2));
    left = column * width + xPad; top = row * height + yPad; width -= xPad * 2; height -= yPad * 2;
  }
  const angle = (object.angle ?? 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle), scale = viewport[0];
  const x = viewport[4] + scale * (object.x + c * left - s * top), y = viewport[5] + scale * (object.y + s * left + c * top);
  return { width: Math.max(1, width), height: Math.max(1, height),
    transform: `matrix(${c * scale},${s * scale},${-s * scale},${c * scale},${x},${y})` };
}
export function tableCellAt(object: BoardObject, point: { x: number; y: number }): TextCell {
  const angle = -(object.angle ?? 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const dx = point.x - object.x, dy = point.y - object.y;
  const columns = object.cells?.[0].length ?? 1, rows = object.cells?.length ?? 1;
  return { column: Math.max(0, Math.min(columns - 1, Math.floor((c * dx - s * dy) / object.w * columns))),
    row: Math.max(0, Math.min(rows - 1, Math.floor((s * dx + c * dy) / object.h * rows))) };
}
