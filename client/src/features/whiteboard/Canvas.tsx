import { forwardRef, useEffect, useImperativeHandle, useRef, useSyncExternalStore } from 'react';
import { Canvas, Rect, FabricImage, Point, type FabricObject } from 'fabric';
import { BOARD_HEIGHT, BOARD_WIDTH, BOARD_MARGIN, fitBoardObject, type BoardObject } from '../../../../shared/whiteboard';
import { assetVersion, subscribeAssets } from './assets';
import { paintBoard, visibleObjects } from './render';
import { useBoards, previewObject, changeBoard } from './state';

type Shape = FabricObject & { boardId?: string };
export interface BoardCanvasHandle { put(o: BoardObject, select?: boolean): void; remove(id: string): void; fit(): void }
interface Props { tool: string; color: string; weight: number; onSelect(o: BoardObject | null): void }

export default forwardRef<BoardCanvasHandle, Props>(function BoardCanvas(props, ref) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<Canvas | null>(null);
  const models = useRef(new Map<string, BoardObject>()), current = useRef(props); current.current = props;
  const editable = useBoards((s) => !!s.token && s.online), epoch = useBoards((s) => s.epoch);
  const board = useBoards((s) => s.active ? s.boards[s.active] : undefined);
  const version = useSyncExternalStore(subscribeAssets, assetVersion);
  const editRef = useRef(editable); editRef.current = editable;
  const replace = useRef<(o: BoardObject, select?: boolean) => void>(() => {}), fit = useRef(() => {});
  const suppressSelection = useRef(false);
  const previous = useRef({ boardId: '', epoch: -1, editable: false, version: -1 });
  useImperativeHandle(ref, () => ({ put: (o, select) => replace.current(o, select), remove: (id) => {
    const c = canvas.current; models.current.delete(id);
    const object = c?.getObjects().find((v) => (v as Shape).boardId === id); if (object) c?.remove(object);
    c?.requestRenderAll();
  }, fit: () => fit.current() }));

  useEffect(() => {
    const parent = host.current!;
    const element = document.createElement('canvas'); parent.appendChild(element);
    models.current.clear(); previous.current = { boardId: '', epoch: -1, editable: false, version: -1 };
    const c = new Canvas(element, { selection: false, preserveObjectStacking: true,
      renderOnAddRemove: false, enableRetinaScaling: true }); canvas.current = c;
    c.clipPath = new Rect({ left: 0, top: 0, width: BOARD_WIDTH, height: BOARD_HEIGHT, originX: 'left', originY: 'top', absolutePositioned: true });
    const page = new Rect({ left: 0, top: 0, width: BOARD_WIDTH, height: BOARD_HEIGHT, originX: 'left', originY: 'top', fill: '#ffffff', selectable: false, evented: false });
    const margin = new Rect({ left: BOARD_MARGIN, top: BOARD_MARGIN, width: BOARD_WIDTH - 2 * BOARD_MARGIN,
      height: BOARD_HEIGHT - 2 * BOARD_MARGIN, originX: 'left', originY: 'top', fill: 'transparent', stroke: '#c8d0df', strokeWidth: 1,
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
        angle: o.angle ?? 0, lockScalingFlip: true, cornerColor: '#3457df', transparentCorners: false };
      // Repaint each object from its current data; Fabric never reuses a stale note/text bitmap.
      const scale = Math.min(1, 1024 / Math.max(o.w, o.h));
      const bitmap = document.createElement('canvas'); bitmap.width = Math.max(1, Math.ceil(o.w * scale)); bitmap.height = Math.max(1, Math.ceil(o.h * scale));
      paintBoard(bitmap, { document: { objects: [{ ...o, x: 0, y: 0, angle: 0 }] }, preview: null }, { width: o.w, height: o.h, transparent: true });
      const object: Shape = new FabricImage(bitmap, { ...options, scaleX: o.w / bitmap.width, scaleY: o.h / bitmap.height });
      object.boardId = o.id; c.insertAt(index, object);
      if (selected && editRef.current) c.setActiveObject(object); c.requestRenderAll(); suppressSelection.current = previousSuppress;
    };
    fit.current = () => {
      const bounds = parent.getBoundingClientRect(), scale = Math.min(bounds.width / BOARD_WIDTH, bounds.height / BOARD_HEIGHT);
      c.setDimensions({ width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) });
      c.setViewportTransform([scale, 0, 0, scale, (bounds.width - BOARD_WIDTH * scale) / 2, (bounds.height - BOARD_HEIGHT * scale) / 2]);
      parent.dataset.boardAspect = `${BOARD_WIDTH}/${BOARD_HEIGHT}`;
      c.requestRenderAll();
    };
    const observer = new ResizeObserver(() => fit.current()); observer.observe(parent); fit.current();
    c.on('selection:created', (e) => select(e.selected[0])); c.on('selection:updated', (e) => select(e.selected[0])); c.on('selection:cleared', () => select());
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
      if (panning) { c.relativePan(new Point(e.viewportPoint.x - last.x, e.viewportPoint.y - last.y)); last = { x: e.viewportPoint.x, y: e.viewportPoint.y }; }
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
      e.e.preventDefault(); e.e.stopPropagation();
    });
    return () => { observer.disconnect(); c.cancelRequestedRender(); canvas.current = null; models.current.clear(); void c.dispose(); parent.replaceChildren(); };
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
  return <div className="wb-canvas" ref={host} aria-label="Whiteboard canvas" data-testid="board-canvas" />;
});
