import { useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import type { OfficeItem } from '../../../../shared/types';
import { BOARD_SURFACE_WIDTH, BOARD_SURFACE_HEIGHT } from '../../../../shared/whiteboard';
import { useStore } from '../../state/store';
import { registerItemDecor } from '../../world/extensions';
import { OpacityContext } from '../../world/prims';
import { assetVersion, subscribeAssets } from './assets';
import { paintBoard } from './render';
import { useBoards, watchBoard } from './state';

function Surface({ item }: { item: OfficeItem }) {
  const state = useBoards((s) => s.boards[item.id]);
  const role = useStore((s) => s.role), kind = useStore((s) => s.kind);
  const opacity = useContext(OpacityContext);
  const version = useSyncExternalStore(subscribeAssets, assetVersion);
  const surface = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 576;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return { canvas, texture };
  }, []);
  const allowed = !(kind === 'support' && role === 'guest');
  useEffect(() => { if (allowed) void watchBoard(item.id); }, [item.id, allowed]);
  useEffect(() => { paintBoard(surface.canvas, allowed ? state : undefined); surface.texture.needsUpdate = true; }, [surface, state, version, allowed]);
  useEffect(() => () => surface.texture.dispose(), [surface]);
  return <mesh position={[0, 1.3, 0.026]}>
    <planeGeometry args={[BOARD_SURFACE_WIDTH, BOARD_SURFACE_HEIGHT]} />
    <meshBasicMaterial map={surface.texture} toneMapped={false} transparent opacity={opacity} />
  </mesh>;
}
registerItemDecor({ id: 'whiteboard-surface', order: 10, types: ['whiteboard'], Component: Surface });
