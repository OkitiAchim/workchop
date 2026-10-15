import { seatsOf } from '../../../shared/catalog';
import { racingRigs, validRaceInput, type RacingRig } from '../../../shared/racing';
import type { Office, PlayerState } from '../../../shared/types';
import type { Feature } from '../../features';
import { RaceGame } from './game';

export const feature: Feature = {
  name: 'racing',
  register(ctx) {
    const offices = new Map<string, Map<string, RaceGame>>();
    const gamesFor = (id: string, office: Office): Map<string, RaceGame> => {
      let games = offices.get(id);
      if (!games) offices.set(id, (games = new Map()));
      const rigs = racingRigs(office);
      for (const rig of rigs) if (!games.has(rig.tv.id)) games.set(rig.tv.id, new RaceGame(rig.tv.id, rig.couch.id, Date.now()));
      for (const [tv, game] of games) {
        const rig = rigs.find((r) => r.tv.id === tv && r.couch.id === game.state.couchId);
        if (!rig) games.delete(tv);
      }
      return games;
    };
    const publish = (id: string) => ctx.realtime.emitToOffice(id, 'race:state', [...(offices.get(id)?.values() ?? [])].map((g) => g.snapshot(Date.now())));
    const sittingAt = (p: PlayerState, rig: RacingRig): number => p.anim === 'sit'
      ? seatsOf(rig.couch).findIndex((seat) => Math.hypot(p.x - seat.x, p.z - seat.z) < 0.22) : -1;
    const reconcile = (id: string, office: Office, changed?: PlayerState) => {
      const games = gamesFor(id, office);
      const rigs = racingRigs(office);
      const players = ctx.realtime.players(id);
      let dirty = false;
      for (const [tvId, game] of games) {
        const rig = rigs.find((r) => r.tv.id === tvId)!;
        for (const driver of [...game.state.drivers]) {
          const p = players.find((p) => p.id === driver.id);
          if (!p || p.customer || sittingAt(p, rig) !== driver.seat) dirty = game.leave(driver.id, Date.now()) || dirty;
        }
        // The accepted move packet determines arrival order, rather than polling/map order.
        if (changed && !changed.customer) {
          const seat = sittingAt(changed, rig);
          if (seat >= 0 && !game.state.drivers.some((d) => d.id === changed.id)) {
            if (game.seat(changed.id, changed.name, seat, Date.now())) dirty = true;
            else ctx.io.to(changed.id).emit('race:seat-rejected', rig.couch.id);
          }
        }
      }
      if (dirty) publish(id);
    };

    ctx.realtime.onJoin((s) => {
      const room = s.room();
      const office = s.office();
      if (room && office) {
        reconcile(room.officeId, office, s.me());
        s.socket.emit('race:state', [...offices.get(room.officeId)!.values()].map((g) => g.snapshot(Date.now())));
      }
    });
    ctx.realtime.onOfficeChange((id, office) => { reconcile(id, office); publish(id); });
    ctx.realtime.onLeave((_s, left) => {
      for (const game of offices.get(left.officeId)?.values() ?? []) game.leave(left.player.id, Date.now());
      if (ctx.realtime.onlineCount(left.officeId)) publish(left.officeId);
      else offices.delete(left.officeId);
    });
    ctx.realtime.onSocket((s) => {
      const canControl = s.limiter(20, 30);
      const canStart = s.limiter(2, 3);
      const canSync = s.limiter(1, 3);
      s.socket.on('move', () => {
        const room = s.room();
        const office = s.office();
        const me = s.me();
        if (room && office && me) reconcile(room.officeId, office, me);
      });
      s.socket.on('race:sync', () => {
        const room = s.room();
        const office = s.office();
        if (!room || !office || !canSync()) return;
        const games = gamesFor(room.officeId, office);
        s.socket.emit('race:state', [...games.values()].map((g) => g.snapshot(Date.now())));
      });
      s.socket.on('race:start', (tvId) => {
        const room = s.room();
        const office = s.office();
        if (!room || !office || typeof tvId !== 'string' || !canStart()) return;
        reconcile(room.officeId, office);
        const game = offices.get(room.officeId)?.get(tvId);
        if (game?.start(s.socket.id, Date.now())) publish(room.officeId);
      });
      s.socket.on('race:input', (tvId, input) => {
        const room = s.room();
        if (!room || typeof tvId !== 'string' || !validRaceInput(input) || !canControl()) return;
        offices.get(room.officeId)?.get(tvId)?.input(s.socket.id, input, Date.now());
      });
    });
    let tick = 0;
    const timer = setInterval(() => {
      const now = Date.now();
      tick++;
      for (const [id, games] of offices) {
        let active = false;
        let transitioned = false;
        for (const game of games.values()) {
          if (game.state.phase === 'countdown' || game.state.phase === 'racing') {
            const before = game.state.phase;
            game.tick(now);
            transitioned ||= before !== game.state.phase;
            active = true;
          }
        }
        if (transitioned || (active && tick % 2 === 0)) publish(id);
      }
    }, 50);
    timer.unref();
    ctx.onClose(() => { clearInterval(timer); offices.clear(); });
  },
};
