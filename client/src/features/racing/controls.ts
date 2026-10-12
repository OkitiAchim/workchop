import type { RaceInput } from '../../../../shared/racing';

const HEARTBEAT_MS = 50;
const INPUTS_PER_SECOND = 20;
const INPUT_BURST = 4;
const neutral = (): RaceInput => ({ gas: false, steer: 0, brake: false, nitro: false });
const sameDriving = (a: RaceInput, b: RaceInput) => a.gas === b.gas && a.steer === b.steer && !!a.brake === !!b.brake;
const isNeutral = (input: RaceInput) => !input.gas && !input.steer && !input.brake && !input.nitro;

export function readRaceInput(keys: ReadonlySet<string>, buttons: RaceInput, active: boolean): RaceInput {
  if (!active) return neutral();
  const left = keys.has('ArrowLeft') || keys.has('KeyA');
  const right = keys.has('ArrowRight') || keys.has('KeyD');
  return {
    gas: buttons.gas || keys.has('Space') || keys.has('ArrowUp'),
    steer: (buttons.steer || ((right ? 1 : 0) - (left ? 1 : 0))) as -1 | 0 | 1,
    brake: !!buttons.brake || keys.has('KeyB'),
    nitro: !!buttons.nitro,
  };
}

/** Sends input edges immediately while keeping sustained traffic inside the server's 20 Hz allowance. */
export class RaceInputSender {
  private tvId: string | null = null;
  private sent: RaceInput | null = null;
  private sentAt = -Infinity;
  private tokens = INPUT_BURST;
  private refillAt: number | null = null;
  private pendingNitro = false;

  constructor(private readonly emit: (tvId: string, input: RaceInput) => void) {}

  release(now: number): void {
    this.pendingNitro = false;
    this.update(this.tvId, neutral(), now);
  }

  update(tvId: string | null, input: RaceInput, now: number): RaceInput | undefined {
    if (this.refillAt !== null) this.tokens = Math.min(INPUT_BURST, this.tokens + Math.max(0, now - this.refillAt) * INPUTS_PER_SECOND / 1000);
    this.refillAt = now;
    if (tvId !== this.tvId) {
      if (this.tvId && this.sent && !isNeutral(this.sent)) {
        this.emit(this.tvId, neutral());
        this.tokens--;
      }
      this.tvId = tvId;
      this.sent = null;
      this.sentAt = -Infinity;
      this.pendingNitro = false;
    }
    if (!tvId) return;
    // A nitro tap survives a busy packet budget until the next actual transmission.
    this.pendingNitro ||= !!input.nitro;
    const next = { ...input, nitro: this.pendingNitro };
    const changed = !this.sent || !sameDriving(next, this.sent) || this.pendingNitro;
    if (!changed && now - this.sentAt < HEARTBEAT_MS) return;
    // Releasing all controls must stop the car promptly even when the packet budget is depleted.
    const urgentRelease = isNeutral(next) && this.sent && !isNeutral(this.sent);
    if (this.tokens < 1 && !urgentRelease) return;
    this.tokens--;
    this.emit(tvId, next);
    this.sent = next;
    this.sentAt = now;
    this.pendingNitro = false;
    return next;
  }
}
