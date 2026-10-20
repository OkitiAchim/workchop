import { create } from 'zustand';
import type { BoardChange, BoardObject, BoardResult, BoardState } from '../../../../shared/whiteboard';
import { getSession } from '../../lib/session';
import { getState, setState, toast } from '../../state/store';
import { pressed } from '../../world/input';

export const useBoards = create<{ boards: Record<string, BoardState>; active: string | null; token: string | null;
  online: boolean; error: string | null; saving: number; epoch: number }>(() => ({
  boards: {}, active: null, token: null, online: true, error: null, saving: 0, epoch: 0,
}));
let pending: Promise<unknown> = Promise.resolve();
let watched = new Set<string>();
let lastPreview = 0;

export function receiveBoard(state: BoardState) {
  useBoards.setState((s) => ({ boards: { ...s.boards, [state.boardId]: state },
    ...(s.active === state.boardId && state.editor?.id !== getState().selfId ? { token: null } : {}) }));
}
export async function watchBoard(id: string, force = false): Promise<void> {
  if (watched.has(id) && !force) return;
  const socket = getSession()?.socket;
  if (!socket?.connected) return;
  watched.add(id);
  try {
    const result = await socket.timeout(8000).emitWithAck('board:watch', id);
    if (result.ok) receiveBoard(result.state);
    else { watched.delete(id); if (useBoards.getState().active === id) useBoards.setState({ error: result.error }); }
  } catch { watched.delete(id); }
}
export function resetBoards() { watched = new Set(); pending = Promise.resolve(); useBoards.setState({ boards: {}, active: null, token: null, error: null, saving: 0, online: true }); }
export function reconnectBoards() {
  const ids = [...watched]; watched.clear(); useBoards.setState({ online: true, token: null });
  for (const id of ids) void watchBoard(id);
}
export function openBoard(id: string) {
  pressed.clear(); useBoards.setState({ active: id, token: null, error: null, epoch: useBoards.getState().epoch + 1 });
  setState({ modal: 'whiteboard' }); void watchBoard(id, true);
}
export async function takeControl() {
  const id = useBoards.getState().active, socket = getSession()?.socket;
  if (!id || !socket?.connected) return;
  try {
    const result = await socket.timeout(8000).emitWithAck('board:claim', id);
    if (!result.ok) throw new Error(result.error);
    if (useBoards.getState().active !== id) { socket.emit('board:release', id, result.token, () => {}); return; }
    receiveBoard(result.state);
    useBoards.setState((s) => ({ token: result.token, epoch: s.epoch + 1, error: null }));
  } catch (err) { useBoards.setState({ error: (err as Error).message }); }
}
export function previewObject(object: BoardObject | null) {
  const { active, token, online } = useBoards.getState(), socket = getSession()?.socket;
  if (!active || !token || !online || !socket?.connected) return;
  const now = performance.now();
  if (object && now - lastPreview < 50) return;
  lastPreview = now; socket.emit('board:preview', active, token, object);
}
export function changeBoard(change: BoardChange): Promise<boolean> {
  const { active, token } = useBoards.getState();
  if (!active || !token) return Promise.resolve(false);
  useBoards.setState((s) => ({ saving: s.saving + 1 }));
  const operationId = crypto.randomUUID();
  const work = pending.catch(() => {}).then(async () => {
    const state = useBoards.getState(), socket = getSession()?.socket;
    if (state.active !== active || state.token !== token || !state.online || !socket?.connected) return false;
    const revision = state.boards[active]?.revision ?? 0;
    try {
      const result = await socket.timeout(8000).emitWithAck('board:change', active, { token, revision, operationId, change });
      if (!result.ok) { if (result.state) receiveBoard(result.state); throw new Error(result.error); }
      receiveBoard(result.state);
      if (change.type !== 'put') useBoards.setState((s) => ({ epoch: s.epoch + 1 }));
      useBoards.setState({ error: null }); return true;
    } catch (err) {
      useBoards.setState((s) => ({ error: `${(err as Error).message} Editing paused; take control again.`, token: null, epoch: s.epoch + 1 }));
      void watchBoard(active, true); return false;
    }
  }).finally(() => useBoards.setState((s) => ({ saving: Math.max(0, s.saving - 1) })));
  pending = work; return work;
}
export async function releaseControl() {
  await pending;
  const { active, token } = useBoards.getState(), socket = getSession()?.socket;
  if (active && token && socket?.connected) {
    try { await socket.timeout(5000).emitWithAck('board:release', active, token); } catch { /* Lease expiry releases a lost connection. */ }
  }
  useBoards.setState((s) => ({ token: null, epoch: s.epoch + 1 }));
}
export async function closeBoard() {
  await releaseControl(); pressed.clear(); useBoards.setState({ active: null });
  if (getState().modal === 'whiteboard') setState({ modal: 'none' });
}
export async function requestControl(force = false) {
  const id = useBoards.getState().active, socket = getSession()?.socket;
  if (!id || !socket?.connected) return;
  const ack = (result: BoardResult) => { if (!result.ok) useBoards.setState({ error: result.error }); else if (!force) toast('Control requested. The editor can click Done to hand over.'); };
  if (force) socket.emit('board:force-release', id, ack);
  else socket.emit('board:request', id, ack);
}
