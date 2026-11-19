// Datentypen der Kampflogik.
//
// Dieses Modul (src/combat) kennt weder Three.js noch den Browser. Alles hier
// sind flache Datensaetze aus Zahlen, Zeichenketten und Wahrheitswerten, damit
// sich die Logik spaeter eins zu eins nach C# (Unity) uebertragen laesst:
// aus `interface` wird `struct`/`class`, aus den Zeichenketten-Typen ein `enum`.

/** Die neun Befehle. Das gesprochene Wort steht in der Konfiguration. */
export type CommandId =
  | 'strike'
  | 'left'
  | 'right'
  | 'block'
  | 'kick'
  | 'roll'
  | 'sweep'
  | 'charge'
  | 'bluff';

export const COMMAND_IDS: readonly CommandId[] = [
  'strike',
  'left',
  'right',
  'block',
  'kick',
  'roll',
  'sweep',
  'charge',
  'bluff',
];

/** Was ein Befehl ausloest. Ein Richtungswort kann `attack` oder `block` sein. */
export type ActionKind = 'attack' | 'block' | 'roll' | 'feint';

/**
 * Angriffs- bzw. Blocklinie, immer aus Sicht des Kaempfers selbst:
 * `left` ist seine linke Seite. Der Verteidiger sieht denselben Schlag auf
 * seiner rechten Seite (siehe `block.mirrorDirections`).
 */
export type Line = 'high' | 'left' | 'right' | 'low' | 'none';

export type FighterStateId =
  | 'idle'
  | 'windup' // holt zu einem Angriff aus
  | 'recovery' // Nachlauf nach einer eigenen Aktion
  | 'block'
  | 'roll' // unverwundbarer Teil der Rolle
  | 'feint' // Scheinangriff, sieht aus wie `windup`
  | 'staggered' // kurz aus dem Tritt nach einer Unterbrechung
  | 'stunned' // betaeubt (Tritt)
  | 'paralyzed' // gelaehmt (wurde pariert)
  | 'down' // am Boden (Beinfeger)
  | 'ko';

export type MatchPhase = 'intro' | 'fighting' | 'roundOver' | 'matchOver';

export type BotLevelId = 'easy' | 'medium' | 'hard';

export const BOT_LEVEL_IDS: readonly BotLevelId[] = ['easy', 'medium', 'hard'];

export type CombatEventType =
  // Vorgabe
  | 'ActionStarted'
  | 'Hit'
  | 'Blocked'
  | 'Parried'
  | 'GuardBroken'
  | 'Evaded'
  | 'Interrupted'
  | 'WeaponBroken'
  | 'Exhausted'
  | 'RoundEnd'
  | 'MatchEnd'
  // Ergaenzungen fuer Anzeige und Bot
  | 'RoundIntro'
  | 'RoundStart'
  | 'CommandBuffered'
  | 'CommandRejected'
  | 'SpeechStarted'
  | 'SpeechResolved'
  | 'SpeechPenalty';

export type RejectReason = '' | 'stamina' | 'incapacitated' | 'notFighting' | 'bufferExpired';

export type HitEffect = 'none' | 'stun' | 'knockdown' | 'stagger';

export type RoundEndReason = '' | 'ko' | 'time';

/**
 * Ein Ereignis der Simulation. Bewusst EIN flacher Datensatz fuer alle Arten;
 * welche Felder eine Art nutzt, steht an der Stelle, an der sie erzeugt wird
 * (sim.ts). Unbenutzte Felder tragen ihren Leerwert (-1, '', 0, false).
 */
export interface CombatEvent {
  type: CombatEventType;
  /** Zeit seit Matchbeginn in ms. */
  timeMs: number;
  /** Laufende Runde, 1-basiert. */
  round: number;
  /** Handelnder Kaempfer (0 oder 1), -1 wenn keiner. */
  fighter: number;
  /** Betroffener Kaempfer, -1 wenn keiner. */
  target: number;
  /** Der tatsaechliche Befehl. */
  command: CommandId | '';
  /** Was der Gegner sieht. Beim Scheinangriff `strike`, sonst gleich `command`. */
  shownCommand: CommandId | '';
  kind: ActionKind | '';
  line: Line;
  /** Verursachter Schaden an `target` bzw. beim Block am Verteidiger. */
  damage: number;
  /** Dauer in ms, je nach Art: Ausholen, Betaeubung, Laehmung ... */
  durationMs: number;
  /** Zahlenwert je nach Art: Haltbarkeitsverlust, Ausdauerstrafe ... */
  amount: number;
  effect: HitEffect;
  reason: RejectReason | RoundEndReason;
  /** Je nach Art: falsche Blockrichtung, Angriff traf einen Rollenden ... */
  flag: boolean;
}

/** Zustand eines Kaempfers. Wird von Anzeige und Bot nur gelesen. */
export interface FighterData {
  id: number;
  health: number;
  stamina: number;
  durability: number;
  weaponBroken: boolean;
  /** Schluessel in `config.weapons`: aktive Waffe oder nach dem Bruch `fists`. */
  weaponId: string;
  roundsWon: number;

  state: FighterStateId;
  stateStartMs: number;
  stateEndMs: number;

  /** Laufende eigene Aktion; '' wenn keine. */
  command: CommandId | '';
  /** Was der Gegner davon sieht. */
  shownCommand: CommandId | '';
  kind: ActionKind | '';
  /** Zaehlt jede begonnene Aktion; daran erkennt der Bot eine neue Aktion. */
  actionSeq: number;
  /** Zeitpunkt des Einschlags waehrend `windup`. */
  impactAtMs: number;
  /** Linie des laufenden Angriffs oder Blocks. */
  line: Line;
  /** Beginn der Blockhaltung (fuer das Parier-Fenster). */
  blockStartMs: number;

  bufferedCommand: CommandId | '';
  bufferedAtMs: number;

  /** Bezugspunkt fuer den Beginn der Ausdauer-Regeneration. */
  lastActionMs: number;
  /** Beginn des offenen Sprechfensters, -1 wenn keines offen ist. */
  speechStartMs: number;
}

/** Das, was ein Gegner von einem Kaempfer sehen kann (Scheinangriff verdeckt). */
export interface VisibleAction {
  /** `feint` erscheint hier als `windup`. */
  state: FighterStateId;
  command: CommandId | '';
  kind: ActionKind | '';
  line: Line;
  actionSeq: number;
  startMs: number;
}
