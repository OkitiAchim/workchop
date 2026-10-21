import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas, Rect, FabricImage, Point, type FabricObject } from 'fabric';
import { BOARD_HEIGHT, BOARD_WIDTH, BOARD_MARGIN, fitBoardObject, type BoardObject } from '../../../../shared/whiteboard';
import { assetVersion, subscribeAssets } from './assets';
import { paintBoard, visibleObjects } from './render';
import { useBoards, previewObject, changeBoard } from './state';
import { inlineBox, tableCellAt, type TextCell } from './editing';

type Shape = FabricObject & { boardId?: string };
export interface BoardCanvasHandle {
  put(o: BoardObject, select?: boolean): void; remove(id: string): void; fit(): void; zoom(factor: number): void;
  edit(id: string, cell?: TextCell): void; finishText(): boolean;
}
interface Props {
  tool: string; color: string; weight: number; blocked: boolean; onSelect(o: BoardObject | null): void;
  onChange(o: BoardObject): void; onCommit(): void; onZoom(percent: number): void;
}
interface InlineEdit { object: BoardObject; cell?: TextCell }

export default forwardRef<BoardCanvasHandle, Props>(function BoardCanvas(props, ref) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<Canvas | null>(null);
  const mount = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  const [inline, setInline] = useState<InlineEdit | null>(null), inlineRef = useRef<InlineEdit | null>(null);
  const [viewport, setViewport] = useState<number[]>([1, 0, 0, 1, 0, 0]);
  const startText = useRef<(id: string, cell?: TextCell) => void>(() => {});
  const finishText = useRef<(commit?: boolean) => boolean>(() => false), zoom = useRef<(factor: number) => void>(() => {});
  const models = useRef(new Map<string, BoardObject>()), current = useRef(props); current.current = props;
  const editable = useBoards((s) => !!s.token && s.online), epoch = useBoards((s) => s.epoch);
  const board = useBoards((s) => s.active ? s.boards[s.active] : undefined);
  const version = useSyncExternalStore(subscribeAssets, assetVersion);
  const editRef = useRef(editable); editRef.current = editable;
  const replace = useRef<(o: BoardObject, select?: boolean) => void>(() => {}), fit = useRef(() => {});
  const suppressSelection = useRef(false);
  const previous = useRef({ boardId: '', epoch: -1, editable: false, version: -1 });
  useImperativeHandle(ref, () => ({ put: (o, select) => replace.current(o, select), remove: (id) => {
    if (inlineRef.current?.object.id === id) finishText.current(false);
    const c = canvas.current; models.current.delete(id);
    const object = c?.getObjects().find((v) => (v as Shape).boardId === id); if (object) c?.remove(object);
    c?.requestRenderAll();
  }, fit: () => fit.current(), zoom: (factor) => zoom.current(factor), edit: (id, cell) => startText.current(id, cell), finishText: () => finishText.current(false) }));

  useEffect(() => {
    if (!inline || props.blocked) return;
    const field = input.current; field?.focus();
    if (field && (field.value === 'New note' || field.value === 'Type your text' || field.value === 'Heading')) field.select();
  }, [inline?.object.id, inline?.cell?.row, inline?.cell?.column, props.blocked]);
  useEffect(() => { if (!editable) finishText.current(false); }, [editable, epoch]);

  useEffect(() => {
    const parent = host.current!;
    // Fabric may restore its original element while disposal finishes. Isolate each React
    // lifecycle so an old restored canvas cannot precede/push down the current canvas.
    const lifetime = document.createElement('div'); lifetime.className = 'wb-fabric-instance'; mount.current!.appendChild(lifetime);
    const element = document.createElement('canvas'); lifetime.appendChild(element);
    models.current.clear(); previous.current = { boardId: '', epoch: -1, editable: false, version: -1 };
    const c = new Canvas(element, { selection: false, preserveObjectStacking: true,
      renderOnAddRemove: false, enableRetinaScaling: true }); canvas.current = c;
    c.clipPath = new Rect({ left: 0, top: 0, width: BOARD_WIDTH, height: BOARD_HEIGHT, originX: 'left', originY: 'top', absolutePositioned: true });
    const page = new Rect({ left: 0, top: 0, width: BOARD_WIDTH, height: BOARD_HEIGHT, originX: 'left', originY: 'top', fill: '#ffffff', selectable: false, evented: false });
    const margin = new Rect({ left: BOARD_MARGIN, top: BOARD_MARGIN, width: BOARD_WIDTH - 2 * BOARD_MARGIN,
      height: BOARD_HEIGHT - 2 * BOARD_MARGIN, originX: 'left', originY: 'top', fill: 'transparent', stroke: '#d4d4d8', strokeWidth: 1,
      strokeDashArray: [6, 6], selectable: false, evented: false });
    c.add(page, margin);
    let drawing: { id: string; points: number[] } | null = null, panning = false, last = { x: 0, y: 0 };
    const modelOf = (v: FabricObject): BoardObject | null => {
      const o = models.current.get((v as Shape).boardId ?? ''); if (!o) return null;
      return fitBoardObject({ ...o, x: v.left, y: v.top, angle: ((v.angle + 360) % 360), w: Math.max(1, v.width * v.scaleX), h: Math.max(1, v.height * v.scaleY) });
    };
    const select = (target?: FabricObject) => { if (!suppressSelection.current) current.current.onSelect(target ? modelOf(target) : null); };
    replace.current = (raw, choose = false) => {
      const o = fitBoardObject(raw);
      const previousSuppress = suppressSelection.current; suppressSelection.current = true;
      models.current.set(o.id, o);
      const old = c.getObjects().find((v) => (v as Shape).boardId === o.id), selected = choose || (!!old && c.getActiveObject() === old);
      const index = old ? c.getObjects().indexOf(old) : c.getObjects().length - 1;
      if (old) c.remove(old);
      const options = { left: o.x, top: o.y, originX: 'left' as const, originY: 'top' as const,
        strokeWidth: 0, objectCaching: false,
        selectable: editRef.current && current.current.tool === 'select', evented: true,
        angle: o.angle ?? 0, lockScalingFlip: true, borderColor: '#52525b', cornerColor: '#ffffff', cornerStrokeColor: '#52525b', transparentCorners: false };
      // Repaint each object from its current data; Fabric never reuses a stale note/text bitmap.
      const scale = Math.min(1, 1024 / Math.max(o.w, o.h));
      const bitmap = document.createElement('canvas'); bitmap.width = Math.max(1, Math.ceil(o.w * scale)); bitmap.height = Math.max(1, Math.ceil(o.h * scale));
      paintBoard(bitmap, { document: { objects: [{ ...o, x: 0, y: 0, angle: 0 }] }, preview: null }, { width: o.w, height: o.h, transparent: true },
        inlineRef.current?.object.id === o.id ? { id: o.id, ...inlineRef.current.cell } : undefined);
      const object: Shape = new FabricImage(bitmap, { ...options, scaleX: o.w / bitmap.width, scaleY: o.h / bitmap.height });
      object.boardId = o.id; c.insertAt(index, object);
      if (selected && editRef.current) c.setActiveObject(object); c.requestRenderAll(); suppressSelection.current = previousSuppress;
      if (inlineRef.current?.object.id === o.id) {
        inlineRef.current = { ...inlineRef.current, object: o }; setInline(inlineRef.current);
      }
    };
    finishText.current = (commit = true) => {
      const active = inlineRef.current; if (!active) return false;
      inlineRef.current = null; setInline(null);
      const object = models.current.get(active.object.id); if (object) replace.current(object);
      if (commit) current.current.onCommit(); return true;
    };
    startText.current = (id, cell) => {
      if (!editRef.current) return;
      const object = models.current.get(id); if (!object || !['text', 'note', 'table'].includes(object.type)) return;
      if (inlineRef.current) finishText.current();
      const value = { object, ...(object.type === 'table' ? { cell: cell ?? { row: 0, column: 0 } } : {}) };
      inlineRef.current = value; setInline(value); replace.current(object, true); current.current.onSelect(object);
    };
    const changedView = () => {
      setViewport([...c.viewportTransform]);
      const base = Math.min(c.width / BOARD_WIDTH, c.height / BOARD_HEIGHT);
      current.current.onZoom(Math.round(c.getZoom() / base * 100));
    };
    fit.current = () => {
      const bounds = parent.getBoundingClientRect(), scale = Math.min(bounds.width / BOARD_WIDTH, bounds.height / BOARD_HEIGHT);
      c.setDimensions({ width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) });
      c.setViewportTransform([scale, 0, 0, scale, (bounds.width - BOARD_WIDTH * scale) / 2, (bounds.height - BOARD_HEIGHT * scale) / 2]);
      parent.dataset.boardAspect = `${BOARD_WIDTH}/${BOARD_HEIGHT}`;
      c.requestRenderAll(); changedView();
    };
    zoom.current = (factor) => {
      const base = Math.min(c.width / BOARD_WIDTH, c.height / BOARD_HEIGHT);
      c.zoomToPoint(new Point(c.width / 2, c.height / 2), Math.min(base * 4, Math.max(base * 0.5, c.getZoom() * factor)));
      changedView();
    };
    const observer = new ResizeObserver(() => fit.current()); observer.observe(parent); fit.current();
    c.on('selection:created', (e) => select(e.selected[0])); c.on('selection:updated', (e) => select(e.selected[0])); c.on('selection:cleared', () => select());
    c.on('mouse:dblclick', (event) => {
      if (!event.target || current.current.tool !== 'select' || current.current.blocked) return;
      const object = models.current.get((event.target as Shape).boardId ?? '');
      if (object) startText.current(object.id, object.type === 'table' ? tableCellAt(object, event.scenePoint) : undefined);
    });
    const transform = (target?: FabricObject, commit = false) => {
      if (!target || !editRef.current) return;
      const o = modelOf(target); if (!o) return;
      target.set({ left: o.x, top: o.y, scaleX: o.w / target.width, scaleY: o.h / target.height }); target.setCoords();
      models.current.set(o.id, o); current.current.onSelect(o); previewObject(o);
      if (commit) { replace.current(o); void changeBoard({ type: 'put', object: o }); }
    };
    c.on('object:moving', (e) => transform(e.target)); c.on('object:scaling', (e) => transform(e.target)); c.on('object:rotating', (e) => transform(e.target)); c.on('object:modified', (e) => transform(e.target, true));
    const stroke = (): BoardObject | null => {
      if (!drawing || drawing.points.length < 4) return null;
      const xs = drawing.points.filter((_, i) => i % 2 === 0), ys = drawing.points.filter((_, i) => i % 2 === 1);
      const pad = current.current.weight / 2, x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
      const w = Math.max(1, Math.max(...xs) - x + pad), h = Math.max(1, Math.max(...ys) - y + pad);
      return fitBoardObject({ id: drawing.id, type: 'stroke', x, y, w, h, points: drawing.points.map((p, i) => (p - (i % 2 ? y : x)) / (i % 2 ? h : w)), color: current.current.color, fill: 'transparent', weight: current.current.weight, size: 24 });
    };
    c.on('mouse:down', (e) => {
      if (current.current.blocked) return;
      const tool = current.current.tool;
      if (tool === 'pan' || !editRef.current) { panning = true; last = { x: e.viewportPoint.x, y: e.viewportPoint.y }; return; }
      if (tool === 'erase' && e.target) {
        const id = (e.target as Shape).boardId; if (id) { c.remove(e.target); models.current.delete(id); void changeBoard({ type: 'delete', id }); }
      }
      if (tool === 'pen') {
        const p = e.scenePoint, pad = BOARD_MARGIN + current.current.weight / 2;
        if (p.x < BOARD_MARGIN || p.x > BOARD_WIDTH - BOARD_MARGIN || p.y < BOARD_MARGIN || p.y > BOARD_HEIGHT - BOARD_MARGIN) return;
        drawing = { id: crypto.randomUUID(), points: [Math.max(pad, Math.min(BOARD_WIDTH - pad, p.x)), Math.max(pad, Math.min(BOARD_HEIGHT - pad, p.y))] };
      }
    });
    c.on('mouse:move', (e) => {
      if (panning) { c.relativePan(new Point(e.viewportPoint.x - last.x, e.viewportPoint.y - last.y)); last = { x: e.viewportPoint.x, y: e.viewportPoint.y }; changedView(); }
      if (!drawing || drawing.points.length >= 5998) return;
      const pad = BOARD_MARGIN + current.current.weight / 2;
      const x = Math.max(pad, Math.min(BOARD_WIDTH - pad, e.scenePoint.x)), y = Math.max(pad, Math.min(BOARD_HEIGHT - pad, e.scenePoint.y));
      if (Math.hypot(x - drawing.points.at(-2)!, y - drawing.points.at(-1)!) < 2) return;
      drawing.points.push(x, y); const o = stroke(); if (o) { replace.current(o); previewObject(o); }
    });
    c.on('mouse:up', () => { panning = false; const o = stroke(); drawing = null; if (o) void changeBoard({ type: 'put', object: o }); });
    c.on('mouse:wheel', (e) => {
      const base = Math.min(c.width / BOARD_WIDTH, c.height / BOARD_HEIGHT);
      c.zoomToPoint(e.viewportPoint, Math.min(base * 4, Math.max(base * 0.5, c.getZoom() * 0.999 ** e.e.deltaY)));
      changedView();
      e.e.preventDefault(); e.e.stopPropagation();
    });
    return () => { observer.disconnect(); c.cancelRequestedRender(); canvas.current = null; models.current.clear(); inlineRef.current = null; lifetime.remove(); void c.dispose(); };
  }, []);
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    for (const o of c.getObjects()) if ((o as Shape).boardId) o.set({ selectable: editable && props.tool === 'select', evented: true });
    c.defaultCursor = props.tool === 'pan' || !editable ? 'grab' : props.tool === 'select' ? 'default' : 'crosshair';
    c.discardActiveObject(); c.requestRenderAll();
  }, [editable, props.tool]);
  useEffect(() => {
    const c = canvas.current; if (!c || !board) return;
    const hydrate = previous.current.boardId !== board.boardId || previous.current.epoch !== epoch || previous.current.editable !== editable;
    if (!editable || hydrate || previous.current.version !== version) {
      const selected = (c.getActiveObject() as Shape | undefined)?.boardId;
      const objects = editable && !hydrate ? [...models.current.values()] : visibleObjects(board);
      suppressSelection.current = true;
      const ids = new Set(objects.map((o) => o.id));
      for (const o of c.getObjects()) if ((o as Shape).boardId && !ids.has((o as Shape).boardId!)) { c.remove(o); models.current.delete((o as Shape).boardId!); }
      const rendered = new Set(c.getObjects().map((o) => (o as Shape).boardId));
      for (const o of objects) if (hydrate || !rendered.has(o.id) || previous.current.version !== version || JSON.stringify(models.current.get(o.id)) !== JSON.stringify(o)) replace.current(o);
      const shapes = new Map(c.getObjects().filter((o) => (o as Shape).boardId).map((o) => [(o as Shape).boardId!, o]));
      objects.forEach((o, index) => { const shape = shapes.get(o.id); if (shape) c.moveObjectTo(shape, index + 1); });
      if (selected && editable) { const target = c.getObjects().find((v) => (v as Shape).boardId === selected); if (target) c.setActiveObject(target); }
      if (!editable) c.discardActiveObject();
      c.requestRenderAll(); suppressSelection.current = false;
    }
    previous.current = { boardId: board.boardId, epoch, editable, version };
  }, [board, editable, epoch, version]);
  const box = inline ? inlineBox(inline.object, viewport, inline.cell) : null;
  return <div className="wb-canvas" ref={host} aria-label="Whiteboard canvas" data-testid="board-canvas">
    <div className="wb-fabric" ref={mount} />
    {inline && box && editable && <textarea key={`${inline.object.id}:${inline.cell?.row ?? ''}:${inline.cell?.column ?? ''}`}
      ref={input} className="wb-inline-text" aria-label={inline.cell ? `Row ${inline.cell.row + 1} column ${inline.cell.column + 1}` : 'Object text'}
      placeholder={inline.object.type === 'note' ? 'Type a note…' : 'Type your text…'} spellCheck
      disabled={props.blocked} maxLength={inline.cell ? 500 : 5000}
      value={inline.cell ? inline.object.cells?.[inline.cell.row]?.[inline.cell.column] ?? '' : inline.object.text ?? ''}
      style={{ width: box.width, height: box.height, transform: box.transform, fontSize: inline.object.size, color: inline.object.color }}
      onPointerDown={(event) => event.stopPropagation()} onBlur={() => finishText.current()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finishText.current(); host.current?.closest<HTMLElement>('[role="dialog"]')?.focus(); }
        if (event.key === 'Tab' && inline.cell && inline.object.cells) {
          const columns = inline.object.cells[0].length, total = inline.object.cells.length * columns;
          const next = inline.cell.row * columns + inline.cell.column + (event.shiftKey ? -1 : 1);
          if (next >= 0 && next < total) { event.preventDefault(); event.stopPropagation(); startText.current(inline.object.id, { row: Math.floor(next / columns), column: next % columns }); }
        }
      }}
      onChange={(event) => {
        const active = inlineRef.current; if (!active || !editRef.current || props.blocked) return;
        const object = active.object;
        const updated = active.cell ? { ...object, cells: object.cells!.map((row, r) => row.map((value, c) => r === active.cell!.row && c === active.cell!.column ? event.target.value : value)) } : { ...object, text: event.target.value };
        current.current.onChange(updated);
      }} />}
  </div>;
});
