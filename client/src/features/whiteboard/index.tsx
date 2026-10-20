import { lazy, Suspense } from 'react';
import type { BoardObject } from '../../../../shared/whiteboard';
import { onSession } from '../../lib/session';
import { setState, toast, useStore } from '../../state/store';
import { registerOverlay } from '../../ui/overlays';
import { registerItemInteraction, registerWorldModule } from '../../world/extensions';
import { clearBoardAssets } from './assets';
import { openBoard, receiveBoard, reconnectBoards, resetBoards, useBoards } from './state';
import './whiteboard.css';

const Editor = lazy(() => import('./Editor'));
registerItemInteraction(['whiteboard'], { available: (s) => !(s.kind === 'support' && s.role === 'guest'), onClick: (item) => openBoard(item.id) });
registerWorldModule(() => import('./scene'));
function WhiteboardOverlay() {
  const open = useStore((s) => s.modal === 'whiteboard');
  return open ? <Suspense fallback={<div className="wb-loading" role="status">Opening whiteboard…</div>}><Editor /></Suspense> : null;
}
registerOverlay({ id: 'whiteboard', order: 100, Component: WhiteboardOverlay });
onSession('whiteboard', (session) => {
  const socket = session.socket;
  socket.on('board:state', receiveBoard);
  const preview = (id: string, preview: BoardObject | null) => useBoards.setState((s) => {
    const board = s.boards[id]; return board ? { boards: { ...s.boards, [id]: { ...board, preview } } } : {};
  });
  const gone = (id: string) => {
    useBoards.setState((s) => { const boards = { ...s.boards }; delete boards[id]; return { boards, ...(s.active === id ? { active: null, token: null } : {}) }; });
    if (!useBoards.getState().active && useStore.getState().modal === 'whiteboard') setState({ modal: 'none' });
  };
  const requested = (_id: string, name: string) => toast(`${name} requested the whiteboard. Click Done to hand over.`);
  const disconnected = () => useBoards.setState({ online: false, token: null });
  socket.on('board:preview', preview); socket.on('board:gone', gone);
  socket.on('board:requested', requested); socket.on('disconnect', disconnected);
  const stop = session.onJoined(() => { clearBoardAssets(); reconnectBoards(); });
  const timer = setInterval(() => {
    const { active, token } = useBoards.getState();
    if (active && token && socket.connected) socket.emit('board:heartbeat', active, token, (r) => {
      if (!r.ok && useBoards.getState().token === token) useBoards.setState({ token: null, error: r.error });
    });
  }, 5000);
  return () => {
    stop(); clearInterval(timer); socket.off('board:state', receiveBoard); socket.off('board:preview', preview);
    socket.off('board:gone', gone); socket.off('board:requested', requested); socket.off('disconnect', disconnected);
    resetBoards(); clearBoardAssets();
  };
});
