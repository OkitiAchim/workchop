import { BOARD_HEIGHT, BOARD_WIDTH, type BoardObject, type BoardState } from '../../../../shared/whiteboard';
import { boardImage } from './assets';

export function visibleObjects(state: Pick<BoardState, 'document' | 'preview'>): BoardObject[] {
  return state.preview ? state.document.objects.some((o) => o.id === state.preview!.id) ? state.document.objects.map((o) => o.id === state.preview!.id ? state.preview! : o) : [...state.document.objects, state.preview] : state.document.objects;
}
function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, height: number, size: number) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
  ctx.font = `${size}px Arial, sans-serif`; ctx.textBaseline = 'top';
  let at = y;
  for (const paragraph of value.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (line && ctx.measureText(`${line} ${word}`).width > width) { ctx.fillText(line, x, at); at += size * 1.25; line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    ctx.fillText(line, x, at); at += size * 1.25;
    if (at > y + height) break;
  }
  ctx.restore();
}
/** Lightweight world preview: the full editing library isn't loaded by the office scene. */
export function paintBoard(canvas: HTMLCanvasElement, state?: Pick<BoardState, 'document' | 'preview'>, area = { width: BOARD_WIDTH, height: BOARD_HEIGHT, transparent: false }, editing?: { id: string; row?: number; column?: number }) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.setTransform(canvas.width / area.width, 0, 0, canvas.height / area.height, 0, 0);
  ctx.clearRect(0, 0, area.width, area.height);
  if (!area.transparent) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, area.width, area.height); }
  if (!state) return;
  for (const o of visibleObjects(state)) {
    ctx.save(); ctx.translate(o.x, o.y); ctx.rotate((o.angle ?? 0) * Math.PI / 180);
    ctx.beginPath(); ctx.rect(0, 0, o.w, o.h); ctx.clip();
    ctx.strokeStyle = o.color; ctx.fillStyle = o.fill; ctx.lineWidth = o.weight; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (o.type === 'stroke') {
      ctx.beginPath(); for (let i = 0; i < (o.points?.length ?? 0); i += 2) {
        const x = o.points![i] * o.w, y = o.points![i + 1] * o.h;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      } ctx.stroke();
    } else if (o.type === 'rect' || o.type === 'note') {
      if (o.fill !== 'transparent') ctx.fillRect(0, 0, o.w, o.h);
      ctx.strokeRect(o.weight / 2, o.weight / 2, Math.max(0, o.w - o.weight), Math.max(0, o.h - o.weight));
      if (o.type === 'note' && editing?.id !== o.id) { ctx.fillStyle = o.color; text(ctx, o.text ?? '', 12, 12, o.w - 24, o.h - 24, o.size); }
    } else if (o.type === 'ellipse') {
      ctx.beginPath(); ctx.ellipse(o.w / 2, o.h / 2, Math.max(0, (o.w - o.weight) / 2), Math.max(0, (o.h - o.weight) / 2), 0, 0, Math.PI * 2);
      if (o.fill !== 'transparent') ctx.fill(); ctx.stroke();
    } else if (o.type === 'line' || o.type === 'arrow') {
      const len = Math.min(18 + o.weight, Math.min(o.w, o.h) * 0.4);
      const pad = Math.min(Math.min(o.w, o.h) / 2, Math.max(o.weight / 2, o.type === 'arrow' ? len / 2 : 0));
      const x = o.w - pad, y = pad;
      ctx.beginPath(); ctx.moveTo(pad, o.h - pad); ctx.lineTo(x, y); ctx.stroke();
      if (o.type === 'arrow') {
        const a = Math.atan2(-(o.h - pad * 2), o.w - pad * 2);
        ctx.beginPath(); ctx.moveTo(x - len * Math.cos(a - 0.45), y - len * Math.sin(a - 0.45));
        ctx.lineTo(x, y); ctx.lineTo(x - len * Math.cos(a + 0.45), y - len * Math.sin(a + 0.45)); ctx.stroke();
      }
    } else if (o.type === 'text' && editing?.id !== o.id) { ctx.fillStyle = o.color; text(ctx, o.text ?? '', 0, 0, o.w, o.h, o.size); }
    else if (o.type === 'table' && o.cells) {
      const rh = o.h / o.cells.length, cw = o.w / o.cells[0].length;
      o.cells.forEach((row, r) => row.forEach((cell, c) => {
        ctx.fillStyle = r === 0 ? '#f4f4f5' : '#ffffff'; ctx.fillRect(c * cw, r * rh, cw, rh);
        ctx.fillStyle = o.color;
        if (editing?.id !== o.id || editing.row !== r || editing.column !== c) text(ctx, cell, c * cw + 8, r * rh + 8, cw - 16, rh - 16, o.size);
      }));
      ctx.beginPath(); ctx.rect(o.weight / 2, o.weight / 2, Math.max(0, o.w - o.weight), Math.max(0, o.h - o.weight));
      for (let r = 1; r < o.cells.length; r++) { ctx.moveTo(0, r * rh); ctx.lineTo(o.w, r * rh); }
      for (let c = 1; c < o.cells[0].length; c++) { ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, o.h); }
      ctx.stroke();
    } else if (o.type === 'image' && o.asset) {
      const image = boardImage(o.asset);
      if (image) ctx.drawImage(image, 0, 0, o.w, o.h);
      else { ctx.fillStyle = '#edf0f6'; ctx.fillRect(0, 0, o.w, o.h); ctx.fillStyle = '#495466'; text(ctx, 'Diagram…', 12, 12, o.w - 24, o.h - 24, 22); }
    }
    ctx.restore();
  }
}
