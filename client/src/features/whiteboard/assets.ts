import { getSession } from '../../lib/session';

const images = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<void>>();
const urls = new Set<string>();
const listeners = new Set<() => void>();
let generation = 0, version = 0;
export const assetVersion = () => version;
export const subscribeAssets = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function boardImage(id: string): HTMLImageElement | undefined {
  if (!images.has(id) && !pending.has(id)) {
    const epoch = generation;
    const session = getSession();
    if (!session) return;
    const work = session.downloadAsset(id).then(async (blob) => {
      if (epoch !== generation) return;
      const url = URL.createObjectURL(blob); urls.add(url);
      const image = new Image(); image.src = url;
      await image.decode();
      if (epoch === generation) { images.set(id, image); version++; for (const fn of listeners) fn(); }
      else { URL.revokeObjectURL(url); urls.delete(url); }
    }).catch(() => {}).finally(() => { if (epoch === generation) pending.delete(id); });
    pending.set(id, work);
  }
  return images.get(id);
}
export function clearBoardAssets() {
  generation++; for (const url of urls) URL.revokeObjectURL(url);
  urls.clear(); images.clear(); pending.clear(); version++;
}
