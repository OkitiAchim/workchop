import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_IMAGE_BYTES, fitBoardObject, mayEditBoard, type BoardObject, type BoardType } from '../../../../shared/whiteboard';
import { getSession } from '../../lib/session';
import { useStore } from '../../state/store';
import BoardCanvas, { type BoardCanvasHandle } from './Canvas';
import { changeBoard, closeBoard, previewObject, releaseControl, requestControl, takeControl, useBoards } from './state';

export default function Editor() {
  const { active, boards, token, online, error, saving } = useBoards();
  const board = active ? boards[active] : undefined;
  const role = useStore((s) => s.role), self = useStore((s) => s.selfId);
  const editing = !!token && online, permitted = mayEditBoard(role);
  const [tool, setTool] = useState('select'), [color, setColor] = useState('#24324b'), [weight, setWeight] = useState(4);
  const [selected, setSelected] = useState<BoardObject | null>(null), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const canvas = useRef<BoardCanvasHandle>(null), dialog = useRef<HTMLDivElement>(null), file = useRef<HTMLInputElement>(null);
  const dirty = useRef<BoardObject | null>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const replacement = useRef(false);
  const textInput = useRef<HTMLTextAreaElement>(null), focusNewText = useRef<string | null>(null);
  const flush = useCallback(async () => {
    clearTimeout(timer.current); const o = dirty.current; dirty.current = null;
    return o ? changeBoard({ type: 'put', object: o }) : true;
  }, []);
  const update = (o: BoardObject) => {
    if (!editing) return;
    const fitted = fitBoardObject(o);
    setSelected(fitted); canvas.current?.put(fitted); previewObject(fitted); dirty.current = fitted;
    clearTimeout(timer.current); timer.current = setTimeout(() => { void flush(); }, 350);
  };
  const select = (o: BoardObject | null) => {
    if (dirty.current) {
      if (dirty.current.id === o?.id) dirty.current = o;
      else void flush();
    }
    setSelected(o);
  };
  const done = async (close = false) => { setBusy(true); if (await flush()) { if (close) await closeBoard(); else await releaseControl(); } setBusy(false); };
  useEffect(() => { dialog.current?.focus(); return () => { clearTimeout(timer.current); dirty.current = null; }; }, []);
  useEffect(() => { if (!editing) { clearTimeout(timer.current); dirty.current = null; setSelected(null); } }, [editing]);
  useEffect(() => {
    if (!busy && selected && focusNewText.current === selected.id) { textInput.current?.focus(); focusNewText.current = null; }
  }, [selected?.id, busy]);
  const add = async (type: BoardType) => {
    // Hide the previous inspector before waiting for its save: fast typing must target the new item.
    setBusy(true); setSelected(null);
    try {
      if (!await flush()) return;
      setTool('select');
      const o: BoardObject = { id: crypto.randomUUID(), type, x: 180 + Math.random() * 140, y: 120 + Math.random() * 80,
        w: type === 'table' ? 640 : 330, h: type === 'table' ? 300 : type === 'text' ? 140 : 220,
        color, fill: type === 'note' ? '#fff1a6' : 'transparent', weight, size: 28,
        ...(['text', 'note'].includes(type) ? { text: '' } : {}),
        ...(type === 'table' ? { cells: [['Heading', 'Heading', 'Heading'], ['', '', ''], ['', '', '']] } : {}) };
      if (type === 'note' || type === 'text') focusNewText.current = o.id;
      canvas.current?.put(o, true); setSelected(o); await changeBoard({ type: 'put', object: o });
    } finally { setBusy(false); }
  };
  const command = async (type: 'undo' | 'redo' | 'clear' | 'restore') => { await flush(); setSelected(null); await changeBoard({ type }); setConfirm(false); };
  const importImage = async (chosen?: File) => {
    if (!chosen || !active || !token) return;
    setBusy(true); setLocalError(null);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(chosen.type) || chosen.size > MAX_IMAGE_BYTES) throw new Error('Choose a PNG, JPEG or WebP diagram up to 5 MB.');
      await flush();
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
        const o: BoardObject = { id: prior?.id ?? crypto.randomUUID(), type: 'image', x: prior?.x ?? 160, y: prior?.y ?? 100,
          w: prior?.w ?? w, h: prior?.h ?? h, color, fill: 'transparent', size: 24, weight: 1, asset: asset.id };
        canvas.current?.put(o, true); setSelected(o); setTool('select'); await changeBoard({ type: 'put', object: o });
      } finally { image.close(); }
    } catch (e) { setLocalError((e as Error).message); }
    finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  const rows = selected?.cells?.length ?? 0, columns = selected?.cells?.[0].length ?? 0;
  const tableSize = (r: number, c: number) => { if (selected) update({ ...selected, cells: Array.from({ length: r }, (_, y) => Array.from({ length: c }, (_, x) => selected.cells?.[y]?.[x] ?? '')) }); };
  const disabled = !editing || busy;
  return <div className="wb-backdrop" onPointerDown={(e) => e.stopPropagation()}>
    <div className="wb-dialog" role="dialog" aria-modal="true" aria-label="Shared whiteboard" tabIndex={-1} ref={dialog}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); if (!busy) void done(true); }
        if (e.key === 'Tab') {
          const nodes = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')];
          const first = nodes[0], last = nodes.at(-1);
          if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      }}>
      <header className="wb-header"><div><h2>Whiteboard</h2><p role="status">{!online ? 'Reconnecting · editing paused' : editing ? 'Your editing turn · everyone can watch live' : board?.editor ? `${board.editor.name} is editing · live view` : 'Ready · take control to edit'} <span>{saving ? 'Saving…' : board ? `Saved · version ${board.revision}` : 'Loading…'}</span></p></div>
        <div className="wb-actions">{editing ? <button disabled={busy} onClick={() => void done()}>Done editing</button> : permitted && online && board ? board.editor && board.editor.id !== self ? <><button onClick={() => void requestControl()}>Request control</button>{(role === 'owner' || role === 'admin') && <button onClick={() => void requestControl(true)}>Release editor</button>}</> : <button onClick={() => void takeControl()}>Take control</button> : null}<button aria-label="Close whiteboard" disabled={busy} onClick={() => void done(true)}>Close</button></div>
      </header>
      {(error || localError) && <div className="wb-error" role="alert">{localError || error}</div>}
      <div className="wb-toolbar" aria-label="Whiteboard tools">
        {['select', 'pen', 'erase', 'pan'].map((value) => <button key={value} aria-pressed={tool === value} disabled={value !== 'pan' && disabled} onClick={() => { void flush(); setTool(value); }}>{value === 'erase' ? 'Eraser' : value[0].toUpperCase() + value.slice(1)}</button>)}
        <label>Ink <input aria-label="Ink color" type="color" value={color} disabled={disabled} onChange={(e) => { setColor(e.target.value); if (selected) update({ ...selected, color: e.target.value }); }} /></label>
        <label>Width <input aria-label="Pen width" type="number" min={1} max={24} value={weight} disabled={disabled} onChange={(e) => { const n = Math.max(1, Math.min(24, +e.target.value || 1)); setWeight(n); if (selected) update({ ...selected, weight: n }); }} /></label>
        {(['text', 'note', 'table', 'rect', 'ellipse', 'line', 'arrow'] as BoardType[]).map((type) => <button key={type} disabled={disabled} onClick={() => void add(type)}>{({ rect: 'Rectangle', ellipse: 'Circle' } as Record<string, string>)[type] ?? type[0].toUpperCase() + type.slice(1)}</button>)}
        <button disabled={disabled} onClick={() => { replacement.current = false; file.current?.click(); }}>Import diagram</button>
        <input ref={file} type="file" aria-label="Diagram file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void importImage(e.target.files?.[0])} />
        <button disabled={disabled || !board?.undo} onClick={() => void command('undo')}>Undo</button><button disabled={disabled || !board?.redo} onClick={() => void command('redo')}>Redo</button>
        <button onClick={() => canvas.current?.fit()}>Fit board</button><button disabled={disabled || !board?.document.objects.length} onClick={() => setConfirm(true)}>Clear board</button>
        <button disabled={disabled || !board?.recovery} onClick={() => void command('restore')}>Recover snapshot</button>
      </div>
      {confirm && <div className="wb-confirm" role="alert">Clear everything on this board? A recovery snapshot will be kept. <button onClick={() => void command('clear')}>Yes, clear board</button><button onClick={() => setConfirm(false)}>Cancel</button></div>}
      <div className="wb-body"><BoardCanvas ref={canvas} tool={tool} color={color} weight={weight} onSelect={select} />
        {editing && selected && <aside className="wb-inspector" aria-label="Selected object"><strong>{selected.type === 'table' ? 'Edit table' : 'Selected ' + selected.type}</strong>
          {(selected.type === 'text' || selected.type === 'note') && <label>Text<textarea disabled={busy} ref={textInput} aria-label="Object text" placeholder={selected.type === 'note' ? 'Type a note…' : 'Type your text…'} maxLength={5000} value={selected.text}
            onFocus={(e) => { if (selected.text === 'New note' || selected.text === 'Type your text') e.currentTarget.select(); }}
            onChange={(e) => update({ ...selected, text: e.target.value })} /></label>}
          {['text', 'note', 'table'].includes(selected.type) && <label>Text size<input disabled={busy} aria-label="Text size" type="number" min={10} max={96} value={selected.size} onChange={(e) => update({ ...selected, size: Math.max(10, Math.min(96, +e.target.value || 10)) })} /></label>}
          {['note', 'rect', 'ellipse'].includes(selected.type) && <label>Fill<input disabled={busy} aria-label="Fill color" type="color" value={selected.fill === 'transparent' ? '#ffffff' : selected.fill} onChange={(e) => update({ ...selected, fill: e.target.value })} /></label>}
          {selected.type === 'table' && <><div className="wb-actions"><label>Rows<input disabled={busy} aria-label="Table rows" type="number" min={1} max={20} value={rows} onChange={(e) => tableSize(Math.max(1, Math.min(20, +e.target.value || 1)), columns)} /></label><label>Columns<input disabled={busy} aria-label="Table columns" type="number" min={1} max={12} value={columns} onChange={(e) => tableSize(rows, Math.max(1, Math.min(12, +e.target.value || 1)))} /></label></div><div className="wb-cells">{selected.cells!.map((row, r) => <div key={r}>{row.map((cell, c) => <input disabled={busy} key={c} aria-label={`Row ${r + 1} column ${c + 1}`} maxLength={500} value={cell} onChange={(e) => update({ ...selected, cells: selected.cells!.map((line, y) => line.map((v, x) => y === r && x === c ? e.target.value : v)) })} />)}</div>)}</div></>}
          {selected.type === 'image' && <button disabled={busy} onClick={() => { replacement.current = true; file.current?.click(); }}>Replace diagram</button>}
          <button disabled={busy} onClick={async () => { await flush(); canvas.current?.remove(selected.id); await changeBoard({ type: 'delete', id: selected.id }); setSelected(null); }}>Delete selected</button>
          <p>Drag to move. Use corner handles to resize. Scroll to zoom; choose Pan to move the view.</p>
        </aside>}
      </div>
      <footer className="wb-footer">{editing ? '16:9 board · keep content inside the dashed margin · Done editing saves your changes.' : permitted ? 'Watching live · request a turn to edit existing content.' : 'Guest view · members can edit.'} <span>Diagrams: PNG, JPEG or WebP · up to 5 MB</span></footer>
    </div>
  </div>;
}
