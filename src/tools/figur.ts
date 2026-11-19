// Figuren-Werkstatt (figur.html): der Ritter allein vor neutralem Grund.
//
// Zwei Zwecke:
//   1. Ansehen: jeden Ablauf in Echtzeit oder verlangsamt abspielen, die
//      Kamera frei drehen, Ausruestung und Netz wechseln.
//   2. Pruefen: `window.figur.sheet(...)` spielt eine Folge von Ablaeufen mit
//      festem Zeitschritt durch und liefert einen Bildbogen (ein PNG mit
//      einem Bild je Zeitpunkt und Blickwinkel). Damit laesst sich eine
//      Bewegung beurteilen, ohne sie in Echtzeit zu sehen.
//
// Gehoert nicht zum Spiel und wird von `npm run build` nicht mitgebaut.

import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SkeletonHelper,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseConfig, type CombatConfig } from '../combat';
import type { ClipId, ClipPhase, FighterAnimInput, FighterVisual } from '../render/fighterVisual';
import { buildBlockout } from '../render/knight/blockout';
import { knightFactory } from '../render/knight/knightFighter';
import type { KnightMeshBuilder } from '../render/knight/types';
import { FIGHTER_GAP } from '../render/stage';

/** Ein Abschnitt einer Folge: Ablauf, Phase, Dauer. */
interface Step {
  clip: ClipId;
  phase: ClipPhase;
  ms: number;
  /** Treffer-Aufblitzen zu Beginn des Abschnitts (0..1) - loest den Treffer-Ruck aus. */
  flash?: number;
}

type CamId = 'side' | 'left' | 'front' | 'back' | '34' | '34l' | '34back' | 'top';

interface Setup {
  /** Netz: 'blockout' (Gelenkfigur) oder der Dateiname unter render/knight ohne .ts, z. B. 'mesh'. */
  mesh: string;
  shield: boolean;
  weaponBroken: boolean;
  /** Zweite Figur gegenueber. */
  pair: boolean;
  /** Knochen als Linien einblenden. */
  bones: boolean;
}

interface SheetOptions extends Partial<Setup> {
  steps: Step[];
  /** Folge der zweiten Figur (nur mit `pair`); ohne Angabe steht sie in der Grundhaltung. */
  stepsB?: Step[];
  /** Abstand der Aufnahmen (ms). */
  everyMs: number;
  /** Aufnahmen nur in diesem Zeitfenster der Folge. */
  fromMs?: number;
  toMs?: number;
  cams: CamId[];
  /** Breite und Hoehe eines Einzelbildes (px). */
  cell?: [number, number];
  /** Bilder je Zeile. */
  cols?: number;
  /** Bildausschnitt: Hoehe in Metern und Blickpunkt. */
  viewHeight?: number;
  target?: [number, number, number];
}

const LOOKS = [
  { color: 0x2c3f7c, accent: 0xe2a24a, plume: 0xb23a2c },
  { color: 0xc8442f, accent: 0xe2a24a, plume: 0xb23a2c },
];
const BACKDROP = 0xd9d9dc;
const FOV = 26;
const STEP_MS = 1000 / 60;

const meshModules = import.meta.glob<Record<string, unknown>>('../render/knight/mesh*.ts');

async function loadBuilder(name: string): Promise<KnightMeshBuilder> {
  if (name === 'blockout') return buildBlockout;
  const loader = meshModules[`../render/knight/${name}.ts`];
  if (!loader) throw new Error(`Netz "${name}" nicht gefunden (render/knight/${name}.ts).`);
  const module = await loader();
  const builder = module.buildKnightMesh;
  if (typeof builder !== 'function') throw new Error(`render/knight/${name}.ts exportiert kein buildKnightMesh.`);
  return builder as KnightMeshBuilder;
}

/** Welcher Abschnitt einer Folge zum Zeitpunkt `t` laeuft und wie lange schon. */
function locate(steps: Step[], t: number): { step: Step; local: number } {
  let start = 0;
  for (let i = 0; i < steps.length; i++) {
    if (t < start + steps[i].ms || i === steps.length - 1) return { step: steps[i], local: Math.max(0, t - start) };
    start += steps[i].ms;
  }
  return { step: steps[0], local: 0 };
}

class Workshop {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 100);
  private readonly controls: OrbitControls;
  private readonly host: HTMLElement;
  private fighters: FighterVisual[] = [];
  private helpers: SkeletonHelper[] = [];
  private setup: Setup = { mesh: 'blockout', shield: true, weaponBroken: false, pair: false, bones: false };
  private config: CombatConfig | null = null;
  private readonly focus = [new Vector3(), new Vector3()];
  private readonly input: FighterAnimInput = {
    clip: 'idle', phase: 'hold', progress: 0, timeMs: 0, clockMs: 0, flash: 0, weaponBroken: false, shield: true, focus: null,
  };

  // Abspielen in Echtzeit
  private steps: Step[] = [{ clip: 'idle', phase: 'hold', ms: 2000 }];
  private playMs = 0;
  private clockMs = 0;
  private speed = 1;
  private paused = false;
  private busy = false;
  private last = performance.now();

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.outputColorSpace = SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    this.scene.background = new Color(BACKDROP);
    this.scene.add(new HemisphereLight(0xffffff, 0xb9b2aa, 1.25));
    this.scene.add(new AmbientLight(0xffffff, 0.35));
    const sun = new DirectionalLight(0xfff4e6, 2.3);
    sun.position.set(-2.5, 5.5, 4.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -4;
    sun.shadow.camera.right = 4;
    sun.shadow.camera.top = 4;
    sun.shadow.camera.bottom = -4;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    const rim = new DirectionalLight(0xdfe8ff, 0.7);
    rim.position.set(3, 3, -4);
    this.scene.add(rim);

    const ground = new Mesh(new PlaneGeometry(40, 40), new MeshStandardMaterial({ color: BACKDROP, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.placeCamera('34', 2.5, [0, 0.95, 0.1]);
    this.controls.update();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  async start(): Promise<void> {
    const response = await fetch('combat_config.json', { cache: 'no-store' });
    this.config = parseConfig(await response.json());
    const query = new URLSearchParams(location.search);
    await this.apply({
      mesh: query.get('mesh') ?? ('../render/knight/mesh.ts' in meshModules ? 'mesh' : 'blockout'),
      shield: query.get('shield') !== '0',
      weaponBroken: query.get('fists') === '1',
      pair: query.get('pair') === '1',
      bones: query.get('bones') === '1',
    });
    const clip = (query.get('clip') ?? 'idle') as ClipId;
    this.steps = this.timeline(clip);
    this.buildBar(clip);
    requestAnimationFrame(this.loop);
  }

  /** Figuren neu aufbauen. */
  async apply(change: Partial<Setup>): Promise<void> {
    this.setup = { ...this.setup, ...change };
    const builder = await loadBuilder(this.setup.mesh);
    for (const f of this.fighters) f.dispose();
    for (const h of this.helpers) h.removeFromParent();
    this.fighters = [];
    this.helpers = [];
    const factory = knightFactory(builder);
    const count = this.setup.pair ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const fighter = factory(LOOKS[i]);
      if (this.setup.pair) {
        fighter.root.position.set(0, 0, i === 0 ? -FIGHTER_GAP / 2 : FIGHTER_GAP / 2);
        fighter.root.rotation.y = i === 0 ? 0 : Math.PI;
      }
      this.scene.add(fighter.root);
      this.fighters.push(fighter);
      if (this.setup.bones) {
        const helper = new SkeletonHelper(fighter.root);
        this.scene.add(helper);
        this.helpers.push(helper);
      }
    }
    this.clockMs = 0;
  }

  /**
   * Uebliche Folge fuer einen Ablauf, mit den Dauern aus combat_config.json:
   * kurz Grundhaltung, dann der Ablauf, dann wieder Grundhaltung.
   */
  timeline(clip: ClipId, lead = 350, tail = 450): Step[] {
    if (!this.config) throw new Error('Konfiguration noch nicht geladen.');
    const cfg = this.config;
    const idle = (ms: number): Step => ({ clip: 'idle', phase: 'hold', ms });
    const scale = cfg.tempo.windupScale;
    switch (clip) {
      case 'strike':
      case 'left':
      case 'right':
      case 'kick':
      case 'sweep':
      case 'charge': {
        const c = cfg.commands[clip];
        return [idle(lead), { clip, phase: 'windup', ms: c.windupMs * scale }, { clip, phase: 'recover', ms: c.recoveryMs }, idle(tail)];
      }
      case 'block_high':
      case 'block_left':
      case 'block_right':
        return [idle(lead), { clip, phase: 'hold', ms: cfg.commands.block.activeMs }, idle(tail)];
      case 'roll':
        return [
          idle(lead),
          { clip, phase: 'windup', ms: cfg.commands.roll.activeMs },
          { clip, phase: 'recover', ms: cfg.commands.roll.recoveryMs },
          idle(tail),
        ];
      case 'stagger':
        return [idle(lead), { clip, phase: 'hold', ms: cfg.fighter.interruptStaggerMs, flash: 1 }, idle(tail)];
      case 'stunned':
        return [idle(lead), { clip, phase: 'hold', ms: cfg.commands.kick.stunMs, flash: 1 }, idle(tail)];
      case 'paralyzed':
        return [idle(lead), { clip, phase: 'hold', ms: cfg.block.parryStunMs }, idle(tail)];
      case 'down':
        return [idle(lead), { clip, phase: 'hold', ms: cfg.commands.sweep.knockdownMs, flash: 1 }, idle(tail)];
      case 'ko':
        return [idle(lead), { clip, phase: 'hold', ms: 2600, flash: 1 }];
      case 'victory':
        return [idle(lead), { clip, phase: 'hold', ms: 3200 }];
      default:
        return [idle(2400)];
    }
  }

  /** Bildbogen: Folge mit festem Zeitschritt durchspielen und fotografieren. */
  async sheet(options: SheetOptions): Promise<string> {
    this.busy = true;
    try {
      await this.apply({
        mesh: options.mesh ?? this.setup.mesh,
        shield: options.shield ?? this.setup.shield,
        weaponBroken: options.weaponBroken ?? this.setup.weaponBroken,
        pair: options.pair ?? false,
        bones: options.bones ?? false,
      });
      const [cw, ch] = options.cell ?? [340, 300];
      const pair = this.setup.pair;
      const viewHeight = options.viewHeight ?? 2.25;
      const target = options.target ?? (pair ? [0, 0.95, 0] : [0, 0.95, 0.3]);
      const total = options.steps.reduce((sum, s) => sum + s.ms, 0);
      const from = options.fromMs ?? 0;
      const to = Math.min(options.toMs ?? total, total);
      const shots = Math.floor((to - from) / options.everyMs) + 1;
      const cols = Math.min(options.cols ?? 6, shots);
      const rowsPerCam = Math.ceil(shots / cols);

      const canvas = document.createElement('canvas');
      canvas.width = cols * cw;
      canvas.height = rowsPerCam * options.cams.length * ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Kein 2D-Kontext.');
      ctx.fillStyle = '#d9d9dc';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      this.renderer.setSize(cw, ch, false);
      this.camera.aspect = cw / ch;

      let shot = 0;
      let nextShot = from;
      for (let t = 0; t <= to + 0.001; t += STEP_MS) {
        this.advance(options.steps, options.stepsB ?? null, t, STEP_MS / 1000);
        if (t + 0.001 >= nextShot && shot < shots) {
          const label = this.describe(options.steps, t);
          options.cams.forEach((cam, camIndex) => {
            this.placeCamera(cam, viewHeight, target);
            this.renderer.render(this.scene, this.camera);
            const x = (shot % cols) * cw;
            const y = (camIndex * rowsPerCam + Math.floor(shot / cols)) * ch;
            ctx.drawImage(this.renderer.domElement, x, y, cw, ch);
            ctx.strokeStyle = 'rgba(0,0,0,0.25)';
            ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
            ctx.fillStyle = '#111';
            ctx.font = '12px monospace';
            ctx.fillText(`${cam}  ${label}`, x + 6, y + 15);
          });
          shot++;
          nextShot += options.everyMs;
        }
      }
      return canvas.toDataURL('image/png');
    } finally {
      this.resize();
      this.busy = false;
    }
  }

  /** Gelenkpunkte zu einem Zeitpunkt der Folge (Figur-Raum der ersten Figur), fuer Messungen. */
  async probe(options: { steps: Step[]; atMs: number[]; shield?: boolean; weaponBroken?: boolean }): Promise<unknown[]> {
    this.busy = true;
    try {
      await this.apply({ shield: options.shield ?? this.setup.shield, weaponBroken: options.weaponBroken ?? this.setup.weaponBroken, pair: false });
      const result: unknown[] = [];
      const times = [...options.atMs].sort((a, b) => a - b);
      let next = 0;
      const total = options.steps.reduce((sum, s) => sum + s.ms, 0);
      for (let t = 0; t <= total + 0.001 && next < times.length; t += STEP_MS) {
        this.advance(options.steps, null, t, STEP_MS / 1000);
        if (t + 0.001 >= times[next]) {
          const points: Record<string, number[]> = {};
          this.fighters[0].root.updateWorldMatrix(true, true);
          this.fighters[0].root.traverse((o) => {
            if (o.type === 'Bone') {
              const v = o.getWorldPosition(new Vector3());
              points[o.name] = [Number(v.x.toFixed(3)), Number(v.y.toFixed(3)), Number(v.z.toFixed(3))];
            }
          });
          result.push({ ms: times[next], label: this.describe(options.steps, t), points });
          next++;
        }
      }
      return result;
    } finally {
      this.busy = false;
    }
  }

  // -------------------------------------------------------------------------

  /** Stellt beide Figuren auf den Zeitpunkt `t` ihrer Folgen. */
  private advance(stepsA: Step[], stepsB: Step[] | null, t: number, dt: number): void {
    for (let i = 0; i < this.fighters.length; i++) {
      this.fighters[i].getHeadAnchor(this.focus[i]);
      this.focus[i].y -= 0.6;
    }
    for (let i = 0; i < this.fighters.length; i++) {
      const steps = i === 0 ? stepsA : stepsB;
      const input = this.input;
      input.clip = 'idle';
      input.phase = 'hold';
      input.progress = 0;
      input.timeMs = t;
      input.flash = 0;
      if (steps) {
        const { step, local } = locate(steps, t);
        input.clip = step.clip;
        input.phase = step.phase;
        input.progress = Math.min(1, local / Math.max(1, step.ms));
        input.timeMs = local;
        // Aufblitzen klingt in 220 ms ab, wie im Spiel.
        input.flash = step.flash ? Math.max(0, step.flash * (1 - local / 220)) : 0;
      }
      input.clockMs = t + i * 700;
      input.shield = this.setup.shield;
      input.weaponBroken = this.setup.weaponBroken;
      if (this.fighters.length === 2) {
        input.focus = this.focus[1 - i];
      } else {
        // Allein: auf den gedachten Gegner gegenueber schauen.
        input.focus = this.focus[1].set(0, 1.3, FIGHTER_GAP);
      }
      this.fighters[i].update(input, dt);
    }
  }

  private describe(steps: Step[], t: number): string {
    const { step, local } = locate(steps, t);
    const p = Math.min(1, local / Math.max(1, step.ms));
    return `${step.clip}/${step.phase} p=${p.toFixed(2)} ${Math.round(local)}ms`;
  }

  private placeCamera(cam: CamId, viewHeight: number, target: readonly number[]): void {
    const d = viewHeight / 2 / Math.tan((FOV / 2) * (Math.PI / 180));
    const [tx, ty, tz] = target;
    this.camera.up.set(0, 1, 0);
    switch (cam) {
      case 'side':
        this.camera.position.set(tx - d, ty + 0.1, tz);
        break;
      case 'left':
        this.camera.position.set(tx + d, ty + 0.1, tz);
        break;
      case 'front':
        this.camera.position.set(tx, ty + 0.1, tz + d);
        break;
      case 'back':
        this.camera.position.set(tx, ty + 0.1, tz - d);
        break;
      case '34':
        this.camera.position.set(tx - d * 0.6, ty + 0.45, tz + d * 0.8);
        break;
      case '34l':
        this.camera.position.set(tx + d * 0.6, ty + 0.45, tz + d * 0.8);
        break;
      case '34back':
        this.camera.position.set(tx - d * 0.6, ty + 0.45, tz - d * 0.8);
        break;
      case 'top':
        this.camera.position.set(tx, ty + d, tz);
        this.camera.up.set(0, 0, 1);
        break;
    }
    this.controls.target.set(tx, ty, tz);
    this.camera.lookAt(tx, ty, tz);
    this.camera.updateProjectionMatrix();
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private readonly loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(100, now - this.last);
    this.last = now;
    if (this.busy) return;
    if (!this.paused) {
      const step = dt * this.speed;
      this.playMs += step;
      this.clockMs += step;
      const total = this.steps.reduce((sum, s) => sum + s.ms, 0);
      if (this.playMs > total) {
        // Von vorn: Figur neu aufstellen, damit Rolle und Sturz sauber beginnen.
        this.playMs = 0;
      }
      this.advance(this.steps, null, this.playMs, (step / 1000) || 0);
      const info = document.getElementById('info');
      if (info) info.textContent = this.describe(this.steps, this.playMs);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private buildBar(initial: ClipId): void {
    const bar = document.getElementById('bar');
    if (!bar) return;
    const clips: ClipId[] = [
      'idle', 'strike', 'left', 'right', 'kick', 'sweep', 'charge', 'block_high', 'block_left', 'block_right',
      'roll', 'stagger', 'stunned', 'paralyzed', 'down', 'ko', 'victory',
    ];
    const select = (label: string, options: [string, string][], value: string, change: (v: string) => void): void => {
      const wrap = document.createElement('label');
      wrap.textContent = label;
      const el = document.createElement('select');
      for (const [v, text] of options) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = text;
        el.appendChild(o);
      }
      el.value = value;
      el.addEventListener('change', () => change(el.value));
      wrap.appendChild(el);
      bar.appendChild(wrap);
    };
    select('Ablauf', clips.map((c) => [c, c]), initial, (v) => {
      this.steps = this.timeline(v as ClipId);
      this.playMs = 0;
    });
    select('Tempo', [['1', 'Echtzeit'], ['0.5', 'halb'], ['0.25', 'Viertel'], ['0.1', 'Zehntel']], '1', (v) => {
      this.speed = Number(v);
    });
    select(
      'Ausruestung',
      [['shield', 'Schwert + Schild'], ['sword', 'nur Schwert'], ['fists', 'Faeuste']],
      this.setup.weaponBroken ? 'fists' : this.setup.shield ? 'shield' : 'sword',
      (v) => void this.apply({ shield: v === 'shield', weaponBroken: v === 'fists' }),
    );
    const meshes: [string, string][] = [['blockout', 'Gelenkfigur']];
    for (const path of Object.keys(meshModules)) {
      const name = path.slice(path.lastIndexOf('/') + 1, -3);
      meshes.push([name, name === 'mesh' ? 'Ritter' : name]);
    }
    select('Aussehen', meshes, this.setup.mesh, (v) => void this.apply({ mesh: v }));
    const pause = document.createElement('button');
    pause.textContent = 'Pause';
    pause.addEventListener('click', () => {
      this.paused = !this.paused;
      pause.textContent = this.paused ? 'Weiter' : 'Pause';
    });
    bar.appendChild(pause);
    const bones = document.createElement('button');
    bones.textContent = 'Knochen';
    bones.addEventListener('click', () => void this.apply({ bones: !this.setup.bones }));
    bar.appendChild(bones);
  }
}

const host = document.getElementById('stage');
if (!host) throw new Error('figur.html: #stage fehlt.');
const workshop = new Workshop(host);
(window as unknown as { figur: Workshop }).figur = workshop;
workshop.start().catch((error: unknown) => {
  const info = document.getElementById('info');
  if (info) info.textContent = error instanceof Error ? error.message : String(error);
});
