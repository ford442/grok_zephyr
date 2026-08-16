/** Packed into uni.view_mode bits 17–19 (see UniformWriter). */
export const PHYSICS_MODE = {
  SIMPLE: 0,
  KEPLERIAN: 1,
  J2: 2,
} as const;

export type PhysicsMode = (typeof PHYSICS_MODE)[keyof typeof PHYSICS_MODE];

export const PHYSICS_MODE_SHIFT = 17;
export const PHYSICS_MODE_MASK = 7;

export const PHYSICS_MODE_NAMES = ['Simple', 'Keplerian', 'J2 Perturbed'] as const;

export function unpackPhysicsMode(viewFlags: number): number {
  return (viewFlags >>> PHYSICS_MODE_SHIFT) & PHYSICS_MODE_MASK;
}

export function packPhysicsBits(physicsMode: number): number {
  return (physicsMode & PHYSICS_MODE_MASK) << PHYSICS_MODE_SHIFT;
}
