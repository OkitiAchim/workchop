import { afterEach, describe, expect, it, vi } from 'vitest';
import { RaceGame } from '../server/features/racing/game';
import { canHearRace, RaceAudio } from '../client/src/features/racing/audio';

afterEach(() => vi.unstubAllGlobals());
function game() {
  const g = new RaceGame('tv', 'couch', 0); g.seat('a', 'Alice', 0, 0); g.seat('b', 'Bob', 1, 1); g.start('a', 0); g.tick(3000); return g.state;
}
describe('private racer engine audio', () => {
  it('allows only a seated, visible participant during a race', () => {
    const g = game();
    expect(canHearRace(g, 'a', true, true)).toBe(true);
    expect(canHearRace(g, 'b', true, true)).toBe(true);
    expect(canHearRace(g, 'spectator', true, true)).toBe(false);
    expect(canHearRace(g, 'a', false, true)).toBe(false);
    expect(canHearRace(g, 'a', true, false)).toBe(false);
    expect(canHearRace({ ...g, phase: 'finished' }, 'a', true, true)).toBe(false);
  });
  it('never creates audio for a spectator, and silences existing engines on standing or spectating', () => {
    const gains: { setTargetAtTime: ReturnType<typeof vi.fn>; value: number }[] = [];
    const param = () => ({ value: 0, setTargetAtTime: vi.fn() });
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    const create = vi.fn(function () { return {
      currentTime: 0, destination: {}, resume: vi.fn(async () => {}), close: vi.fn(async () => {}),
      createGain: () => { const gain = param(); gains.push(gain); return { ...node(), gain }; },
      createBiquadFilter: () => ({ ...node(), frequency: param(), Q: param() }),
      createStereoPanner: () => ({ ...node(), pan: param() }),
      createOscillator: () => ({ ...node(), frequency: param(), start: vi.fn(), stop: vi.fn() }),
    }; });
    vi.stubGlobal('AudioContext', create);
    const audio = new RaceAudio(); const g = game();
    audio.unlock(false); audio.update(g, 'spectator', false, true, true, 3100);
    expect(create).not.toHaveBeenCalled();
    audio.unlock(true); audio.update(g, 'a', true, true, true, 3100);
    expect(gains[0].setTargetAtTime.mock.calls.at(-1)?.[0]).toBeGreaterThan(0);
    audio.update(g, 'a', false, true, true, 3200);
    expect(gains[0].setTargetAtTime.mock.calls.at(-1)?.[0]).toBe(0);
    audio.update(g, 'spectator', true, true, true, 3200);
    expect(gains[1].setTargetAtTime.mock.calls.at(-1)?.[0]).toBe(0);
    audio.dispose();
  });
});
