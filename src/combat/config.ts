// Aufbau und Pruefung von public/combat_config.json.
//
// Im Code steht KEIN einziger Spielwert als Vorgabe. Fehlt ein Wert in der
// Datei, bricht `parseConfig` mit dem genauen Pfad ab, statt still mit einer
// Zahl weiterzurechnen, die niemand eingestellt hat.

import {
  BOT_LEVEL_IDS,
  COMMAND_IDS,
  type ActionKind,
  type BotLevelId,
  type CommandId,
  type Line,
} from './types';

export interface CommandConfig {
  /** Gesprochenes Wort (klein geschrieben, Englisch wegen des Sprachmodells). */
  word: string;
  /**
   * Weitere Schreibweisen, die als dieses Wort gelten. Nur fuer Erkenner, die
   * freien Text liefern (Web Speech API, Diktierfunktion); Vosk kennt durch
   * seine Grammatik ohnehin nur die Befehlswoerter.
   */
  aliases: string[];
  /** Tastencode (KeyboardEvent.code), z. B. "KeyW". */
  key: string;
  label: string;
  kind: ActionKind;
  line: Line;
  staminaCost: number;
  /** Aushol- und Ausdauer-Faktor der Waffe gelten fuer diesen Befehl. */
  usesWeapon: boolean;
  /** true: Schaden kommt aus der Waffentabelle. false: fester `damage`. */
  damageFromWeapon: boolean;
  damage: number;
  windupMs: number;
  /** Dauer der Blockhaltung, der Unverwundbarkeit bzw. des Scheinangriffs. */
  activeMs: number;
  recoveryMs: number;
  breaksBlock: boolean;
  stoppedByAnyBlock: boolean;
  hitsRolling: boolean;
  stunMs: number;
  knockdownMs: number;
  /** Nur Scheinangriff: welchen Befehl der Gegner zu sehen bekommt. */
  mimics: CommandId | '';
}

export interface WeaponConfig {
  label: string;
  enabled: boolean;
  /** Der Kaempfer traegt links einen Schild und blockt damit. */
  shield: boolean;
  damage: number;
  windupFactor: number;
  staminaFactor: number;
  /** Anteil des Schadens, den ein normaler Block abfaengt (0.75 = 25 % kommen durch). */
  blockValue: number;
  canParry: boolean;
  durability: number;
}

export interface BotLevelConfig {
  label: string;
  thinkMinMs: number;
  thinkMaxMs: number;
  reactChance: number;
  correctCounterChance: number;
  timingChance: number;
  punishChance: number;
  comboChance: number;
  restBelowStamina: number;
  restUntilStamina: number;
  adaptive: boolean;
  adaptWindow: number;
  adaptMinSamples: number;
  adaptThreshold: number;
  adaptBoost: number;
  attackWeights: Record<string, number>;
}

export interface BotConfig {
  defaultLevel: BotLevelId;
  speechDelayMs: number;
  speechJitterMs: number;
  reactionMs: number;
  reactionJitterMs: number;
  parryLeadMs: number;
  rollLeadMs: number;
  combos: {
    afterSweep: CommandId[];
    afterBluff: CommandId[];
    afterBlock: CommandId[];
  };
  levels: Record<BotLevelId, BotLevelConfig>;
}

export interface VoiceConfig {
  engine: 'auto' | 'vosk' | 'webspeech' | 'dictation' | 'off';
  language: string;
  minConfidence: number;
  commit: 'final' | 'partial';
  partialStableMs: number;
  vosk: { modelUrl: string; feedMs: number; loadTimeoutMs: number };
  mic: { echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean };
  vad: {
    calibrationMs: number;
    frameMs: number;
    noisePercentile: number;
    thresholdFactor: number;
    minThreshold: number;
    maxThreshold: number;
    releaseFactor: number;
    minSpeechMs: number;
    maxGapMs: number;
    endSilenceMs: number;
    maxUtteranceMs: number;
  };
}

export interface CombatConfig {
  version: number;
  simulation: { stepMs: number; maxCatchUpMs: number };
  match: {
    bestOf: number;
    roundTimeMs: number;
    roundStartDelayMs: number;
    roundEndDelayMs: number;
  };
  fighter: {
    maxHealth: number;
    maxStamina: number;
    staminaRegenPerSecond: number;
    staminaRegenDelayMs: number;
    /** `actionEnd`: Pause zaehlt ab Ende der Aktion. `actionStart`: ab Befehl. */
    staminaRegenDelayFrom: 'actionEnd' | 'actionStart';
    inputBufferMs: number;
    bufferWhileIncapacitated: boolean;
    interruptStaggerMs: number;
    allowControlChain: boolean;
  };
  block: {
    directionalBlock: boolean;
    mirrorDirections: boolean;
    perfectParryWindowMs: number;
    parryStunMs: number;
    wrongDirectionDamageFactor: number;
    wrongDirectionCostsDurability: boolean;
    endsOnParry: boolean;
  };
  speech: { penaltyWindowMs: number; penaltyStamina: number };
  commands: Record<CommandId, CommandConfig>;
  activeWeapon: string;
  brokenWeapon: string;
  weapons: Record<string, WeaponConfig>;
  bot: BotConfig;
  voice: VoiceConfig;
  input: { keyboardDelayMs: number };
}

// ---------------------------------------------------------------------------
// Pruefung
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function fail(path: string, expected: string, got: unknown): never {
  throw new Error(
    `combat_config.json: "${path}" muss ${expected} sein, ist aber ${JSON.stringify(got)}.`,
  );
}

function obj(parent: Json, key: string, path: string): Json {
  const v = parent[key];
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${path}${key}`, 'ein Objekt', v);
  return v as Json;
}

function num(parent: Json, key: string, path: string, min = -Infinity, max = Infinity): number {
  const v = parent[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path}${key}`, 'eine Zahl', v);
  if (v < min || v > max) fail(`${path}${key}`, `eine Zahl zwischen ${min} und ${max}`, v);
  return v;
}

function bool(parent: Json, key: string, path: string): boolean {
  const v = parent[key];
  if (typeof v !== 'boolean') fail(`${path}${key}`, 'true oder false', v);
  return v;
}

function str(parent: Json, key: string, path: string): string {
  const v = parent[key];
  if (typeof v !== 'string') fail(`${path}${key}`, 'eine Zeichenkette', v);
  return v;
}

function oneOf<T extends string>(
  parent: Json,
  key: string,
  path: string,
  allowed: readonly T[],
): T {
  const v = parent[key];
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    fail(`${path}${key}`, `einer von ${allowed.join(', ')}`, v);
  }
  return v as T;
}

function wordList(parent: Json, key: string, path: string): string[] {
  const v = parent[key];
  if (!Array.isArray(v)) fail(`${path}${key}`, 'eine Liste von Wörtern', v);
  const out: string[] = [];
  for (const entry of v) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      fail(`${path}${key}`, 'eine Liste nicht leerer Wörter', v);
    }
    out.push(entry.trim().toLowerCase());
  }
  return out;
}

function commandList(parent: Json, key: string, path: string): CommandId[] {
  const v = parent[key];
  if (!Array.isArray(v)) fail(`${path}${key}`, 'eine Liste von Befehlen', v);
  for (const entry of v) {
    if (typeof entry !== 'string' || !COMMAND_IDS.includes(entry as CommandId)) {
      fail(`${path}${key}`, `eine Liste aus ${COMMAND_IDS.join(', ')}`, v);
    }
  }
  return v as CommandId[];
}

const KINDS: readonly ActionKind[] = ['attack', 'block', 'roll', 'feint'];
const LINES: readonly Line[] = ['high', 'left', 'right', 'low', 'none'];

function parseCommand(parent: Json, id: CommandId): CommandConfig {
  const path = `commands.${id}.`;
  const c = obj(parent, id, 'commands.');
  const mimicsRaw = str(c, 'mimics', path);
  if (mimicsRaw !== '' && !COMMAND_IDS.includes(mimicsRaw as CommandId)) {
    fail(`${path}mimics`, 'leer oder ein Befehl', mimicsRaw);
  }
  const cmd: CommandConfig = {
    word: str(c, 'word', path).trim().toLowerCase(),
    aliases: wordList(c, 'aliases', path),
    key: str(c, 'key', path),
    label: str(c, 'label', path),
    kind: oneOf(c, 'kind', path, KINDS),
    line: oneOf(c, 'line', path, LINES),
    staminaCost: num(c, 'staminaCost', path, 0),
    usesWeapon: bool(c, 'usesWeapon', path),
    damageFromWeapon: bool(c, 'damageFromWeapon', path),
    damage: num(c, 'damage', path, 0),
    windupMs: num(c, 'windupMs', path, 0),
    activeMs: num(c, 'activeMs', path, 0),
    recoveryMs: num(c, 'recoveryMs', path, 0),
    breaksBlock: bool(c, 'breaksBlock', path),
    stoppedByAnyBlock: bool(c, 'stoppedByAnyBlock', path),
    hitsRolling: bool(c, 'hitsRolling', path),
    stunMs: num(c, 'stunMs', path, 0),
    knockdownMs: num(c, 'knockdownMs', path, 0),
    mimics: mimicsRaw as CommandId | '',
  };
  if (cmd.word === '') fail(`${path}word`, 'ein nicht leeres Wort', cmd.word);
  if (cmd.kind === 'feint' && cmd.mimics === '') {
    fail(`${path}mimics`, 'bei einem Scheinangriff ein Befehl', cmd.mimics);
  }
  return cmd;
}

function parseWeapon(parent: Json, id: string): WeaponConfig {
  const path = `weapons.${id}.`;
  const w = obj(parent, id, 'weapons.');
  return {
    label: str(w, 'label', path),
    enabled: bool(w, 'enabled', path),
    shield: bool(w, 'shield', path),
    damage: num(w, 'damage', path, 0),
    windupFactor: num(w, 'windupFactor', path, 0.1),
    staminaFactor: num(w, 'staminaFactor', path, 0),
    blockValue: num(w, 'blockValue', path, 0, 1),
    canParry: bool(w, 'canParry', path),
    durability: num(w, 'durability', path, 0),
  };
}

function parseBotLevel(parent: Json, id: BotLevelId): BotLevelConfig {
  const path = `bot.levels.${id}.`;
  const l = obj(parent, id, 'bot.levels.');
  const weightsRaw = obj(l, 'attackWeights', path);
  const attackWeights: Record<string, number> = {};
  for (const key of Object.keys(weightsRaw)) {
    if (!COMMAND_IDS.includes(key as CommandId)) {
      fail(`${path}attackWeights.${key}`, 'ein bekannter Befehl', key);
    }
    attackWeights[key] = num(weightsRaw, key, `${path}attackWeights.`, 0);
  }
  const level: BotLevelConfig = {
    label: str(l, 'label', path),
    thinkMinMs: num(l, 'thinkMinMs', path, 0),
    thinkMaxMs: num(l, 'thinkMaxMs', path, 0),
    reactChance: num(l, 'reactChance', path, 0, 1),
    correctCounterChance: num(l, 'correctCounterChance', path, 0, 1),
    timingChance: num(l, 'timingChance', path, 0, 1),
    punishChance: num(l, 'punishChance', path, 0, 1),
    comboChance: num(l, 'comboChance', path, 0, 1),
    restBelowStamina: num(l, 'restBelowStamina', path, 0),
    restUntilStamina: num(l, 'restUntilStamina', path, 0),
    adaptive: bool(l, 'adaptive', path),
    adaptWindow: num(l, 'adaptWindow', path, 1),
    adaptMinSamples: num(l, 'adaptMinSamples', path, 1),
    adaptThreshold: num(l, 'adaptThreshold', path, 0, 1),
    adaptBoost: num(l, 'adaptBoost', path, 0),
    attackWeights,
  };
  if (level.thinkMaxMs < level.thinkMinMs) {
    fail(`${path}thinkMaxMs`, 'mindestens so gross wie thinkMinMs', level.thinkMaxMs);
  }
  return level;
}

/** Prueft die geladene JSON-Struktur und liefert sie typisiert zurueck. */
export function parseConfig(raw: unknown): CombatConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('combat_config.json: Die Datei enthaelt kein Objekt.');
  }
  const root = raw as Json;

  const simulation = obj(root, 'simulation', '');
  const match = obj(root, 'match', '');
  const fighter = obj(root, 'fighter', '');
  const block = obj(root, 'block', '');
  const speech = obj(root, 'speech', '');
  const commandsRaw = obj(root, 'commands', '');
  const weaponsRaw = obj(root, 'weapons', '');
  const bot = obj(root, 'bot', '');
  const voice = obj(root, 'voice', '');
  const input = obj(root, 'input', '');

  const commands = {} as Record<CommandId, CommandConfig>;
  for (const id of COMMAND_IDS) commands[id] = parseCommand(commandsRaw, id);

  // Zwei Befehle mit demselben Wort oder derselben Taste waeren nicht
  // unterscheidbar - das faellt sonst erst im Kampf auf.
  const words = new Map<string, CommandId>();
  const keys = new Map<string, CommandId>();
  for (const id of COMMAND_IDS) {
    const other = words.get(commands[id].word);
    if (other) fail(`commands.${id}.word`, `ein anderes Wort als bei "${other}"`, commands[id].word);
    words.set(commands[id].word, id);
    const otherKey = keys.get(commands[id].key);
    if (otherKey) fail(`commands.${id}.key`, `eine andere Taste als bei "${otherKey}"`, commands[id].key);
    keys.set(commands[id].key, id);
  }

  // Auch die Ersatzwoerter duerfen nirgends doppelt vorkommen.
  for (const id of COMMAND_IDS) {
    for (const alias of commands[id].aliases) {
      const other = words.get(alias);
      if (other) fail(`commands.${id}.aliases`, `ohne "${alias}" (gehört schon zu "${other}")`, alias);
      words.set(alias, id);
    }
  }

  const weapons: Record<string, WeaponConfig> = {};
  for (const id of Object.keys(weaponsRaw)) weapons[id] = parseWeapon(weaponsRaw, id);

  const activeWeapon = str(root, 'activeWeapon', '');
  const brokenWeapon = str(root, 'brokenWeapon', '');
  if (!weapons[activeWeapon]) fail('activeWeapon', 'ein Eintrag aus weapons', activeWeapon);
  if (!weapons[activeWeapon].enabled) {
    fail('activeWeapon', 'eine Waffe mit "enabled": true', activeWeapon);
  }
  if (!weapons[brokenWeapon]) fail('brokenWeapon', 'ein Eintrag aus weapons', brokenWeapon);

  const levelsRaw = obj(bot, 'levels', 'bot.');
  const levels = {} as Record<BotLevelId, BotLevelConfig>;
  for (const id of BOT_LEVEL_IDS) levels[id] = parseBotLevel(levelsRaw, id);
  const combos = obj(bot, 'combos', 'bot.');

  const vosk = obj(voice, 'vosk', 'voice.');
  const mic = obj(voice, 'mic', 'voice.');
  const vad = obj(voice, 'vad', 'voice.');

  const stepMs = num(simulation, 'stepMs', 'simulation.', 1, 100);
  if (!Number.isInteger(stepMs)) fail('simulation.stepMs', 'eine ganze Zahl', stepMs);

  const bestOf = num(match, 'bestOf', 'match.', 1, 99);
  if (!Number.isInteger(bestOf) || bestOf % 2 === 0) {
    fail('match.bestOf', 'eine ungerade ganze Zahl', bestOf);
  }

  return {
    version: num(root, 'version', ''),
    simulation: { stepMs, maxCatchUpMs: num(simulation, 'maxCatchUpMs', 'simulation.', stepMs) },
    match: {
      bestOf,
      roundTimeMs: num(match, 'roundTimeMs', 'match.', 1),
      roundStartDelayMs: num(match, 'roundStartDelayMs', 'match.', 0),
      roundEndDelayMs: num(match, 'roundEndDelayMs', 'match.', 0),
    },
    fighter: {
      maxHealth: num(fighter, 'maxHealth', 'fighter.', 1),
      maxStamina: num(fighter, 'maxStamina', 'fighter.', 0),
      staminaRegenPerSecond: num(fighter, 'staminaRegenPerSecond', 'fighter.', 0),
      staminaRegenDelayMs: num(fighter, 'staminaRegenDelayMs', 'fighter.', 0),
      staminaRegenDelayFrom: oneOf(fighter, 'staminaRegenDelayFrom', 'fighter.', [
        'actionEnd',
        'actionStart',
      ] as const),
      inputBufferMs: num(fighter, 'inputBufferMs', 'fighter.', 0),
      bufferWhileIncapacitated: bool(fighter, 'bufferWhileIncapacitated', 'fighter.'),
      interruptStaggerMs: num(fighter, 'interruptStaggerMs', 'fighter.', 0),
      allowControlChain: bool(fighter, 'allowControlChain', 'fighter.'),
    },
    block: {
      directionalBlock: bool(block, 'directionalBlock', 'block.'),
      mirrorDirections: bool(block, 'mirrorDirections', 'block.'),
      perfectParryWindowMs: num(block, 'perfectParryWindowMs', 'block.', 0),
      parryStunMs: num(block, 'parryStunMs', 'block.', 0),
      wrongDirectionDamageFactor: num(block, 'wrongDirectionDamageFactor', 'block.', 0, 1),
      wrongDirectionCostsDurability: bool(block, 'wrongDirectionCostsDurability', 'block.'),
      endsOnParry: bool(block, 'endsOnParry', 'block.'),
    },
    speech: {
      penaltyWindowMs: num(speech, 'penaltyWindowMs', 'speech.', 0),
      penaltyStamina: num(speech, 'penaltyStamina', 'speech.', 0),
    },
    commands,
    activeWeapon,
    brokenWeapon,
    weapons,
    bot: {
      defaultLevel: oneOf(bot, 'defaultLevel', 'bot.', BOT_LEVEL_IDS),
      speechDelayMs: num(bot, 'speechDelayMs', 'bot.', 0),
      speechJitterMs: num(bot, 'speechJitterMs', 'bot.', 0),
      reactionMs: num(bot, 'reactionMs', 'bot.', 0),
      reactionJitterMs: num(bot, 'reactionJitterMs', 'bot.', 0),
      parryLeadMs: num(bot, 'parryLeadMs', 'bot.', 0),
      rollLeadMs: num(bot, 'rollLeadMs', 'bot.', 0),
      combos: {
        afterSweep: commandList(combos, 'afterSweep', 'bot.combos.'),
        afterBluff: commandList(combos, 'afterBluff', 'bot.combos.'),
        afterBlock: commandList(combos, 'afterBlock', 'bot.combos.'),
      },
      levels,
    },
    voice: {
      engine: oneOf(voice, 'engine', 'voice.', ['auto', 'vosk', 'webspeech', 'dictation', 'off'] as const),
      language: str(voice, 'language', 'voice.'),
      minConfidence: num(voice, 'minConfidence', 'voice.', 0, 1),
      commit: oneOf(voice, 'commit', 'voice.', ['final', 'partial'] as const),
      partialStableMs: num(voice, 'partialStableMs', 'voice.', 0),
      vosk: {
        modelUrl: str(vosk, 'modelUrl', 'voice.vosk.'),
        feedMs: num(vosk, 'feedMs', 'voice.vosk.', 1),
        loadTimeoutMs: num(vosk, 'loadTimeoutMs', 'voice.vosk.', 1000),
      },
      mic: {
        echoCancellation: bool(mic, 'echoCancellation', 'voice.mic.'),
        noiseSuppression: bool(mic, 'noiseSuppression', 'voice.mic.'),
        autoGainControl: bool(mic, 'autoGainControl', 'voice.mic.'),
      },
      vad: {
        calibrationMs: num(vad, 'calibrationMs', 'voice.vad.', 0),
        frameMs: num(vad, 'frameMs', 'voice.vad.', 1),
        noisePercentile: num(vad, 'noisePercentile', 'voice.vad.', 0, 1),
        thresholdFactor: num(vad, 'thresholdFactor', 'voice.vad.', 1),
        minThreshold: num(vad, 'minThreshold', 'voice.vad.', 0, 1),
        maxThreshold: num(vad, 'maxThreshold', 'voice.vad.', 0, 1),
        releaseFactor: num(vad, 'releaseFactor', 'voice.vad.', 0, 1),
        minSpeechMs: num(vad, 'minSpeechMs', 'voice.vad.', 0),
        maxGapMs: num(vad, 'maxGapMs', 'voice.vad.', 0),
        endSilenceMs: num(vad, 'endSilenceMs', 'voice.vad.', 0),
        maxUtteranceMs: num(vad, 'maxUtteranceMs', 'voice.vad.', 1),
      },
    },
    input: { keyboardDelayMs: num(input, 'keyboardDelayMs', 'input.', 0) },
  };
}
