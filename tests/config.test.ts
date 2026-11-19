// Haelt die Werte der Vorgabe fest. Wer public/combat_config.json absichtlich
// umstellt, passt diese Datei mit an - die Regeltests in combat.test.ts
// rechnen mit den Werten aus der Datei und bleiben davon unberuehrt.

import { describe, expect, it } from 'vitest';
import rawConfig from '../public/combat_config.json';
import { COMMAND_IDS, parseConfig } from '../src/combat';
import { loadConfig } from './helpers';

describe('Konfiguration: Werte der Vorgabe', () => {
  const c = loadConfig();

  it('Simulationsschritt 10 ms', () => {
    expect(c.simulation.stepMs).toBe(10);
  });

  it('Leben, Ausdauer, Regeneration', () => {
    expect(c.fighter.maxHealth).toBe(100);
    expect(c.fighter.maxStamina).toBe(100);
    expect(c.fighter.staminaRegenPerSecond).toBe(12);
    expect(c.fighter.staminaRegenDelayMs).toBe(800);
    expect(c.fighter.inputBufferMs).toBe(600);
  });

  it('Aushol-Zeiten', () => {
    expect(c.commands.strike.windupMs).toBe(900);
    expect(c.commands.left.windupMs).toBe(1000);
    expect(c.commands.right.windupMs).toBe(1000);
    expect(c.commands.kick.windupMs).toBe(950);
    expect(c.commands.sweep.windupMs).toBe(950);
    expect(c.commands.charge.windupMs).toBe(1400);
  });

  it('Dauern von Block, Rolle und Scheinangriff', () => {
    expect(c.commands.block.activeMs).toBe(900);
    expect(c.commands.roll.activeMs).toBe(500);
    expect(c.commands.bluff.activeMs).toBe(450);
    expect(c.commands.bluff.mimics).toBe('strike');
  });

  it('Schaden', () => {
    expect(c.weapons.sword.damage).toBe(10);
    expect(c.commands.strike.damageFromWeapon).toBe(true);
    expect(c.commands.left.damageFromWeapon).toBe(true);
    expect(c.commands.right.damageFromWeapon).toBe(true);
    expect(c.commands.kick.damage).toBe(5);
    expect(c.commands.sweep.damage).toBe(5);
    expect(c.commands.charge.damage).toBe(20);
    expect(c.commands.bluff.damage).toBe(0);
  });

  it('Wirkungen', () => {
    expect(c.commands.kick.stunMs).toBe(700);
    expect(c.commands.kick.breaksBlock).toBe(true);
    expect(c.commands.charge.breaksBlock).toBe(true);
    expect(c.commands.sweep.knockdownMs).toBe(1400);
    expect(c.commands.sweep.hitsRolling).toBe(true);
    expect(c.commands.sweep.stoppedByAnyBlock).toBe(true);
  });

  it('Ausdauerkosten', () => {
    expect(c.commands.strike.staminaCost).toBe(10);
    expect(c.commands.left.staminaCost).toBe(10);
    expect(c.commands.right.staminaCost).toBe(10);
    expect(c.commands.block.staminaCost).toBe(8);
    expect(c.commands.kick.staminaCost).toBe(15);
    expect(c.commands.roll.staminaCost).toBe(20);
    expect(c.commands.sweep.staminaCost).toBe(15);
    expect(c.commands.charge.staminaCost).toBe(25);
    expect(c.commands.bluff.staminaCost).toBe(6);
  });

  it('Block: Parier-Fenster, Laehmung, Anteile', () => {
    expect(c.block.directionalBlock).toBe(true);
    expect(c.block.perfectParryWindowMs).toBe(350);
    expect(c.block.parryStunMs).toBe(1300);
    expect(c.block.wrongDirectionDamageFactor).toBe(0.5);
    // "Block haelt, aber 25 % Schaden" = das Schwert faengt 75 % ab.
    expect(c.weapons.sword.blockValue).toBe(0.75);
  });

  it('Waffe: Haltbarkeit und Faustkampf', () => {
    expect(c.activeWeapon).toBe('sword');
    expect(c.weapons.sword.durability).toBe(100);
    expect(c.brokenWeapon).toBe('fists');
    expect(c.weapons.fists.damage).toBe(4);
    expect(c.weapons.fists.blockValue).toBe(0.5);
    expect(c.weapons.fists.canParry).toBe(false);
  });

  it('Waffentabelle ist vorbereitet; spielbar sind Schwert und Schwert + Schild', () => {
    expect(c.weapons.spear.damage).toBe(15);
    expect(c.weapons.axe.damage).toBe(20);
    expect(c.weapons.axe.windupFactor).toBeGreaterThan(1);
    expect(c.weapons.axe.staminaFactor).toBeGreaterThan(1);
    expect(c.weapons.dualSwords).toBeDefined();
    for (const id of ['spear', 'axe', 'dualSwords']) {
      expect(c.weapons[id].enabled).toBe(false);
    }
    // Der Schild kam am 19.11.2026 auf Marcos Wunsch dazu; Vorgabe bleibt das Schwert.
    expect(c.weapons.sword.enabled).toBe(true);
    expect(c.weapons.swordShield.enabled).toBe(true);
    expect(c.weapons.swordShield.shield).toBe(true);
    expect(c.weapons.sword.shield).toBe(false);
  });

  it('Match und Sprechstrafe', () => {
    expect(c.match.bestOf).toBe(3);
    expect(c.match.roundTimeMs).toBe(90000);
    expect(c.speech.penaltyWindowMs).toBe(1200);
    expect(c.speech.penaltyStamina).toBe(5);
  });

  it('Bot: Sprechzeit und Reaktionszeit', () => {
    expect(c.bot.speechDelayMs).toBe(450);
    expect(c.bot.speechJitterMs).toBe(100);
    expect(c.bot.reactionMs).toBe(250);
    expect(c.bot.reactionJitterMs).toBe(80);
  });

  it('Sprechbeginn-Erkennung: 2 s Kalibrierung, Mindestdauer 120 ms', () => {
    expect(c.voice.vad.calibrationMs).toBe(2000);
    expect(c.voice.vad.minSpeechMs).toBe(120);
  });

  it('Tasten der Vorgabe', () => {
    const keys = Object.fromEntries(COMMAND_IDS.map((id) => [id, c.commands[id].key]));
    expect(keys).toEqual({
      strike: 'KeyW',
      left: 'KeyA',
      right: 'KeyD',
      block: 'KeyS',
      kick: 'KeyK',
      roll: 'KeyR',
      sweep: 'KeyE',
      charge: 'KeyC',
      bluff: 'KeyB',
    });
  });
});

describe('Konfiguration: Pruefung', () => {
  const copy = (): typeof rawConfig => JSON.parse(JSON.stringify(rawConfig));

  it('meldet einen fehlenden Wert mit seinem Pfad', () => {
    const raw = copy();
    delete (raw.commands.kick as { stunMs?: number }).stunMs;
    expect(() => parseConfig(raw)).toThrow(/commands\.kick\.stunMs/);
  });

  it('lehnt zwei Befehle mit demselben Wort ab', () => {
    const raw = copy();
    raw.commands.kick.word = 'strike';
    expect(() => parseConfig(raw)).toThrow(/commands\.kick\.word/);
  });

  it('lehnt eine nicht freigegebene Waffe als aktive Waffe ab', () => {
    const raw = copy();
    raw.activeWeapon = 'axe';
    expect(() => parseConfig(raw)).toThrow(/activeWeapon/);
  });

  it('lehnt ein Ersatzwort ab, das schon einem anderen Befehl gehoert', () => {
    const raw = copy();
    raw.commands.kick.aliases = ['links'];
    expect(() => parseConfig(raw)).toThrow(/commands\.kick\.aliases/);
    const own = copy();
    own.commands.kick.aliases = ['strike'];
    expect(() => parseConfig(own)).toThrow(/commands\.kick\.aliases/);
  });

  it('jeder Befehl hat seine Liste von Ersatzwoertern', () => {
    const config = parseConfig(copy());
    for (const id of COMMAND_IDS) expect(Array.isArray(config.commands[id].aliases)).toBe(true);
    expect(config.commands.left.aliases).toContain('links');
    expect(config.commands.right.aliases).toContain('rechts');
  });

  it('nimmt ein geaendertes Befehlswort an', () => {
    const raw = copy();
    raw.commands.strike.word = 'Hit';
    expect(parseConfig(raw).commands.strike.word).toBe('hit');
  });
});
