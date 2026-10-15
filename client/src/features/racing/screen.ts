import { CAR_COLORS, FINISH_DISTANCE, RACE_MS, type RaceState } from '../../../../shared/racing';
import { raceViewDriver, type RacePerspective } from './camera';
import { RaceScene } from './scene';

export const SCREEN_WIDTH = 1280;
export const SCREEN_HEIGHT = 720;
let scene: RaceScene | undefined;
const label = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = '#ffffff') => {
  ctx.font = `700 ${size}px system-ui, sans-serif`; ctx.fillStyle = color; ctx.fillText(text, x, y);
};
const panel = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color = '#071322c9') => {
  ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();
};

/** The TV defaults to the leader; a seated player's overlay passes their own driver index. */
export function drawRace(ctx: CanvasRenderingContext2D, game: RaceState | undefined, now: number, perspective: RacePerspective = 'leader'): void {
  scene ??= new RaceScene();
  ctx.globalAlpha = 1;
  ctx.drawImage(scene.render(game, now, perspective), 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  ctx.textAlign = 'left';
  const phase = game?.phase ?? 'waiting';
  const seconds = phase === 'racing' ? Math.max(0, Math.ceil((game!.endAt - now) / 1000)) : RACE_MS / 1000;
  const focused = scene.followedDriver(game, perspective);
  const car = game?.cars[focused];
  panel(ctx, 20, 16, 400, 67);
  label(ctx, 'TURBO RIVALS', 38, 47, 28);
  label(ctx, perspective === 'leader' ? `LIVE  /  LEADER P${focused + 1}` : `PLAYER ${focused + 1}  /  CHASE CAMERA`, 38, 71, 17, CAR_COLORS[focused]);
  panel(ctx, 1090, 16, 170, 67);
  ctx.textAlign = 'right';
  label(ctx, `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, 1240, 63, 41);
  ctx.textAlign = 'left';
  for (let i = 0; i < 2; i++) {
    const c = game?.cars[i]; const driver = game?.drivers.find((d) => d.number === i + 1);
    const x = 22; const y = 100 + i * 61;
    panel(ctx, x, y, 270, 54, '#071322ad');
    label(ctx, `P${i + 1}  ${(driver?.name ?? 'Open seat').slice(0, 16)}`, x + 14, y + 24, 20, CAR_COLORS[i]);
    const gap = game ? Math.abs(game.cars[0].distance - game.cars[1].distance) : 0;
    label(ctx, `${Math.round((c?.speed ?? 0) * 3.6)} km/h${gap > 2 && i !== raceViewDriver(game!.cars, 'leader') ? `  −${Math.round(gap)} m` : ''}`, x + 14, y + 44, 15, '#d0dbea');
  }
  panel(ctx, 24, 606, 345, 92);
  label(ctx, String(Math.round((car?.speed ?? 0) * 3.6)).padStart(3, '0'), 42, 665, 58);
  label(ctx, 'KM/H', 173, 663, 19, '#bac9d9');
  label(ctx, now < (car?.boostUntil ?? 0) ? 'NITRO ACTIVE' : 'NITRO  /  N', 242, 636, 14, '#75eaff');
  ctx.fillStyle = '#28394c'; ctx.fillRect(242, 650, 106, 12);
  ctx.fillStyle = '#5ae7ff'; ctx.fillRect(242, 650, 106 * (car?.nitro ?? 0), 12);
  label(ctx, `${Math.round(100 * (car?.nitro ?? 0))}%`, 242, 685, 17, '#75eaff');
  for (let i = 0; i < 2; i++) {
    const x = 878; const y = 639 + i * 30;
    panel(ctx, x - 14, y - 23, 394, 27, '#071322ad');
    label(ctx, `P${i + 1}`, x, y - 3, 15, CAR_COLORS[i]);
    ctx.fillStyle = '#293b50'; ctx.fillRect(x + 34, y - 13, 326, 6);
    ctx.fillStyle = CAR_COLORS[i]; ctx.fillRect(x + 34, y - 13, 326 * Math.min(1, (game?.cars[i].distance ?? 0) / FINISH_DISTANCE), 6);
  }
  ctx.textAlign = 'center';
  if (phase !== 'racing') {
    panel(ctx, 150, 225, 980, 330, '#071322e6');
    if (phase === 'countdown') {
      label(ctx, String(Math.max(1, Math.ceil((game!.startAt - now) / 1000))), 640, 410, 144, '#ffe1a1');
      label(ctx, 'GET READY', 640, 492, 34);
    } else if (phase === 'finished') {
      label(ctx, game!.winner ? `PLAYER ${game!.winner.number} WINS!` : 'PHOTO FINISH — DRAW!', 640, 318, 53, game!.winner ? CAR_COLORS[game!.winner.number - 1] : '#ffe1a1');
      label(ctx, game!.winner?.name.slice(0, 30) ?? 'Same distance at the finish', 640, 369, 30);
      label(ctx, game!.reason === 'forfeit' ? 'The other player left their seat.' : 'RACE COMPLETE', 640, 421, 24, '#b9cadc');
      label(ctx, game!.drivers.length === 2 ? 'PLAYER 1: PRESS SPACE TO PLAY AGAIN' : 'Waiting for a second player to play again', 640, 499, 27);
    } else {
      label(ctx, 'MIDNIGHT HIGHWAY', 640, 293, 48, '#ffe1a1');
      label(ctx, phase === 'ready' ? 'PLAYER 1: PRESS SPACE TO START' : 'Sit on the couch · Two players required', 640, 345, 30);
      label(ctx, 'SPACE / ↑ GAS    ← / → STEER    B BRAKE    N NITRO', 640, 410, 25);
      label(ctx, 'Dodge traffic. Collect nitro. Outrace your rival.', 640, 459, 24, '#b9cadc');
      label(ctx, '2 MINUTES · FIRST TO THE FINISH WINS', 640, 508, 24, '#75eaff');
    }
  } else {
    const status = car?.crashVehicle !== null && car?.crashVehicle !== undefined ? `RECOVERING  /  ${Math.max(1, Math.ceil((car.crashUntil - now) / 1000))}s`
      : now < (car?.slowUntil ?? 0) ? 'BASHED  /  KEEP RACING' : now < (car?.boostUntil ?? 0) ? 'NITRO BOOST' : '';
    if (status) { panel(ctx, 427, 100, 426, 42); label(ctx, status, 640, 129, 23, '#ffe1a1'); }
    panel(ctx, 393, 670, 461, 28, '#071322ad');
    label(ctx, 'SPACE GAS    ← / → STEER    B BRAKE    N NITRO', 624, 689, 15, '#d0dbea');
  }
  ctx.textAlign = 'left';
}

export function releaseRaceScreen(id: string): void { scene?.release(id); }
if (import.meta.hot) import.meta.hot.dispose(() => { scene?.dispose(); scene = undefined; });
