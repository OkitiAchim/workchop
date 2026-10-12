import { useFrame } from '@react-three/fiber';
import { useContext, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { RaceState } from '../../../shared/racing';
import { serverNow } from '../lib/clock';
import { drawRace, releaseRaceScreen, SCREEN_HEIGHT, SCREEN_WIDTH } from '../features/racing/screen';
import { useRacing } from '../features/racing/state';
import { Box, OpacityContext } from './prims';

export function RacingTv({ itemId }: { itemId?: string }) {
  const opacity = useContext(OpacityContext);
  const screen = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = SCREEN_WIDTH;
    canvas.height = SCREEN_HEIGHT;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { texture, ctx: canvas.getContext('2d')!, elapsed: 0, drawn: false, lastGame: undefined as RaceState | undefined, lastClock: -1 };
  }, []);
  useEffect(() => () => { screen.texture.dispose(); if (itemId) releaseRaceScreen(itemId); }, [screen, itemId]);
  useFrame((_, dt) => {
    screen.elapsed += dt;
    if (screen.elapsed < 1 / 30) return;
    screen.elapsed = 0;
    const game = itemId ? useRacing.getState().games[itemId] : undefined;
    const now = serverNow();
    const clock = game?.phase === 'racing' ? Math.floor(now / 33) : game?.phase === 'countdown' ? Math.ceil((game.startAt - now) / 1000) : 0;
    // Waiting/result screens are static; avoid uploading a large texture every frame.
    if (screen.drawn && screen.lastGame === game && screen.lastClock === clock) return;
    screen.drawn = true;
    screen.lastGame = game;
    screen.lastClock = clock;
    drawRace(screen.ctx, game, now);
    screen.texture.needsUpdate = true;
  });
  return (
    <group>
      <Box p={[0, 1.6, -0.025]} s={[0.8, 0.32, 0.04]} c="#252b32" />
      <Box p={[0, 1.6, 0.018]} s={[3, 1.73, 0.06]} c="#11171e" roughness={0.3} />
      <mesh position={[0, 1.6, 0.049]}>
        <planeGeometry args={[2.9, 1.63125]} />
        <meshBasicMaterial map={screen.texture} toneMapped={false} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      <Box p={[1.37, 0.752, 0.049]} s={[0.025, 0.008, 0.003]} c="#71e0b5" emissive="#71e0b5" shadow={false} />
    </group>
  );
}
