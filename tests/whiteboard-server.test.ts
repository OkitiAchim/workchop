import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, BOARD_MARGIN, BOARD_WIDTH, fitBoardObject, type BoardObject } from '../shared/whiteboard';
import { feature as whiteboard } from '../server/features/whiteboard';
import { feature as chat } from '../server/features/chat';
import { feature as world } from '../server/features/world';
import { ChatStore } from '../server/features/chat/store';
import { startServer } from '../server/index';
import { createTestDb } from './helpers/db';
import { createOffice, disconnectAll, join, json, member, until, type Client } from './helpers/http';

let server: Awaited<ReturnType<typeof startServer>>, base: string, dataDir: string;
const object = (id = 'note'): BoardObject => ({ id, type: 'note', x: 100, y: 100, w: 300, h: 220, color: '#123456', fill: '#fff1a6', size: 24, weight: 3, text: 'Hello' });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'homeoffice-whiteboard-'));
  server = await startServer({ port: 0, host: '127.0.0.1', dataDir, db: await createTestDb(), quiet: true, iceServers: [], features: [chat, world, whiteboard], auth: { google: null, apple: null, devLogin: true } });
  base = `http://127.0.0.1:${server.port}`;
}, 60_000);
afterEach(disconnectAll);
afterAll(async () => { await server?.close(); if (dataDir) rmSync(dataDir, { recursive: true, force: true }); });
async function setup() {
  const office = await createOffice(base), stored = (await server.store.get(office.id))!;
  server.store.update(office.id, { ...stored.office, items: [{ id: 'board', type: 'whiteboard', x: 5, z: 5, rot: 0 }, { id: 'other', type: 'whiteboard', x: 9, z: 5, rot: 0 }] });
  const a = await join(base, office.id, 'Owner', { jar: office.owner });
  const jar = await member(base, server.db, office.id);
  const b = await join(base, office.id, 'Member', { jar });
  const g = await join(base, office.id, 'Guest');
  return { office, a, b, g };
}
async function claim(s: Client, id = 'board') {
  const r = await s.timeout(3000).emitWithAck('board:claim', id);
  if (!r.ok) throw new Error(r.error); return r;
}
async function watch(s: Client, id = 'board') {
  const r = await s.timeout(3000).emitWithAck('board:watch', id);
  if (!r.ok) throw new Error(r.error); return r.state;
}
async function put(s: Client, token: string, revision: number, o = object(), id = 'board', operationId = crypto.randomUUID()) {
  return s.timeout(3000).emitWithAck('board:change', id, { token, revision, operationId, change: { type: 'put', object: o } });
}
function headers(c: Awaited<ReturnType<typeof join>>) { return { 'X-Workchop-Socket': c.socket.id!, 'X-Workchop-Upload-Key': c.res.uploadKey }; }
async function upload(c: Awaited<ReturnType<typeof join>>, office: string, token: string, id = 'board', data = png, type = 'image/png') {
  return fetch(`${base}/api/offices/${office}/uploads`, { method: 'POST', headers: { ...headers(c), 'Content-Type': type, 'X-Filename': 'diagram.png', 'X-Upload-Scope': 'whiteboard', 'X-Whiteboard-Id': id, 'X-Whiteboard-Token': token }, body: new Uint8Array(data) });
}
describe('shared whiteboard authority and live sessions', () => {
  it('atomically grants exactly one editor, while separate boards remain independent', async () => {
    const { a, b } = await setup();
    const results = await Promise.all([a.socket.emitWithAck('board:claim', 'board'), b.socket.emitWithAck('board:claim', 'board')]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results[0].ok ? b : a; expect((await claim(loser.socket, 'other')).token).toBeTruthy();
  });
  it('allows guests to watch live previews but prevents editing or acquiring control', async () => {
    const { a, g } = await setup(); const c = await claim(a.socket); await watch(g.socket);
    expect((await g.socket.emitWithAck('board:claim', 'board')).ok).toBe(false);
    let preview: BoardObject | null = null; g.socket.on('board:preview', (_id, o) => { preview = o; });
    a.socket.emit('board:preview', 'board', c.token, object()); await until(() => !!preview);
    expect(preview).toEqual(object()); expect((await watch(g.socket)).document.objects).toHaveLength(0);
    expect((await put(g.socket, c.token, 0)).ok).toBe(false);
    expect((await put(a.socket, c.token, 0)).ok).toBe(true);
    expect((await watch(g.socket)).document.objects).toEqual([object()]);
  });
  it('rejects stale revisions and foreign tokens, and deduplicates retried operations', async () => {
    const { a, b } = await setup(); const c = await claim(a.socket), operation = crypto.randomUUID();
    expect((await put(a.socket, c.token, 0, object(), 'board', operation)).ok).toBe(true);
    const retry = await put(a.socket, c.token, 0, object(), 'board', operation); expect(retry.ok && retry.state.revision).toBe(1);
    expect((await put(a.socket, c.token, 0, object('stale'))).ok).toBe(false);
    expect((await put(b.socket, c.token, 1, object('forged'))).ok).toBe(false);
    expect((await watch(b.socket)).document.objects).toEqual([object()]);
  });
  it('hands editable content over, fences old tokens, and limits undo to the current turn', async () => {
    const { a, b } = await setup(); const c = await claim(a.socket); await put(a.socket, c.token, 0);
    expect((await a.socket.emitWithAck('board:release', 'board', c.token)).ok).toBe(true);
    const next = await claim(b.socket); expect(next.state.undo).toBe(false);
    expect((await put(a.socket, c.token, 1)).ok).toBe(false);
    const changed = { ...object(), text: 'Edited by next member' }; await put(b.socket, next.token, 1, changed);
    expect((await watch(a.socket)).document.objects[0].text).toBe(changed.text);
  });
  it('preserves the complete arrangement at handover and enforces board edges on server writes', async () => {
    const { a, b } = await setup(); const c = await claim(a.socket);
    const note = { ...object(), x: 1590, y: 890, text: 'Existing note' };
    const table: BoardObject = { id: 'table', type: 'table', x: 20, y: 20, w: 650, h: 300,
      color: '#123456', fill: 'transparent', size: 24, weight: 3, cells: [['Heading', 'Value'], ['Task', 'Owner']] };
    const normalized = fitBoardObject(note);
    expect((await put(a.socket, c.token, 0, note)).ok).toBe(true);
    expect((await put(a.socket, c.token, 1, table)).ok).toBe(true);
    await a.socket.emitWithAck('board:release', 'board', c.token);
    const next = await claim(b.socket);
    expect(next.state.document.objects).toEqual([normalized, table]);
    expect(normalized.x + normalized.w).toBe(BOARD_WIDTH - BOARD_MARGIN);
    expect(normalized.y + normalized.h).toBe(BOARD_HEIGHT - BOARD_MARGIN);
    const edit = { ...normalized, text: 'Edited by next member' };
    expect((await put(b.socket, next.token, 2, edit)).ok).toBe(true);
    expect((await watch(a.socket)).document.objects).toEqual([edit, table]);
  });
  it('supports undo, redo and persistent recovery after a clear and handover', async () => {
    const { a, b } = await setup(); const c = await claim(a.socket); await put(a.socket, c.token, 0);
    const change = (type: 'undo' | 'redo' | 'clear' | 'restore', rev: number, socket = a.socket, token = c.token) => socket.emitWithAck('board:change', 'board', { token, revision: rev, operationId: crypto.randomUUID(), change: { type } });
    expect((await change('undo', 1)).ok).toBe(true); expect((await watch(b.socket)).document.objects).toHaveLength(0);
    expect((await change('redo', 2)).ok).toBe(true); expect((await watch(b.socket)).document.objects).toHaveLength(1);
    expect((await change('clear', 3)).ok).toBe(true);
    await a.socket.emitWithAck('board:release', 'board', c.token);
    const n = await claim(b.socket); expect(n.state.recovery).toBe(true);
    expect((await change('restore', 4, b.socket, n.token)).ok).toBe(true);
    expect((await watch(a.socket)).document.objects).toEqual([object()]);
  });
  it('releases disconnected editors and reloads the persisted document', async () => {
    const { a, b } = await setup(); const c = await claim(a.socket); await put(a.socket, c.token, 0); a.socket.disconnect();
    await until(async () => !(await watch(b.socket)).editor);
    expect((await claim(b.socket)).state.document.objects).toEqual([object()]);
  });
  it('expires abandoned editing turns and fences the expired token', { timeout: 30_000 }, async () => {
    const { a, b } = await setup(); const c = await claim(a.socket);
    await new Promise((resolve) => setTimeout(resolve, 21_000));
    const n = await claim(b.socket); expect(n.token).not.toBe(c.token);
    expect((await put(a.socket, c.token, 0)).ok).toBe(false);
    expect((await put(b.socket, n.token, 0)).ok).toBe(true);
  });
  it('allows owner release but rejects an ordinary member forcing another editor out', async () => {
    const { a, b } = await setup(); const c = await claim(a.socket);
    expect((await b.socket.emitWithAck('board:force-release', 'board')).ok).toBe(false);
    expect((await a.socket.emitWithAck('board:force-release', 'board')).ok).toBe(true);
    await claim(b.socket); expect((await put(a.socket, c.token, 0)).ok).toBe(false);
  });
  it('revokes editing and private asset reads immediately when membership is removed', async () => {
    const { a, b, office } = await setup(); const c = await claim(b.socket);
    const asset = await (await upload(b, office.id, c.token)).json() as { url: string };
    const userId = server.realtime.contextOf(b.socket.id!)!.user!.id;
    server.realtime.setRole(office.id, userId, null);
    await until(async () => !(await watch(a.socket)).editor);
    expect((await put(b.socket, c.token, 0)).ok).toBe(false);
    expect((await fetch(base + asset.url, { headers: headers(b) })).status).toBe(404);
    expect((await claim(a.socket)).token).toBeTruthy();
  });
  it('rejects nonexistent boards and reads from a different office', async () => {
    const { a, office } = await setup(); expect((await a.socket.emitWithAck('board:watch', 'missing')).ok).toBe(false);
    const foreign = await createOffice(base); const s = await join(base, foreign.id, 'Foreign', { jar: foreign.owner });
    expect((await s.socket.emitWithAck('board:watch', 'board')).ok).toBe(false);
    expect((await server.db.query('SELECT * FROM whiteboards WHERE office_id=$1', [office.id])).rows).toHaveLength(0);
  });
  it('excludes support customers even if the office has a whiteboard', async () => {
    const owner = (await createOffice(base)).owner;
    const made = await owner.fetch(`${base}/api/offices`, json({ name: 'Support QA', kind: 'support', template: 'support' }));
    expect(made.status).toBe(201); const { id } = await made.json() as { id: string };
    const access = await owner.fetch(`${base}/api/offices/${id}/access`, json({ guests: 'link' }, 'PUT'));
    const { link } = await access.json() as { link: string };
    const stored = (await server.store.get(id))!; server.store.update(id, { ...stored.office, items: [{ id: 'board', type: 'whiteboard', x: 5, z: 5, rot: 0 }] });
    const customer = await join(base, id, 'Customer', { guest: link.split('#guest=')[1] });
    expect((await customer.socket.emitWithAck('board:watch', 'board')).ok).toBe(false);
    expect((await customer.socket.emitWithAck('board:claim', 'board')).ok).toBe(false);
  });
  it('invalidates an editor and removes board data when the physical board is deleted', async () => {
    const { a, b, office } = await setup(); const c = await claim(a.socket); await put(a.socket, c.token, 0);
    let gone = false; b.socket.on('board:gone', (id) => { if (id === 'board') gone = true; }); await watch(b.socket);
    a.socket.emit('office:op', { t: 'remove', id: 'board' }); await until(() => gone);
    await until(async () => !(await server.db.query('SELECT 1 FROM whiteboards WHERE office_id=$1 AND item_id=$2', [office.id, 'board'])).rows.length);
    expect((await put(a.socket, c.token, 1)).ok).toBe(false);
  });
});
describe('private durable board diagrams', () => {
  it('requires a live editing token to upload and validates the actual bytes', async () => {
    const { a, g, office } = await setup(); const c = await claim(a.socket);
    expect((await upload(a, office.id, 'wrong')).status).toBe(403);
    expect((await upload(g, office.id, c.token)).status).toBe(403);
    expect((await upload(a, office.id, c.token, 'board', Buffer.from('<svg/>'))).status).toBe(400);
    expect((await upload(a, office.id, c.token, 'board', png, 'image/jpeg')).status).toBe(400);
  });
  it('keeps files private, lets office guests view, blocks cross-office imports and survives chat cleanup', async () => {
    const { a, b, g, office } = await setup(); const c = await claim(a.socket);
    const response = await upload(a, office.id, c.token); expect(response.status).toBe(201);
    const asset = await response.json() as { id: string; url: string };
    const image: BoardObject = { ...object('diagram'), type: 'image', asset: asset.id };
    expect((await put(a.socket, c.token, 0, image)).ok).toBe(true);
    expect((await fetch(base + asset.url)).status).toBe(404);
    const allowed = await fetch(base + asset.url, { headers: headers(g) }); expect(allowed.status).toBe(200); expect(allowed.headers.get('cache-control')).toBe('private, no-store'); await allowed.arrayBuffer();
    const other = await claim(b.socket, 'other'); expect((await put(b.socket, other.token, 0, image, 'other')).ok).toBe(false);
    const foreign = await createOffice(base), outsider = await join(base, foreign.id, 'Outsider', { jar: foreign.owner });
    expect((await fetch(base + asset.url, { headers: headers(outsider) })).status).toBe(404);
    await server.db.query("UPDATE uploads SET created_at=now()-interval '2 days' WHERE id=$1", [asset.id]);
    expect(await new ChatStore(server.db).unattached()).not.toContain(asset.id);
    // Even during removal, scoped bytes never become public-by-link.
    await server.db.query('DELETE FROM upload_references WHERE upload_id=$1', [asset.id]);
    expect((await fetch(base + asset.url, { headers: headers(a) })).status).toBe(404);
  });
  it('recovers after server restart, retains referenced history assets and removes abandoned imports', { timeout: 30_000 }, async () => {
    const { a, office } = await setup(); const c = await claim(a.socket);
    const asset = await (await upload(a, office.id, c.token)).json() as { id: string; url: string };
    const unused = await (await upload(a, office.id, c.token)).json() as { id: string };
    await put(a.socket, c.token, 0, { ...object('diagram'), type: 'image', asset: asset.id });
    await a.socket.emitWithAck('board:change', 'board', { token: c.token, revision: 1, operationId: crypto.randomUUID(), change: { type: 'clear' } });
    await server.db.query("UPDATE uploads SET created_at=now()-interval '2 days' WHERE id=ANY($1::uuid[])", [[asset.id, unused.id]]);
    const database = server.db; disconnectAll(); await server.close();
    server = await startServer({ port: 0, host: '127.0.0.1', dataDir, db: database, quiet: true, iceServers: [], features: [chat, world, whiteboard], auth: { google: null, apple: null, devLogin: true } });
    base = `http://127.0.0.1:${server.port}`;
    const fresh = await join(base, office.id, 'Owner', { jar: office.owner });
    const saved = await watch(fresh.socket); expect(saved.editor).toBeNull(); expect(saved.revision).toBe(2); expect(saved.recovery).toBe(true);
    const n = await claim(fresh.socket); expect(n.token).not.toBe(c.token);
    const restored = await fresh.socket.emitWithAck('board:change', 'board', { token: n.token, revision: 2, operationId: crypto.randomUUID(), change: { type: 'restore' } });
    expect(restored.ok && restored.state.document.objects[0].asset).toBe(asset.id);
    expect((await fetch(base + asset.url, { headers: headers(fresh) })).status).toBe(200);
    await until(async () => !(await database.query('SELECT 1 FROM uploads WHERE id=$1', [unused.id])).rows.length);
    expect((await database.query('SELECT 1 FROM uploads WHERE id=$1', [asset.id])).rows).toHaveLength(1);
  });
});
