import crypto from 'node:crypto';
import type express from 'express';
import { BOARD_LEASE_MS, boardId, mayEditBoard, parseBoardDocument, parseBoardObject, putObject,
  type BoardDocument, type BoardMutation, type BoardObject, type BoardResult, type BoardState } from '../../../shared/whiteboard';
import type { Office } from '../../../shared/types';
import { jsonb, type Tx } from '../../db';
import type { Feature, SocketContext } from '../../features';
import { sameSecret } from '../../auth/sessions';
import { validateDiagram } from './images';

interface Lease {
  id: string; name: string; token: string; expires: number;
  past: BoardDocument[]; future: BoardDocument[]; operations: Set<string>;
}
interface Board {
  officeId: string; id: string; revision: number; document: BoardDocument;
  lease?: Lease; preview: BoardObject | null; recovery: boolean;
}
const keyOf = (office: string, id: string) => `${office}:${id}`;
const channel = (b: Board) => `whiteboard:${keyOf(b.officeId, b.id)}`;
const copy = (d: BoardDocument): BoardDocument => structuredClone(d);

export const feature: Feature = {
  name: 'whiteboard',
  migrations: [{ id: 900, name: 'shared_whiteboards', sql: `
    CREATE TABLE whiteboards (
      office_id text NOT NULL REFERENCES offices ON DELETE CASCADE, item_id text NOT NULL,
      revision integer NOT NULL DEFAULT 0, document jsonb NOT NULL DEFAULT '{"objects":[]}',
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (office_id, item_id)
    );
    CREATE TABLE whiteboard_history (
      office_id text NOT NULL, item_id text NOT NULL, revision integer NOT NULL,
      document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (office_id, item_id, revision),
      FOREIGN KEY (office_id, item_id) REFERENCES whiteboards ON DELETE CASCADE
    );` }],
  register(ctx) {
    const boards = new Map<string, Board>();
    const queues = new Map<string, Promise<unknown>>();
    const { db, realtime, io } = ctx;
    const viewing = (s: SocketContext, officeId: string) => s.room()?.officeId === officeId && !!s.role() && s.mayChangeWorld();
    const exists = (b: Board) => ctx.store.peek(b.officeId)?.office.items.some((i) => i.id === b.id && i.type === 'whiteboard');
    const state = (b: Board): BoardState => ({ boardId: b.id, revision: b.revision, document: b.document,
      editor: b.lease ? { id: b.lease.id, name: b.lease.name, expires: b.lease.expires } : null,
      preview: b.preview, undo: !!b.lease?.past.length, redo: !!b.lease?.future.length, recovery: b.recovery });
    const publish = (b: Board) => { io.to(channel(b)).emit('board:state', state(b)); };
    const queue = <T>(key: string, work: () => Promise<T>): Promise<T> => {
      const task = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
      queues.set(key, task);
      void task.finally(() => { if (queues.get(key) === task) queues.delete(key); }).catch(() => {});
      return task;
    };
    const ensure = async (s: SocketContext, id: string): Promise<Board> => {
      const officeId = s.room()?.officeId;
      if (!officeId || !viewing(s, officeId) || !boardId(id) || !s.office()?.items.some((i) => i.id === id && i.type === 'whiteboard')) throw new Error('This whiteboard is not available.');
      const key = keyOf(officeId, id);
      let b = boards.get(key);
      if (!b) {
        await db.query('INSERT INTO whiteboards (office_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [officeId, id]);
        const row = (await db.query<{ revision: number; document: unknown }>('SELECT revision, document FROM whiteboards WHERE office_id=$1 AND item_id=$2', [officeId, id])).rows[0];
        const history = await db.query('SELECT 1 FROM whiteboard_history WHERE office_id=$1 AND item_id=$2 AND document<>$3::jsonb LIMIT 1', [officeId, id, jsonb(row.document)]);
        b = { officeId, id, revision: row.revision, document: parseBoardDocument(row.document), preview: null, recovery: !!history.rows.length };
        boards.set(key, b);
      }
      if (!viewing(s, officeId) || !exists(b)) throw new Error('This whiteboard is not available.');
      return b;
    };
    const lease = (s: SocketContext, b: Board, token: string): Lease => {
      const l = b.lease;
      if (!viewing(s, b.officeId) || !mayEditBoard(s.role()) || !exists(b) || !l || l.id !== s.socket.id || l.expires <= Date.now() || !sameSecret(l.token, token)) throw new Error('Your editing turn ended. Take control again.');
      return l;
    };
    const checkpoint = async (q: Tx, b: Board) => {
      await q.query(`INSERT INTO whiteboard_history (office_id,item_id,revision,document) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`, [b.officeId, b.id, b.revision, jsonb(b.document)]);
      await q.query(`DELETE FROM whiteboard_history WHERE office_id=$1 AND item_id=$2 AND revision NOT IN
        (SELECT revision FROM whiteboard_history WHERE office_id=$1 AND item_id=$2 ORDER BY revision DESC LIMIT 10)`, [b.officeId, b.id]);
    };
    const dropLease = (b: Board) => { b.lease = undefined; b.preview = null; publish(b); };
    const requestContext = (req: express.Request): SocketContext | undefined => {
      const id = req.get('x-workchop-socket'), token = req.get('x-workchop-upload-key');
      const s = id ? realtime.contextOf(id) : undefined;
      return s?.socket.connected && token && sameSecret(s.socket.data.uploadKey ?? '', token) ? s : undefined;
    };
    ctx.uploads.addScope('whiteboard', {
      authorize(req, officeId) {
        const s = requestContext(req), id = req.get('x-whiteboard-id');
        const b = id && boards.get(keyOf(officeId, id));
        if (!s || !b) return false;
        try { lease(s, b, req.get('x-whiteboard-token') ?? ''); return true; } catch { return false; }
      },
      validate: validateDiagram,
      async attach(tx, id, officeId, req) {
        const owner = req.get('x-whiteboard-id')!;
        await tx.query('INSERT INTO upload_references (upload_id,office_id,kind,owner_id) VALUES ($1,$2,$3,$4)', [id, officeId, 'whiteboard', owner]);
      },
      mayRead(req, officeId, id) {
        const s = requestContext(req);
        return !!s && viewing(s, officeId) && !!s.office()?.items.some((i) => i.id === id && i.type === 'whiteboard');
      },
    });

    realtime.onSocket((s) => {
      const mayAct = s.limiter(12, 24), mayPreview = s.limiter(25, 40), mayRequest = s.limiter(0.1, 2);
      const run = <T extends object>(id: string, ack: (r: BoardResult<T>) => void, work: (b: Board) => Promise<T>) => {
        if (typeof ack !== 'function') return;
        const officeId = s.room()?.officeId;
        if (!officeId || !boardId(id) || !mayAct()) { ack({ ok: false, error: 'Please wait a moment or join the office.' }); return; }
        void queue(keyOf(officeId, id), async () => {
          if (s.room()?.officeId !== officeId) throw new Error('You left this office.');
          const b = await ensure(s, id);
          if (b.lease && b.lease.expires <= Date.now()) dropLease(b);
          const value = await work(b);
          return { ok: true as const, ...value };
        }).then(ack).catch((err: unknown) => {
          const b = boards.get(keyOf(officeId, id));
          ack({ ok: false, error: err instanceof Error ? err.message : 'Could not update the board.',
            ...(b && viewing(s, officeId) ? { state: state(b) } : {}) });
        });
      };
      s.socket.on('board:watch', (id, ack) => run(id, ack, async (b) => {
        await s.socket.join(channel(b)); return { state: state(b) };
      }));
      s.socket.on('board:claim', (id, ack) => run(id, ack, async (b) => {
        if (!mayEditBoard(s.role())) throw new Error('Members can edit; guests can watch.');
        if (b.lease && b.lease.id !== s.socket.id) throw new Error(`${b.lease.name} is editing this board.`);
        if (!b.lease) await db.transaction((q) => checkpoint(q, b));
        b.lease ??= { id: s.socket.id, name: s.me()?.name ?? 'Member', token: crypto.randomUUID(), expires: 0, past: [], future: [], operations: new Set() };
        const current = b.lease;
        current.expires = Date.now() + BOARD_LEASE_MS;
        await s.socket.join(channel(b)); publish(b);
        lease(s, b, current.token);
        return { state: state(b), token: current.token };
      }));
      s.socket.on('board:heartbeat', (id, token, ack) => run(id, ack, async (b) => {
        lease(s, b, token).expires = Date.now() + BOARD_LEASE_MS; return {};
      }));
      s.socket.on('board:release', (id, token, ack) => run(id, ack, async (b) => {
        lease(s, b, token); await db.transaction((q) => checkpoint(q, b)); dropLease(b); return {};
      }));
      s.socket.on('board:force-release', (id, ack) => run(id, ack, async (b) => {
        if (s.role() !== 'owner' && s.role() !== 'admin') throw new Error('Only an owner or admin can release another editor.');
        await db.transaction((q) => checkpoint(q, b)); dropLease(b); return {};
      }));
      s.socket.on('board:request', (id, ack) => run(id, ack, async (b) => {
        if (!mayEditBoard(s.role()) || !mayRequest()) throw new Error('Please wait before requesting control.');
        if (b.lease) io.to(b.lease.id).emit('board:requested', id, s.me()?.name ?? 'A member'); return {};
      }));
      s.socket.on('board:preview', (id, token, raw) => {
        const officeId = s.room()?.officeId;
        const b = officeId && boards.get(keyOf(officeId, id));
        if (!b || !mayPreview()) return;
        try {
          lease(s, b, token);
          const object = raw === null ? null : parseBoardObject(raw);
          // Image previews must already belong to this document; imports become visible after save.
          if (object?.type === 'image' && !b.document.objects.some((o) => o.asset === object.asset)) return;
          b.preview = object;
          s.socket.to(channel(b)).emit('board:preview', id, object);
        } catch { /* Invalid or stale preview never changes the document. */ }
      });
      s.socket.on('board:change', (id, mutation, ack) => run(id, ack, async (b) => {
        const m = mutation as BoardMutation;
        if (!m || typeof m !== 'object' || !boardId(m.operationId)) throw new Error('Invalid board change.');
        const l = lease(s, b, m.token);
        if (l.operations.has(m.operationId)) return { state: state(b) };
        if (m.revision !== b.revision) throw new Error('The board changed. Please try again with the current version.');
        const c = m.change;
        let next: BoardDocument;
        if (c?.type === 'put') next = putObject(b.document, parseBoardObject(c.object));
        else if (c?.type === 'delete' && boardId(c.id)) next = { objects: b.document.objects.filter((o) => o.id !== c.id) };
        else if (c?.type === 'clear') next = { objects: [] };
        else if (c?.type === 'undo' && l.past.length) next = l.past.at(-1)!;
        else if (c?.type === 'redo' && l.future.length) next = l.future.at(-1)!;
        else if (c?.type === 'restore') {
          const previous = (await db.query<{ document: unknown }>('SELECT document FROM whiteboard_history WHERE office_id=$1 AND item_id=$2 AND document<>$3::jsonb ORDER BY revision DESC LIMIT 1', [b.officeId, b.id, jsonb(b.document)])).rows[0];
          if (!previous) throw new Error('No earlier snapshot is available.');
          next = parseBoardDocument(previous.document);
        }
        else throw new Error('Nothing to change.');
        await db.transaction(async (tx) => {
          const assets = [...new Set(next.objects.flatMap((o) => o.asset ? [o.asset] : []))];
          if (assets.length) {
            const found = await tx.query('SELECT upload_id FROM upload_references WHERE office_id=$1 AND owner_id=$2 AND kind=$3 AND upload_id=ANY($4::uuid[])', [b.officeId, b.id, 'whiteboard', assets]);
            if (found.rows.length !== assets.length) throw new Error('This diagram belongs to another board or is unavailable.');
          }
          if (c.type === 'clear' || c.type === 'delete' || c.type === 'restore') await checkpoint(tx, b);
          lease(s, b, m.token);
          await tx.query('UPDATE whiteboards SET document=$3::jsonb, revision=revision+1, updated_at=now() WHERE office_id=$1 AND item_id=$2', [b.officeId, b.id, jsonb(next)]);
        });
        if (c.type === 'undo') { l.past.pop(); l.future.push(b.document); }
        else if (c.type === 'redo') { l.future.pop(); l.past.push(b.document); }
        else { l.past.push(b.document); l.future = []; }
        while (l.past.length > 30 || JSON.stringify(l.past).length > 4_000_000) l.past.shift();
        b.document = copy(next); b.revision++; b.preview = null;
        b.recovery = !!(await db.query('SELECT 1 FROM whiteboard_history WHERE office_id=$1 AND item_id=$2 AND document<>$3::jsonb LIMIT 1', [b.officeId, b.id, jsonb(next)])).rows.length;
        l.operations.add(m.operationId);
        if (l.operations.size > 256) l.operations.delete(l.operations.values().next().value!);
        l.expires = Date.now() + BOARD_LEASE_MS;
        publish(b); return { state: state(b) };
      }));
    });

    const revoke = (s: SocketContext, officeId?: string) => {
      for (const b of boards.values()) if (!officeId || b.officeId === officeId) {
        if (b.lease?.id === s.socket.id) dropLease(b);
        if (officeId || !viewing(s, b.officeId)) { void s.socket.leave(channel(b)); s.socket.emit('board:gone', b.id); }
      }
    };
    realtime.onLeave((s, left) => revoke(s, left.officeId));
    realtime.onRoleChange((s) => { if (!mayEditBoard(s.role())) revoke(s); });
    const reconcile = (officeId: string, office: Office) => {
      for (const b of boards.values()) if (b.officeId === officeId && !office.items.some((i) => i.id === b.id && i.type === 'whiteboard')) {
        dropLease(b); io.to(channel(b)).emit('board:gone', b.id);
        boards.delete(keyOf(officeId, b.id));
        void queue(keyOf(officeId, b.id), async () => {
          const files = (await db.query<{ upload_id: string }>('DELETE FROM upload_references WHERE office_id=$1 AND owner_id=$2 AND kind=$3 RETURNING upload_id', [officeId, b.id, 'whiteboard'])).rows.map((r) => r.upload_id);
          await db.query('DELETE FROM whiteboards WHERE office_id=$1 AND item_id=$2', [officeId, b.id]);
          await ctx.uploads.remove(files);
        }).catch(() => {});
      }
    };
    realtime.onOfficeChange(reconcile);
    // Release old unused imports only after both live content and bounded recovery history let go.
    // The persistent upload scope keeps bytes private even between releasing references and deleting files.
    let sweeping = false, closed = false;
    const sweep = async () => {
      if (sweeping || closed) return;
      sweeping = true;
      try {
        const saved = (await db.query<{ office_id: string; item_id: string }>('SELECT office_id,item_id FROM whiteboards')).rows;
        for (const row of saved) {
          if (closed) break;
          const key = keyOf(row.office_id, row.item_id);
          await queue(key, async () => {
            const office = await ctx.store.get(row.office_id), b = boards.get(key);
            const removed = !office?.office.items.some((i) => i.id === row.item_id && i.type === 'whiteboard');
            if (b?.lease && !removed) return;
            const obsolete = await db.transaction(async (tx) => {
              if (removed) await tx.query('DELETE FROM whiteboards WHERE office_id=$1 AND item_id=$2', [row.office_id, row.item_id]);
              const files = (await tx.query<{ upload_id: string }>(`DELETE FROM upload_references r USING uploads u
                WHERE r.upload_id=u.id AND r.kind='whiteboard' AND r.office_id=$1 AND r.owner_id=$2
                AND ($3 OR (u.created_at<now()-interval '1 day'
                  AND NOT EXISTS (SELECT 1 FROM whiteboards b WHERE b.office_id=r.office_id AND b.item_id=r.owner_id
                    AND b.document @> jsonb_build_object('objects',jsonb_build_array(jsonb_build_object('asset',r.upload_id::text))))
                  AND NOT EXISTS (SELECT 1 FROM whiteboard_history h WHERE h.office_id=r.office_id AND h.item_id=r.owner_id
                    AND h.document @> jsonb_build_object('objects',jsonb_build_array(jsonb_build_object('asset',r.upload_id::text))))))
                RETURNING r.upload_id`, [row.office_id, row.item_id, removed])).rows;
              return files.map((f) => f.upload_id);
            });
            await ctx.uploads.remove(obsolete);
            if (b && !b.lease && !io.sockets.adapter.rooms.get(channel(b))?.size) boards.delete(key);
          });
        }
      } catch (err) { console.warn('[whiteboard] asset cleanup will retry:', (err as Error).message); }
      finally { sweeping = false; }
    };
    let sweepTask: Promise<void> = sweep();
    const sweepTimer = setInterval(() => { sweepTask = sweep(); }, 5 * 60_000); sweepTimer.unref?.();
    const timer = setInterval(() => { for (const b of boards.values()) if (b.lease && b.lease.expires <= Date.now()) dropLease(b); }, 1000);
    timer.unref?.();
    ctx.onClose(async () => { closed = true; clearInterval(timer); clearInterval(sweepTimer); await sweepTask; await Promise.allSettled([...queues.values()]); boards.clear(); });
  },
};
