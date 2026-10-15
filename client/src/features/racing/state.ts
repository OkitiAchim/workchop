import { create } from 'zustand';
import { CAR_COLORS, type RaceInput, type RaceState } from '../../../../shared/racing';
import { local } from '../../lib/positions';
import { getState } from '../../state/store';
import { isTyping } from '../../world/input';
import { readRaceInput } from './controls';

export const useRacing = create<{ games: Record<string, RaceState>; watching: string | null; audioEnabled: boolean }>(() => ({ games: {}, watching: null, audioEnabled: true }));

export function myRace(): RaceState | undefined {
  const id = getState().selfId;
  if (!id || local.anim !== 'sit' || !local.seat) return;
  return Object.values(useRacing.getState().games).find((g) => g.couchId === local.seat?.itemId && g.drivers.some((d) => d.id === id));
}

export function controllerColor(games: Record<string, RaceState>, id: string | null): string | undefined {
  if (!id) return;
  for (const game of Object.values(games)) {
    const driver = game.drivers.find((d) => d.id === id);
    if (driver) return CAR_COLORS[driver.number - 1];
  }
}

export const racingKeys = new Set<string>();
export const raceButtons = { gas: false, brake: false, nitro: false, steer: 0 as -1 | 0 | 1 };
export const clearRaceControls = () => { racingKeys.clear(); raceButtons.gas = false; raceButtons.brake = false; raceButtons.nitro = false; raceButtons.steer = 0; };

/** A presentation-safe snapshot; one-shot nitro is consumed only after its input packet is sent. */
export function currentRaceInput(): RaceInput {
  const state = getState();
  const active = !!myRace() && typeof document !== 'undefined' && document.hasFocus() && !document.hidden && !isTyping() && state.mode === 'play' && state.modal === 'none';
  return readRaceInput(racingKeys, raceButtons, active);
}
