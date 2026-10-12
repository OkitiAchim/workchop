import { useEffect, useRef, type PointerEvent } from 'react';
import type { RaceState } from '../../../../shared/racing';
import { serverNow } from '../../lib/clock';
import { local } from '../../lib/positions';
import { getSession, onSession } from '../../lib/session';
import { getState, toast, useStore } from '../../state/store';
import { registerOverlay } from '../../ui/overlays';
import { registerItemInteraction } from '../../world/extensions';
import { isTyping, pressed } from '../../world/input';
import { standUp } from '../../world/movement';
import { drawRace, SCREEN_HEIGHT, SCREEN_WIDTH } from './screen';
import { clearRaceControls, currentRaceInput, myRace, raceButtons, racingKeys, useRacing } from './state';
import { raceAudio } from './audio';
import { RaceInputSender } from './controls';
import './racing.css';

registerItemInteraction(['racing-tv'], { onClick: (item) => useRacing.setState({ watching: item.id }) });
let flushRaceInput = () => {};

onSession('racing', (session) => {
  const sender = new RaceInputSender((tvId, input) => session.socket.emit('race:input', tvId, input));
  let lastTv: string | null = null;
  const release = () => { clearRaceControls(); sender.release(performance.now()); raceAudio.silence(); };
  const pump = () => {
    const game = myRace();
    if (!game) {
      if (lastTv) { release(); pressed.clear(); }
      lastTv = null;
      sender.update(null, { gas: false, steer: 0 }, performance.now());
      raceAudio.silence();
      return;
    }
    lastTv = game.tvId;
    const active = document.hasFocus() && !document.hidden && !isTyping() && getState().mode === 'play' && getState().modal === 'none';
    if (!active) { release(); return; }
    const input = currentRaceInput();
    const sent = sender.update(game.tvId, input, performance.now());
    if (sent?.nitro) raceButtons.nitro = false;
    raceAudio.update(game, getState().selfId, true, active, useRacing.getState().audioEnabled, serverNow());
  };
  flushRaceInput = pump;
  const onState = (states: RaceState[]) => useRacing.setState({ games: Object.fromEntries(states.map((g) => [g.tvId, g])) });
  const rejected = (couchId: string) => {
    if (local.seat?.itemId !== couchId) return;
    standUp();
    pressed.clear();
    release();
    toast('That seat is occupied. Choose the other seat or wait for the next race.');
  };
  const keyboard = (e: KeyboardEvent) => {
    const game = myRace();
    if (!game || getState().mode !== 'play' || getState().modal !== 'none' || isTyping() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'KeyE') { release(); return; }
    if (!['Space', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'KeyB', 'KeyN'].includes(e.code)) return;
    e.preventDefault();
    e.stopPropagation();
    if (racingKeys.has(e.code)) return;
    racingKeys.add(e.code);
    raceAudio.unlock(useRacing.getState().audioEnabled);
    if (e.code === 'KeyN' && !e.repeat) raceButtons.nitro = true;
    if (e.code === 'Space' && !e.repeat && ['ready', 'finished'].includes(game.phase) && game.drivers[0]?.id === getState().selfId) {
      session.socket.emit('race:start', game.tvId);
    }
    pump();
  };
  const keyup = (e: KeyboardEvent) => { if (racingKeys.delete(e.code)) pump(); };
  const focus = () => { if (isTyping()) release(); };
  const joined = session.onJoined(() => {
    useRacing.setState({ games: {}, watching: null });
    release();
    session.socket.emit('race:sync');
  });
  session.socket.on('race:state', onState);
  session.socket.on('race:seat-rejected', rejected);
  session.socket.on('disconnect', release);
  window.addEventListener('keydown', keyboard, true);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', release);
  document.addEventListener('focusin', focus);
  document.addEventListener('visibilitychange', release);
  const timer = setInterval(pump, 25);
  return () => {
    clearInterval(timer);
    if (flushRaceInput === pump) flushRaceInput = () => {};
    joined();
    session.socket.off('race:state', onState);
    session.socket.off('race:seat-rejected', rejected);
    session.socket.off('disconnect', release);
    window.removeEventListener('keydown', keyboard, true);
    window.removeEventListener('keyup', keyup);
    window.removeEventListener('blur', release);
    document.removeEventListener('focusin', focus);
    document.removeEventListener('visibilitychange', release);
    release();
    raceAudio.dispose();
    useRacing.setState({ games: {}, watching: null });
  };
});

function RaceOverlay() {
  const games = useRacing((s) => s.games);
  const watching = useRacing((s) => s.watching);
  const selfId = useStore((s) => s.selfId);
  const audioEnabled = useRacing((s) => s.audioEnabled);
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = Object.values(games).find((g) => g.drivers.some((d) => d.id === selfId)) ?? (watching ? games[watching] : undefined);
  const gameRef = useRef(game);
  gameRef.current = game;
  const selfIdRef = useRef(selfId);
  selfIdRef.current = selfId;
  const driver = game?.drivers.find((d) => d.id === selfId);
  const host = game?.drivers[0]?.id === selfId;
  useEffect(() => {
    if (!game) return;
    let frame = 0;
    let lastGame: RaceState | undefined;
    let lastClock = -1;
    const draw = () => {
      const current = gameRef.current;
      const now = serverNow();
      const clock = current?.phase === 'racing' ? Math.floor(now / (1000 / 60)) : current?.phase === 'countdown' ? Math.ceil((current.startAt - now) / 1000) : 0;
      if (current !== lastGame || clock !== lastClock) {
        const ctx = canvas.current?.getContext('2d');
        const currentDriver = current?.drivers.find((d) => d.id === selfIdRef.current);
        if (ctx) drawRace(ctx, current, now, currentDriver ? (currentDriver.number - 1) as 0 | 1 : 'leader');
        lastGame = current;
        lastClock = clock;
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [game?.tvId]);
  if (!game) return null;
  const start = () => { raceAudio.unlock(audioEnabled); getSession()?.socket.emit('race:start', game.tvId); };
  const hold = (e: PointerEvent<HTMLButtonElement>, gas: boolean, steer: -1 | 0 | 1) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    raceAudio.unlock(audioEnabled);
    if (gas) raceButtons.gas = true;
    else raceButtons.steer = steer;
    flushRaceInput();
  };
  const release = (gas: boolean) => { if (gas) raceButtons.gas = false; else raceButtons.steer = 0; flushRaceInput(); };
  return (
    <aside className="race-overlay" aria-label={driver ? `Player ${driver.number} racing view` : 'Spectator racing view'}>
      <div className="race-overlay-title">
        <strong>{driver ? `Player ${driver.number}${host ? ' · Host' : ''}` : 'Watching the race'}</strong>
        {driver ? <button type="button" onClick={() => { standUp(); clearRaceControls(); flushRaceInput(); raceAudio.silence(); pressed.clear(); }}>Stand up (E)</button>
          : <button type="button" onClick={() => useRacing.setState({ watching: null })} aria-label="Close racing view">×</button>}
      </div>
      <canvas ref={canvas} width={SCREEN_WIDTH} height={SCREEN_HEIGHT} aria-label={driver ? `Player ${driver.number} chase camera` : 'Live chase camera of the leading car'} />
      {driver && <div className="race-controls">
        <button type="button" onPointerDown={(e) => hold(e, false, -1)} onPointerUp={() => release(false)} onPointerCancel={() => release(false)} onLostPointerCapture={() => release(false)} aria-label="Steer left">←</button>
        <button type="button" onPointerDown={(e) => hold(e, true, 0)} onPointerUp={() => release(true)} onPointerCancel={() => release(true)} onLostPointerCapture={() => release(true)}>Accelerate · Space / ↑</button>
        <button type="button" onPointerDown={(e) => hold(e, false, 1)} onPointerUp={() => release(false)} onPointerCancel={() => release(false)} onLostPointerCapture={() => release(false)} aria-label="Steer right">→</button>
      </div>}
      {driver && <div className="race-special-controls">
        <button type="button" onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); raceButtons.brake = true; flushRaceInput(); }} onPointerUp={() => { raceButtons.brake = false; flushRaceInput(); }} onPointerCancel={() => { raceButtons.brake = false; flushRaceInput(); }} onLostPointerCapture={() => { raceButtons.brake = false; flushRaceInput(); }}>Brake · B</button>
        <button type="button" disabled={game.cars[driver.number - 1].nitro <= 0 || game.phase !== 'racing'} onClick={() => { raceAudio.unlock(audioEnabled); raceButtons.nitro = true; flushRaceInput(); }}>Nitro · N</button>
        <button type="button" onClick={() => { useRacing.setState({ audioEnabled: !audioEnabled }); if (audioEnabled) raceAudio.silence(); else raceAudio.unlock(true); }}>{audioEnabled ? 'Mute engines' : 'Enable engines'}</button>
      </div>}
      {driver && (game.phase === 'ready' || game.phase === 'finished') && <button className="race-start" type="button" disabled={!host || game.drivers.length !== 2} onClick={start}>
        {game.drivers.length !== 2 ? 'Waiting for another player' : !host ? 'Player 1 starts the race' : game.phase === 'finished' ? 'Play again · Space' : 'Start race · Space'}
      </button>}
      {driver && <p>Dodge traffic · Grab nitro · Bash your rival. E to stand. Engine audio is private to racers.</p>}
    </aside>
  );
}

registerOverlay({ id: 'racing', order: 45, Component: RaceOverlay });
