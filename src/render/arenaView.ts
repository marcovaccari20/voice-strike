// Die 3D-Ansicht: Arena, zwei Figuren, Kamera, Treffer-Effekte.
//
// Sie liest die Simulation nur und reagiert auf deren Ereignisse. Regeln
// stehen hier keine.

import {
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { CombatEvent, CombatSim } from '../combat';
import { resolveAnim } from './animState';
import { buildArena, type ArenaScene } from './arena';
import type { FighterAnimInput, FighterVisual, FighterVisualFactory } from './fighterVisual';
import { createPrimitiveFighter } from './primitiveFighter';

/** Abstand der beiden Kaempfer (m). Die Angriffshaltungen in poses.ts sind darauf abgestimmt. */
export const FIGHTER_GAP = 2.5;
const PLAYER = 0;

const FLASH_SECONDS = 0.22;
const SHAKE_SECONDS = 0.28;
const PARTICLE_COUNT = 72;
const GRAVITY = 6;

const COLOR_HIT = 0xff5340;
const COLOR_BLOCK = 0xf4f4f4;
const COLOR_PARRY = 0xffd84a;
const COLOR_DUST = 0xd8c08a;

interface Particle {
  mesh: Mesh;
  velocity: Vector3;
  life: number;
  maxLife: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

export class ArenaView {
  readonly fighters: [FighterVisual, FighterVisual];

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(46, 1, 0.1, 120);
  private readonly host: HTMLElement;

  // Schraeg hinter der rechten Schulter des Spielers: Er steht links im
  // Bild, der Gegner frei sichtbar rechts davon.
  // Der Blick geht nur leicht abwaerts, damit ueber der Mauer die Raenge im Bild sind.
  private readonly cameraBase = new Vector3(3.0, 2.3, FIGHTER_GAP / 2 + 3.2);
  private readonly cameraTarget = new Vector3(-0.25, 1.45, -FIGHTER_GAP / 2 + 0.75);
  private readonly arena: ArenaScene;

  private readonly flash = [0, 0];
  private shake = 0;
  private clockMs = 0;

  private readonly particles: Particle[] = [];
  private readonly particleMaterials = new Map<number, MeshBasicMaterial>();
  private nextParticle = 0;

  private readonly tmp = new Vector3();
  private readonly anim: FighterAnimInput = {
    clip: 'idle',
    phase: 'hold',
    progress: 0,
    timeMs: 0,
    clockMs: 0,
    flash: 0,
    weaponBroken: false,
    shield: false,
  };

  constructor(host: HTMLElement, factory: FighterVisualFactory = createPrimitiveFighter) {
    this.host = host;
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.outputColorSpace = SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    this.arena = buildArena(this.scene);

    // Spieler vorn (blau), mit dem Ruecken zur Kamera; Gegner gegenueber (rot).
    const player = factory({ color: 0x2f6fb5, accent: 0xf2c14e });
    player.root.position.set(0, 0, FIGHTER_GAP / 2);
    player.root.rotation.y = Math.PI;
    const opponent = factory({ color: 0xb53a2f, accent: 0x2b2b2b });
    opponent.root.position.set(0, 0, -FIGHTER_GAP / 2);
    this.fighters = [player, opponent];
    this.scene.add(player.root, opponent.root);

    const geometry = new IcosahedronGeometry(0.035, 0);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const mesh = new Mesh(geometry, this.particleMaterial(COLOR_BLOCK));
      mesh.visible = false;
      this.scene.add(mesh);
      this.particles.push({ mesh, velocity: new Vector3(), life: 0, maxLife: 1 });
    }

    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Im Hochformat weiter aufziehen, damit beide Figuren im Bild bleiben.
    this.camera.fov = w / h < 1 ? 62 : 46;
    this.camera.updateProjectionMatrix();
  }

  /** Ereignisse der Simulation in Effekte uebersetzen. */
  handleEvents(events: readonly CombatEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'Hit':
          this.arena.cheer(0.35);
          if (e.target >= 0) {
            this.flash[e.target] = 1;
            this.burst(this.fighters[e.target].getChestAnchor(this.tmp), COLOR_HIT, 12, 2.6);
            if (e.target === PLAYER) this.shake = 1;
          }
          break;
        case 'Blocked':
          if (e.fighter >= 0) {
            this.burst(this.fighters[e.fighter].getWeaponAnchor(this.tmp), COLOR_BLOCK, 8, 2.2);
            this.flash[e.fighter] = Math.max(this.flash[e.fighter], 0.35);
          }
          break;
        case 'Parried':
          this.arena.cheer(0.6);
          if (e.fighter >= 0) {
            this.burst(this.fighters[e.fighter].getWeaponAnchor(this.tmp), COLOR_PARRY, 20, 3.4);
          }
          break;
        case 'GuardBroken':
          this.arena.cheer(0.5);
          if (e.target >= 0) {
            this.burst(this.fighters[e.target].getWeaponAnchor(this.tmp), COLOR_HIT, 16, 3.2);
          }
          break;
        case 'Evaded':
          if (e.fighter >= 0) {
            this.tmp.copy(this.fighters[e.fighter].root.position);
            this.tmp.y = 0.1;
            this.burst(this.tmp, COLOR_DUST, 10, 1.6);
          }
          break;
        case 'RoundEnd':
        case 'MatchEnd':
          this.arena.cheer(1);
          break;
        case 'WeaponBroken':
          this.arena.cheer(0.8);
          if (e.fighter >= 0) {
            this.burst(this.fighters[e.fighter].getWeaponAnchor(this.tmp), COLOR_BLOCK, 24, 3.6);
          }
          break;
        default:
          break;
      }
    }
  }

  /**
   * Ein Bild zeichnen. `simTimeMs` ist die Simulationszeit einschliesslich
   * des noch nicht gerechneten Rests (weiche Bewegung zwischen den Schritten).
   */
  frame(sim: CombatSim, simTimeMs: number, dtSeconds: number): void {
    this.clockMs += dtSeconds * 1000;

    for (let i = 0; i < 2; i++) {
      const resolved = resolveAnim(sim, i, simTimeMs);
      this.flash[i] = Math.max(0, this.flash[i] - dtSeconds / FLASH_SECONDS);
      this.anim.clip = resolved.clip;
      this.anim.phase = resolved.phase;
      this.anim.progress = resolved.progress;
      // K.o. und Siegerpose laufen weiter, auch wenn die Simulation steht.
      this.anim.timeMs = resolved.clip === 'ko' ? this.holdTime(i, resolved.clip, dtSeconds) : resolved.timeMs;
      this.anim.clockMs = this.clockMs + i * 700;
      this.anim.flash = this.flash[i];
      this.anim.weaponBroken = sim.fighters[i].weaponBroken;
      this.anim.shield = sim.weaponOf(i).shield;
      if (resolved.clip !== 'ko') this.holdClip[i] = '';
      this.fighters[i].update(this.anim, dtSeconds);
    }

    this.updateParticles(dtSeconds);
    this.arena.update(dtSeconds, this.clockMs);

    // Kamera schraeg hinter dem Spieler, bei Treffern kurz erschuettert.
    this.shake = Math.max(0, this.shake - dtSeconds / SHAKE_SECONDS);
    const s = this.shake * this.shake * 0.09;
    this.camera.position.set(
      this.cameraBase.x + Math.sin(this.clockMs * 0.09) * s,
      this.cameraBase.y + Math.cos(this.clockMs * 0.11) * s,
      this.cameraBase.z,
    );
    this.camera.lookAt(this.cameraTarget);

    this.renderer.render(this.scene, this.camera);
  }

  /** Bildschirmposition ueber dem Kopf eines Kaempfers (CSS-Pixel im Host). */
  headScreenPosition(fighter: number, out: ScreenPoint): ScreenPoint {
    this.fighters[fighter].getHeadAnchor(this.tmp);
    this.tmp.project(this.camera);
    out.visible = this.tmp.z > -1 && this.tmp.z < 1;
    out.x = (this.tmp.x * 0.5 + 0.5) * this.host.clientWidth;
    out.y = (-this.tmp.y * 0.5 + 0.5) * this.host.clientHeight;
    return out;
  }

  // -------------------------------------------------------------------------

  private readonly holdClip: string[] = ['', ''];
  private readonly holdMs: number[] = [0, 0];

  /** Eigene Uhr fuer Ablaeufe, die nach Rundenende weiterlaufen muessen. */
  private holdTime(fighter: number, clip: string, dtSeconds: number): number {
    if (this.holdClip[fighter] !== clip) {
      this.holdClip[fighter] = clip;
      this.holdMs[fighter] = 0;
    } else {
      this.holdMs[fighter] += dtSeconds * 1000;
    }
    return this.holdMs[fighter];
  }

  private particleMaterial(color: number): MeshBasicMaterial {
    let material = this.particleMaterials.get(color);
    if (!material) {
      material = new MeshBasicMaterial({ color });
      this.particleMaterials.set(color, material);
    }
    return material;
  }

  private burst(at: Vector3, color: number, count: number, speed: number): void {
    const material = this.particleMaterial(color);
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.nextParticle];
      this.nextParticle = (this.nextParticle + 1) % this.particles.length;
      // Nur Optik, kein Spielzustand - hier darf der Zufall des Browsers ran.
      const a = Math.random() * Math.PI * 2;
      const up = 0.3 + Math.random() * 0.9;
      const v = speed * (0.45 + Math.random() * 0.55);
      p.velocity.set(Math.cos(a) * v, up * v, Math.sin(a) * v);
      p.mesh.position.copy(at);
      p.mesh.material = material;
      p.mesh.visible = true;
      p.mesh.scale.setScalar(1);
      p.maxLife = 0.3 + Math.random() * 0.3;
      p.life = p.maxLife;
    }
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      p.velocity.y -= GRAVITY * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      if (p.mesh.position.y < 0.02) {
        p.mesh.position.y = 0.02;
        p.velocity.y = 0;
      }
      p.mesh.scale.setScalar(Math.max(0.05, p.life / p.maxLife));
    }
  }
}
