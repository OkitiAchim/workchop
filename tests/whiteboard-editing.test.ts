import { describe, expect, it } from 'vitest';
import { inlineBox, tableCellAt } from '../client/src/features/whiteboard/editing';
import type { BoardObject } from '../shared/whiteboard';

const object: BoardObject = { id: 'text', type: 'text', x: 100, y: 80, w: 300, h: 120, color: '#27272a', fill: 'transparent', weight: 3, size: 28, text: 'Hello' };
describe('text editing on the board', () => {
  it('aligns text with zoom and pan rather than using screen coordinates as board coordinates', () => {
    expect(inlineBox(object, [.5, 0, 0, .5, 20, 30])).toEqual({ width: 300, height: 120, transform: 'matrix(0.5,0,0,0.5,70,70)' });
  });
  it('uses the same note padding as the renderer', () => {
    const box = inlineBox({ ...object, type: 'note' }, [1, 0, 0, 1, 0, 0]);
    expect(box).toEqual({ width: 276, height: 96, transform: 'matrix(1,0,0,1,112,92)' });
  });
  it('places an input in the requested table cell', () => {
    const box = inlineBox({ ...object, type: 'table', cells: [['A', 'B'], ['C', 'D']] }, [1, 0, 0, 1, 0, 0], { row: 1, column: 1 });
    expect(box).toEqual({ width: 134, height: 44, transform: 'matrix(1,0,0,1,258,148)' });
  });
  it('finds a cell after the table rotates and clamps edge clicks to valid cells', () => {
    const table = { ...object, type: 'table' as const, angle: 90, cells: [['A', 'B'], ['C', 'D']] };
    expect(tableCellAt(table, { x: 10, y: 300 })).toEqual({ row: 1, column: 1 });
    expect(tableCellAt(table, { x: 1000, y: -1000 })).toEqual({ row: 0, column: 0 });
  });
  it('keeps small or previously compressed objects editable without negative input dimensions', () => {
    const box = inlineBox({ ...object, type: 'note', w: 1, h: 1 }, [1, 0, 0, 1, 0, 0]);
    expect(box.width).toBe(1); expect(box.height).toBe(1);
  });
});
