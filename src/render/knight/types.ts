// Naht zwischen Skelett und Aussehen.

import type { KnightSkeleton } from './skeleton';

/** Farben, in denen sich die beiden Ritter unterscheiden. */
export interface KnightLook {
  /** Wappenrock und Schildkreuz. */
  tabard: number;
  /** Borte des Wappenrocks. */
  trim: number;
  /** Helmbusch. */
  plume: number;
}

/** Das sichtbare Netz, das an den Knochen haengt. */
export interface KnightMesh {
  /** Treffer-Aufblitzen 0..1. */
  setFlash(glow: number): void;
  /** Schwert und Schild zeigen oder verbergen. */
  setLoadout(armed: boolean, shield: boolean): void;
  dispose(): void;
}

/** Baut das Netz und haengt es an die Knochen des Skeletts. */
export type KnightMeshBuilder = (skeleton: KnightSkeleton, look: KnightLook) => KnightMesh;
