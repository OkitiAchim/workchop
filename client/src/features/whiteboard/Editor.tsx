import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { Check, Circle, CloudCheck, Copy, Eraser, Hand, History, ImagePlus, Info, LoaderCircle, Minus,
  Maximize2, Minimize2, MoreHorizontal, MousePointer2, MoveRight, Palette, Pencil, Plus, Scan, Shapes, ShieldOff, Square,
  StickyNote, Table2, TextCursorInput, Trash2, Type, Undo2, Redo2, X, type LucideIcon } from 'lucide-react';
import { MAX_IMAGE_BYTES, fitBoardObject, mayEditBoard, type BoardObject, type BoardType } from '../../../../shared/whiteboard';
import { getSession } from '../../lib/session';
import { useStore } from '../../state/store';
import BoardCanvas, { type BoardCanvasHandle } from './Canvas';
import { changeBoard, closeBoard, previewObject, releaseControl, requestControl, takeControl, useBoards } from './state';

function IconButton({ icon: Icon, label, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return <button type="button" className={`wb-icon ${className}`} aria-label={label} title={label} {...props}><Icon size={17} strokeWidth={1.7} aria-hidden="true" /></button>;
}
type Popover = 'info' | 'shapes' | 'more' | 'style' | 'table' | null;
export default function Editor() {
  const { active, boards, token, online, error, saving } = useBoards(), board = active ? boards[active] : undefined;
  const role = useStore((s) => s.role), self = useStore((s) => s.selfId), name = useStore((s) => s.me.name);
  const editing = !!token && online, permitted = mayEditBoard(role);
  const [tool, setTool] = useState('select'), [color, setColor] = useState('#27272a'), [weight, setWeight] = useState(3);
  const [selected, setSelected] = useState<BoardObject | null>(null), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  const [popover, setPopover] = useState<Popover>(null), [zoom, setZoom] = useState(100), [localError, setLocalError] = useState<string | null>(null);
  const [draft, setDraft] = useState(false);
  const [maximized, setMaximized] = useState(false), [fitted, setFitted] = useState(false);
  const fitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const canvas = useRef<BoardCanvasHandle>(null), dialog = useRef<HTMLDivElement>(null), file = useRef<HTMLInputElement>(null);
  const dirty = useRef<BoardObject | null>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), replacement = useRef(false);
  const flush = useCallback(async () => {
    clearTimeout(timer.current); const object = dirty.current; dirty.current = null; setDraft(false);
    return object ? changeBoard({ type: 'put', object }) : true;
  }, []);
  const update = (object: BoardObject) => {
    if (!editing) return;
    const fitted = fitBoardObject(object); setSelected(fitted); canvas.current?.put(fitted); previewObject(fitted); dirty.current = fitted; setDraft(true);
    clearTimeout(timer.current); timer.current = setTimeout(() => { void flush(); }, 350);
  };
  const select = (object: BoardObject | null) => {
    if (dirty.current) { if (dirty.current.id === object?.id) dirty.current = object; else void flush(); }
    setSelected(object);
  };
  const done = async (close = false) => {
    canvas.current?.finishText(); setBusy(true);
    try { if (await flush()) { if (close) await closeBoard(); else await releaseControl(); } } finally { setBusy(false); }
  };
  useEffect(() => { dialog.current?.focus(); return () => { clearTimeout(timer.current); clearTimeout(fitTimer.current); dirty.current = null; }; }, []);
  useEffect(() => { if (!editing) { clearTimeout(timer.current); dirty.current = null; setDraft(false); setSelected(null); setPopover(null); } }, [editing]);
  useEffect(() => {
    if (!popover) return;
    const outside = (event: PointerEvent) => { if (!(event.target as Element).closest('.wb-popover,[data-wb-popover]')) setPopover(null); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [popover]);
  const chooseTool = (value: string) => { canvas.current?.finishText(); void flush(); setPopover(null); setTool(value); };
  const fitBoard = () => {
    canvas.current?.finishText(); void flush(); canvas.current?.fit();
    setFitted(true); clearTimeout(fitTimer.current); fitTimer.current = setTimeout(() => setFitted(false), 1800);
  };
  const toggleMaximize = () => { canvas.current?.finishText(); void flush(); setPopover(null); setMaximized((value) => !value); };
  const add = async (type: BoardType) => {
    canvas.current?.finishText(); setBusy(true); setSelected(null); setPopover(null);
    try {
      if (!await flush()) return;
      setTool('select');
      const count = board?.document.objects.filter((object) => object.type === type).length ?? 0;
      const position = type === 'note' ? { x: 140, y: 240 } : type === 'text' ? { x: 160, y: 90 } : type === 'table' ? { x: 660, y: 220 } : { x: 240, y: 240 };
      const object: BoardObject = fitBoardObject({ id: crypto.randomUUID(), type, x: position.x + count % 4 * 40, y: position.y + Math.floor(count / 4) * 40,
        w: type === 'table' ? 640 : 330, h: type === 'table' ? 300 : type === 'text' ? 140 : 220,
        color, fill: type === 'note' ? '#f3e6ac' : 'transparent', weight: type === 'note' || type === 'table' ? 1 : weight, size: 28,
        ...(['text', 'note'].includes(type) ? { text: '' } : {}),
        ...(type === 'table' ? { cells: [['Heading', 'Heading', 'Heading'], ['', '', ''], ['', '', '']] } : {}) });
      canvas.current?.put(object, true); setSelected(object);
      if (await changeBoard({ type: 'put', object }) && ['text', 'note', 'table'].includes(type)) canvas.current?.edit(object.id);
    } finally { setBusy(false); }
  };
  const command = async (type: 'undo' | 'redo' | 'clear' | 'restore') => {
    canvas.current?.finishText(); setPopover(null); if (!await flush()) return;
    setSelected(null); await changeBoard({ type }); setConfirm(false);
  };
  const remove = async () => {
    if (!selected) return;
    const id = selected.id; canvas.current?.finishText(); if (!await flush()) return;
    canvas.current?.remove(id); await changeBoard({ type: 'delete', id }); setSelected(null); setPopover(null);
  };
  const duplicate = async () => {
    if (!selected) return;
    canvas.current?.finishText(); if (!await flush()) return;
    const object = fitBoardObject({ ...structuredClone(selected), id: crypto.randomUUID(), x: selected.x + 32, y: selected.y + 32 });
    canvas.current?.put(object, true); setSelected(object); await changeBoard({ type: 'put', object });
  };
  const importImage = async (chosen?: File) => {
    if (!chosen || !active || !token) return;
    canvas.current?.finishText(); setBusy(true); setLocalError(null); setPopover(null);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(chosen.type) || chosen.size > MAX_IMAGE_BYTES) throw new Error('Choose a PNG, JPEG or WebP diagram up to 5 MB.');
      if (!await flush()) return;
      const image = await createImageBitmap(chosen);
      try {
        if (image.width > 8192 || image.height > 8192 || image.width * image.height > 16_000_000) throw new Error('Diagram is too large. Use at most 16 megapixels.');
        const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
        const raster = document.createElement('canvas'); raster.width = Math.max(1, Math.round(image.width * scale)); raster.height = Math.max(1, Math.round(image.height * scale));
        raster.getContext('2d')!.drawImage(image, 0, 0, raster.width, raster.height);
        const blob = await new Promise<Blob>((resolve, reject) => raster.toBlob((b) => b ? resolve(b) : reject(new Error('Could not read diagram.')), 'image/png'));
        if (blob.size > MAX_IMAGE_BYTES) throw new Error('Resized diagram exceeds 5 MB. Try a smaller image.');
        const asset = await getSession()!.upload(blob, { name: chosen.name.replace(/\.[^.]+$/, '') + '.png', whiteboard: { id: active, token } });
        const prior = replacement.current && selected?.type === 'image' ? selected : null;
        const fit = Math.min(1, 720 / raster.width, 650 / raster.height), w = raster.width * fit, h = raster.height * fit;
        const object: BoardObject = { id: prior?.id ?? crypto.randomUUID(), type: 'image', x: prior?.x ?? 160, y: prior?.y ?? 100,
          w: prior?.w ?? w, h: prior?.h ?? h, angle: prior?.angle ?? 0, color, fill: 'transparent', size: 24, weight: 1, asset: asset.id };
        canvas.current?.put(object, true); setSelected(object); setTool('select'); await changeBoard({ type: 'put', object });
      } finally { image.close(); }
    } catch (failure) { setLocalError((failure as Error).message); }
    finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  const tableSize = (rows: number, columns: number) => {
    if (!selected?.cells) return;
    canvas.current?.finishText(); update({ ...selected, cells: Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => selected.cells?.[row]?.[column] ?? '')) });
  };
  const toggle = (value: Popover) => setPopover((prior) => prior === value ? null : value), disabled = !editing || busy;
  const editorName = board?.editor?.name ?? name;
  const status = !online ? 'Reconnecting · editing paused' : editing ? 'Your editing turn · everyone can watch live' : board?.editor ? `${editorName} is editing · live view` : permitted ? 'Ready · take control to edit' : 'Guest view · members can edit';
  const saveStatus = draft ? 'Typing · changes will save shortly' : saving ? 'Saving changes' : board ? `All changes saved · version ${board.revision}` : 'Loading board';
  return <div className={`wb-backdrop${maximized ? ' wb-expanded' : ''}`} onPointerDown={(event) => event.stopPropagation()}>
    <div className={`wb-dialog${maximized ? ' wb-maximized' : ''}`} role="dialog" aria-modal="true" aria-label="Shared whiteboard" tabIndex={-1} ref={dialog} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault(); if (popover || confirm) { setPopover(null); setConfirm(false); }
        else if (canvas.current?.finishText()) void flush(); else if (!busy) void done(true);
      }
      if (event.key === 'Tab') {
        const nodes = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')].filter((node) => node.getClientRects().length);
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      if ((event.target as Element).closest('input,textarea,select') || event.ctrlKey || event.metaKey || event.altKey || disabled) return;
      const value = ({ v: 'select', h: 'pan', p: 'pen', e: 'erase' } as Record<string, string>)[event.key.toLowerCase()];
      if (value) { event.preventDefault(); chooseTool(value); }
      else if (event.key.toLowerCase() === 't') { event.preventDefault(); void add('text'); }
      else if (event.key.toLowerCase() === 'n') { event.preventDefault(); void add('note'); }
    }}>
      <header className="wb-strip">
        <div className="wb-tools" role="toolbar" aria-label="Whiteboard tools">
          {([{ value: 'select', icon: MousePointer2, label: 'Select' }, { value: 'pan', icon: Hand, label: 'Pan' }, { value: 'pen', icon: Pencil, label: 'Pen' }, { value: 'erase', icon: Eraser, label: 'Eraser' }]).map(({ value, icon, label }) => <IconButton key={value} icon={icon} label={label} aria-pressed={tool === value} disabled={value === 'pan' ? busy : disabled} onClick={() => chooseTool(value)} />)}
          <span className="wb-divider" />
          <IconButton icon={Type} label="Text" disabled={disabled} onClick={() => void add('text')} />
          <IconButton icon={StickyNote} label="Note" disabled={disabled} onClick={() => void add('note')} />
          <IconButton icon={Table2} label="Table" disabled={disabled} onClick={() => void add('table')} />
          <IconButton icon={Shapes} label="Shapes and lines" disabled={disabled} data-wb-popover aria-expanded={popover === 'shapes'} onClick={() => toggle('shapes')} />
          <IconButton icon={ImagePlus} label="Import diagram" disabled={disabled} onClick={() => { replacement.current = false; file.current?.click(); }} />
          <span className="wb-divider" />
          <IconButton icon={Undo2} label="Undo" disabled={disabled || !board?.undo} onClick={() => void command('undo')} />
          <IconButton icon={Redo2} label="Redo" disabled={disabled || !board?.redo} onClick={() => void command('redo')} />
          <IconButton icon={Palette} label="Ink and stroke settings" disabled={disabled} data-wb-popover aria-expanded={popover === 'style' && !selected} onClick={() => toggle('style')} />
        </div>
        <div className="wb-session" role="toolbar" aria-label="Board session">
          <span className={`wb-save ${saving || draft ? 'wb-saving' : ''}`} role="status" aria-label={saveStatus} title={saveStatus}>{saving || draft || !online ? <LoaderCircle size={16} /> : <CloudCheck size={16} />}</span>
          <span className="wb-avatar" role="img" aria-label={status} title={status}>{(board?.editor ? editorName : name).slice(0, 1).toUpperCase()}</span>
          {editing ? <IconButton icon={Check} label="Done editing" className="wb-primary" disabled={busy} onClick={() => void done()} /> : permitted && online && board ? board.editor && board.editor.id !== self ? <IconButton icon={Hand} label="Request control" disabled={busy} onClick={() => void requestControl()} /> : <IconButton icon={Pencil} label="Take control" className="wb-primary" disabled={busy} onClick={() => void takeControl()} /> : null}
          <IconButton icon={Info} label="Board information" data-wb-popover aria-expanded={popover === 'info'} onClick={() => toggle('info')} />
          <IconButton icon={MoreHorizontal} label="More board actions" data-wb-popover aria-expanded={popover === 'more'} onClick={() => toggle('more')} />
          <IconButton icon={maximized ? Minimize2 : Maximize2} label={maximized ? 'Restore board size' : 'Maximize board'} aria-pressed={maximized} onClick={toggleMaximize} />
          <IconButton icon={X} label="Close whiteboard" disabled={busy} onClick={() => void done(true)} />
        </div>
      </header>
      <input ref={file} type="file" aria-label="Diagram file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void importImage(event.target.files?.[0])} />
      {(error || localError) && <div className="wb-error" role="alert">{localError || error}</div>}
      <div className="wb-body">
        <BoardCanvas ref={canvas} tool={tool} color={color} weight={weight} blocked={busy} onSelect={select} onChange={update} onCommit={() => void flush()} onZoom={setZoom} />
        {editing && selected && <div className="wb-context" role="toolbar" aria-label="Selected object controls">
          {['text', 'note', 'table'].includes(selected.type) && <><IconButton icon={TextCursorInput} label="Edit text on board" disabled={busy} onClick={() => canvas.current?.edit(selected.id)} /><label title="Text size"><Type size={15} aria-hidden="true" /><input disabled={busy} aria-label="Text size" type="number" min={10} max={96} value={selected.size} onChange={(event) => update({ ...selected, size: Math.max(10, Math.min(96, +event.target.value || 10)) })} /></label></>}
          <IconButton icon={Palette} label="Object style" disabled={busy} data-wb-popover aria-expanded={popover === 'style'} onClick={() => toggle('style')} />
          {selected.type === 'table' && <IconButton icon={Table2} label="Table dimensions" disabled={busy} data-wb-popover aria-expanded={popover === 'table'} onClick={() => toggle('table')} />}
          {selected.type === 'image' && <IconButton icon={ImagePlus} label="Replace diagram" disabled={busy} onClick={() => { replacement.current = true; file.current?.click(); }} />}
          <span className="wb-divider" /><IconButton icon={Copy} label="Duplicate selected" disabled={busy} onClick={() => void duplicate()} /><IconButton icon={Trash2} label="Delete selected" disabled={busy} onClick={() => void remove()} />
        </div>}
        <div className="wb-navigation" role="toolbar" aria-label="Canvas navigation"><IconButton icon={Minus} label="Zoom out" onClick={() => canvas.current?.zoom(1 / 1.2)} /><button type="button" className="wb-zoom" title="Fit board" aria-label={`Zoom ${zoom} percent. Fit board`} onClick={fitBoard}>{zoom}%</button><IconButton icon={Plus} label="Zoom in" onClick={() => canvas.current?.zoom(1.2)} /><span className="wb-divider" /><IconButton icon={Scan} label="Fit board" onClick={fitBoard} /></div>
        {fitted && <div className="wb-fit-notice" role="status">Board fitted to view</div>}
        {popover && <div className={`wb-popover wb-popover-${popover}`} role="dialog" aria-label={({ info: 'Board information', shapes: 'Shapes and lines', more: 'Board actions', style: 'Object style', table: 'Table dimensions' })[popover]}>
          <div className="wb-popover-heading"><strong>{({ info: 'Board guide', shapes: 'Shapes', more: 'Board actions', style: 'Style', table: 'Table dimensions' })[popover]}</strong><IconButton icon={X} label="Close menu" onClick={() => setPopover(null)} /></div>
          {popover === 'info' && <div className="wb-guide"><p className="wb-guide-status">{status}<br />{saveStatus}</p><strong>Write on the board</strong><p>Add Text or Note and start typing. Double-click existing text, a note, or a table cell to edit it in place.</p><strong>Keep the same arrangement</strong><p>The fixed 16:9 board matches the office display. Move and resize content within its margin; scroll to zoom or choose Pan. Maximize enlarges the window; Fit board resets zoom and recenters the entire board.</p><strong>One editor at a time</strong><p>Everyone watches live. The checkmark saves and releases your turn. The next editor gets the same saved content.</p><strong>Import diagrams</strong><p>PNG, JPEG or WebP · up to 5 MB. Select an image to resize, move or replace it.</p><div className="wb-shortcuts"><span>Select <kbd>V</kbd></span><span>Pan <kbd>H</kbd></span><span>Pen <kbd>P</kbd></span><span>Note <kbd>N</kbd></span></div></div>}
          {popover === 'shapes' && <div className="wb-shapes">{([{ type: 'rect', icon: Square, label: 'Rectangle' }, { type: 'ellipse', icon: Circle, label: 'Circle' }, { type: 'line', icon: Minus, label: 'Line' }, { type: 'arrow', icon: MoveRight, label: 'Arrow' }] as const).map(({ type, icon, label }) => <IconButton key={type} icon={icon} label={label} disabled={disabled} onClick={() => void add(type)} />)}</div>}
          {popover === 'more' && <div className="wb-menu"><button disabled={disabled || !board?.recovery} onClick={() => void command('restore')}><History size={16} aria-hidden="true" />Recover snapshot</button><button disabled={disabled || !board?.document.objects.length} onClick={() => { setPopover(null); setConfirm(true); }}><Trash2 size={16} aria-hidden="true" />Clear board</button>{!editing && board?.editor && (role === 'owner' || role === 'admin') && <button onClick={() => { void requestControl(true); setPopover(null); }}><ShieldOff size={16} aria-hidden="true" />Release editor</button>}</div>}
          {popover === 'style' && <div className="wb-style"><label>Ink<input aria-label="Ink color" type="color" value={selected?.color ?? color} disabled={disabled} onChange={(event) => { setColor(event.target.value); if (selected) update({ ...selected, color: event.target.value }); }} /></label><label>Width<input aria-label="Pen width" type="number" min={1} max={24} value={selected?.weight ?? weight} disabled={disabled} onChange={(event) => { const value = Math.max(1, Math.min(24, +event.target.value || 1)); setWeight(value); if (selected) update({ ...selected, weight: value }); }} /></label>{selected && ['note', 'rect', 'ellipse'].includes(selected.type) && <label>Fill<input aria-label="Fill color" type="color" value={selected.fill === 'transparent' ? '#ffffff' : selected.fill} disabled={disabled} onChange={(event) => update({ ...selected, fill: event.target.value })} /></label>}</div>}
          {popover === 'table' && selected?.cells && <div className="wb-style"><label>Rows<input aria-label="Table rows" type="number" min={1} max={20} value={selected.cells.length} disabled={busy} onChange={(event) => tableSize(Math.max(1, Math.min(20, +event.target.value || 1)), selected.cells![0].length)} /></label><label>Columns<input aria-label="Table columns" type="number" min={1} max={12} value={selected.cells[0].length} disabled={busy} onChange={(event) => tableSize(selected.cells!.length, Math.max(1, Math.min(12, +event.target.value || 1)))} /></label></div>}
        </div>}
        {confirm && <div className="wb-confirm-backdrop"><div className="wb-confirm" role="alertdialog" aria-modal="true" aria-label="Clear board confirmation"><strong>Clear this board?</strong><p>A recovery snapshot will be kept.</p><div><button onClick={() => setConfirm(false)}>Cancel</button><button className="wb-primary" onClick={() => void command('clear')}>Clear board</button></div></div></div>}
      </div>
    </div>
  </div>;
}
