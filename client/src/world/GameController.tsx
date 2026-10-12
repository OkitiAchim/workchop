import { Ball, Box, Cyl } from './prims';

/** The same controller geometry sits on the table and in the player's hands. */
export function GameController({ color }: { color: string }) {
  return (
    <group>
      <Box p={[0, 0, 0]} s={[0.28, 0.075, 0.17]} c="#202b3b" rounded />
      {[-1, 1].map((side) => <Ball key={side} p={[side * 0.15, -0.012, 0.055]} s={[0.075, 0.055, 0.115]} c={color} />)}
      <Box p={[-0.075, 0.042, -0.015]} s={[0.06, 0.012, 0.02]} c="#e9f4ff" shadow={false} />
      <Box p={[-0.075, 0.043, -0.015]} s={[0.02, 0.012, 0.06]} c="#e9f4ff" shadow={false} />
      {[[-0.018, 0], [0.018, 0], [0, -0.018], [0, 0.018]].map(([dx, dz], i) => <Cyl key={i} p={[0.085 + dx, 0.046, -0.025 + dz]} rad={0.008} h={0.012} c={i % 2 ? '#ffca6c' : color} shadow={false} />)}
      <Cyl p={[-0.028, 0.05, 0.04]} rad={0.02} h={0.018} c="#101725" />
      <Cyl p={[0.038, 0.05, 0.04]} rad={0.02} h={0.018} c="#101725" />
    </group>
  );
}
