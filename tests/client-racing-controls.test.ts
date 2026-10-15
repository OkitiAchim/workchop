import { describe, expect, it } from 'vitest';
import type { RaceInput } from '../shared/racing';
import { RaceInputSender, readRaceInput } from '../client/src/features/racing/controls';

const neutral: RaceInput = { gas: false, steer: 0, brake: false, nitro: false };
function driver() {
  const packets: { tv: string; input: RaceInput }[] = [];
  const sender = new RaceInputSender((tv, input) => packets.push({ tv, input }));
  return { sender, packets };
}

describe('responsive racer input delivery', () => {
  it('sends presses and releases without waiting for the heartbeat', () => {
    const { sender, packets } = driver();
    sender.update('tv', neutral, 0);
    sender.update('tv', { ...neutral, gas: true }, 8);
    sender.update('tv', neutral, 14);
    expect(packets.map((packet) => packet.input.gas)).toEqual([false, true, false]);
    sender.update('tv', neutral, 30);
    expect(packets).toHaveLength(3);
    sender.update('tv', neutral, 64);
    expect(packets).toHaveLength(4);
  });

  it('keeps rapid steering and held-key traffic within the server allowance', () => {
    const { sender, packets } = driver();
    for (let now = 0; now <= 5000; now++) {
      sender.update('tv', { ...neutral, gas: true, steer: now % 2 ? 1 : -1 }, now);
    }
    expect(packets.length).toBeLessThanOrEqual(104);
    expect(packets.length).toBeGreaterThanOrEqual(100);
    const held = driver();
    for (let now = 0; now <= 1000; now++) held.sender.update('tv', { ...neutral, gas: true }, now);
    expect(held.packets).toHaveLength(21);
  });

  it('preserves a nitro tap through a busy packet budget and sends it once', () => {
    const { sender, packets } = driver();
    for (let now = 0; now < 4; now++) sender.update('tv', { ...neutral, gas: true, steer: now % 2 ? 1 : -1 }, now);
    sender.update('tv', { ...neutral, gas: true, nitro: true }, 4);
    expect(packets).toHaveLength(4);
    sender.update('tv', { ...neutral, gas: true }, 60);
    sender.update('tv', { ...neutral, gas: true }, 110);
    expect(packets.filter((packet) => packet.input.nitro)).toHaveLength(1);
  });

  it('releases promptly on loss of focus and discards pending nitro on standing', () => {
    const { sender, packets } = driver();
    for (let now = 0; now < 4; now++) sender.update('tv', { ...neutral, gas: true, steer: now % 2 ? 1 : -1 }, now);
    sender.update('tv', { ...neutral, gas: true, nitro: true }, 4);
    sender.release(5);
    expect(packets.at(-1)?.input).toEqual(neutral);
    sender.update(null, neutral, 6);
    sender.update('other-tv', neutral, 150);
    expect(packets.filter((packet) => packet.input.nitro)).toHaveLength(0);
    expect(packets.at(-1)?.tv).toBe('other-tv');
  });

  it('gates controls and resolves opposing steering without consuming nitro', () => {
    const keys = new Set(['Space', 'KeyB', 'ArrowLeft', 'ArrowRight']);
    const buttons = { ...neutral, nitro: true };
    expect(readRaceInput(keys, buttons, true)).toEqual({ gas: true, brake: true, steer: 0, nitro: true });
    expect(readRaceInput(keys, buttons, false)).toEqual(neutral);
    expect(buttons.nitro).toBe(true);
  });
});
