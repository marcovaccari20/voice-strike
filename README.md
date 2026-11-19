# Voice Arena

Spielbarer Browser-Prototyp für ein sprachgesteuertes 1-gegen-1-Arena-Kampfspiel.
Ein Spieler (Mikrofon oder Tastatur) gegen einen Bot. Zweck: herausfinden, ob sich
Kämpfen per Stimme gut anfühlt.

Der Ordner ist **eigenständig**: eigenes `package.json`, eigenes Lockfile, kein
Workspace des Cavico-Monorepos. `npm run verify` im Repo-Stamm berührt ihn nicht.

## Start

```bash
cd voice-arena
npm install
npm run dev
```

Dann <http://localhost:5173> öffnen. Der Browser gibt das Mikrofon nur auf
`localhost` oder über `https` frei – deshalb nicht über die IP-Adresse aufrufen.

`npm run dev` lädt beim ersten Mal das Sprachmodell (41 MB) nach
`public/models/`. Es steht absichtlich nicht im Repo. Von Hand: `npm run modell`.
Schlägt das Laden fehl, startet das Spiel trotzdem und weicht auf die Web Speech
API des Browsers oder die Tastatur aus.

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver auf localhost:5173 |
| `npm test` | Tests der Kampflogik (vitest) |
| `npm run typecheck` | Typprüfung; `src/combat` zusätzlich **ohne** DOM-Typen |
| `npm run build` | Typprüfung und Produktionsbau nach `dist/` |
| `npm run modell` | Sprachmodell laden (mit Prüfsumme) |

Voraussetzung: Node 22 (ab 22.12) oder Node 24. Das ist die Vorgabe von vitest 5;
Vite 8 allein liefe auch mit Node 20.19. Geprüft mit Node 24.22.

## Befehle

Das gesprochene Wort und die Taste stehen je Befehl in `public/combat_config.json`
(`commands.<befehl>.word` bzw. `.key`). Die Wörter sind englisch, weil das
Sprachmodell englisch ist.

| Wort | Taste | Wirkung | Schaden | Ausholen | Ausdauer |
| --- | --- | --- | --- | --- | --- |
| `strike` | W | Schlag von oben | 10 | 900 ms | 10 |
| `left` | A | Schlag von links – oder Block links, siehe unten | 10 | 1000 ms | 10 |
| `right` | D | Schlag von rechts – oder Block rechts | 10 | 1000 ms | 10 |
| `block` | S | Blockhaltung, 900 ms aktiv | – | sofort | 8 |
| `kick` | K | bricht den Block, Gegner 700 ms betäubt | 5 | 950 ms | 15 |
| `roll` | R | 500 ms unverwundbar, weicht allem aus ausser `sweep` | – | sofort | 20 |
| `sweep` | E | Beinfeger, Gegner 1400 ms am Boden, trifft auch Rollende, jeder Block stoppt ihn | 5 | 950 ms | 15 |
| `charge` | C | Ansturm, bricht den Block | 20 | 1400 ms | 25 |
| `bluff` | B | Scheinangriff: zeigt 450 ms das Ausholen von `strike`, bricht dann ab | 0 | – | 6 |

Enter startet nach dem Matchende neu.

Die Befehlsliste im Spiel lässt sich auch anklicken oder antippen. Auf schmalen
Bildschirmen (Handy) wird sie zum Tastenfeld am unteren Rand – dort gibt es keine
Tastatur.

### Block

* **Timing.** Beginnt die Blockhaltung höchstens 350 ms vor dem Einschlag, ist es
  ein perfektes Parieren: kein Schaden, der Angreifer ist 1300 ms gelähmt, die
  Waffe nutzt sich nicht ab. Beginnt sie früher, hält der Block, aber 25 % des
  Schadens kommen durch und die Waffe verliert Haltbarkeit in Höhe des
  Angriffsschadens.
* **Richtung** (Schalter `block.directionalBlock`, auch im Debug-Feld).
  `block` stoppt `strike`. Gegen einen Seitenschlag sagt man **die Seite, auf der
  man den Schlag auf dem eigenen Bildschirm kommen sieht**. Schlägt der Gegner
  von *seiner* linken Seite, kommt der Schlag bei dir rechts an – also `right`.
  Ein Richtungswort gilt als Block, solange der Gegner gerade einen Seitenschlag
  ausholt; sonst ist es ein eigener Schlag. Die Befehlsliste im Spiel zeigt dann
  „JETZT: Block links/rechts". Falsche Richtung: 50 % Schaden, kein Parieren.
  Schalter aus: `block` stoppt alle Richtungen.
* **Waffe.** Haltbarkeit 100. Bei 0 zerbricht das Schwert: Schläge machen 4
  Schaden, der Block fängt nur noch 50 % ab und kann nicht parieren.

### Sprechen

Sobald ein Kämpfer zu sprechen beginnt, erscheint über ihm ein rotes „!" – noch
bevor das Wort erkannt ist. Wird innerhalb von 1200 ms nach Sprechbeginn kein
gültiger Befehl erkannt, kostet das 5 Ausdauer. Das Spiel gibt keinen Ton aus;
ein Lautsprecher würde sonst das eigene Mikrofon auslösen.

## Wo die Werte stehen

**Alle Spielwerte stehen in `public/combat_config.json`.** Im Code gibt es keine
Vorgaben: Fehlt ein Wert, bricht das Laden mit dem genauen Pfad ab
(`src/combat/config.ts`). Nach einer Änderung die Seite neu laden.

| Abschnitt | Inhalt |
| --- | --- |
| `simulation` | Zeitschritt (10 ms), wie viel Rückstand nachgeholt wird |
| `match` | Best of 3, Rundenzeit, Vorlauf, Pause nach der Runde |
| `fighter` | Leben, Ausdauer, Regeneration, Befehlspuffer |
| `block` | Richtungsblock, Parier-Fenster, Lähmung, falsche Richtung |
| `speech` | Sprechfenster und Strafe |
| `commands` | je Befehl: Wort, Taste, Art, Schaden, Zeiten, Kosten, Wirkungen |
| `weapons`, `activeWeapon`, `brokenWeapon` | Waffentabelle, aktive Waffe, Faustkampf |
| `bot` | Sprech- und Reaktionszeit, drei Stufen, Kombinationen |
| `voice` | Engine, Mindestsicherheit, Mikrofon, Pegelerkennung |
| `input` | simulierte Sprechzeit der Tastatur |

`tests/config.test.ts` hält die Werte der Vorgabe fest. Wer einen davon absichtlich
ändert, passt den Test mit an; die Regeltests rechnen mit den Werten aus der Datei.

### Waffentabelle

Vorbereitet sind Schwert, Speer, Axt/Morgenstern, Schwert + Schild und zwei
Schwerter, jeweils mit Schaden, Aushol-Faktor, Ausdauer-Faktor, Blockwert,
Parierfähigkeit und Haltbarkeit. **Aktiv und spielbar ist nur das Schwert**
(`"enabled": true`); eine andere Waffe als `activeWeapon` lehnt die Prüfung ab.
Schaden 15 (Speer) und 20 (Axt) stammen aus der Vorgabe. **Alle übrigen Werte der
nicht spielbaren Waffen sind Platzhalter und nicht ausbalanciert.**

## Ergänzungen zur Vorgabe

Die Vorgabe lässt Punkte offen, ohne die das Spiel nicht läuft. So sind sie
entschieden – alles Schalter oder Werte in der Konfiguration:

| Punkt | Entscheidung | Wert |
| --- | --- | --- |
| Nachlauf nach einer Aktion | Kurze Zeit, in der noch nichts Neues beginnt | `commands.*.recoveryMs`: Schläge 300, `charge` 400, `roll` 150, sonst 0 |
| „Regeneration beginnt 800 ms nach der letzten Aktion" | Gezählt wird ab **Ende** der Aktion; während einer Kette regeneriert nichts | `fighter.staminaRegenDelayFrom`: `actionEnd` (Alternative `actionStart`) |
| Block nach dem Parieren | Endet sofort, sonst käme kein Konter in die 1300 ms Lähmung | `block.endsOnParry` |
| Unterbrochener Kämpfer | Taumelt kurz | `fighter.interruptStaggerMs`: 200 |
| Befehle während Betäubung/Lähmung/am Boden | Werden abgelehnt und angezeigt, nicht gepuffert (die Vorgabe puffert nur während einer *eigenen* Aktion) | `fighter.bufferWhileIncapacitated`: false |
| Betäubung auf Betäubung | Verlängert sich nicht; wer am Boden liegt, wird nicht erneut niedergeworfen | `fighter.allowControlChain`: false |
| Falsche Blockrichtung und Haltbarkeit | Kostet Haltbarkeit wie ein normaler Block | `block.wrongDirectionCostsDurability` |
| Faustkampf | 4 Schaden gilt für `strike`, `left`, `right`; `kick`, `sweep`, `charge` behalten ihren festen Schaden | `commands.*.damageFromWeapon` |
| Unentschiedene Runde | Zählt für niemanden. Nach drei Runden gewinnt, wer mehr hat; sonst Unentschieden | – |
| Erkannter Befehl ohne Ausdauer | Wird abgelehnt, zählt aber als gültiger Befehl – keine Sprechstrafe zusätzlich | – |

## Sprache

Hinter `SpeechEngine` (`src/voice/types.ts`) stecken zwei Umsetzungen:

1. **Vosk** (`vosk-browser`, kleines englisches Modell) – läuft vollständig lokal
   im Browser. Die Grammatik enthält nur die Befehlswörter plus `[unk]`.
2. **Web Speech API** – Ersatz, wenn Vosk nicht startet. In Chrome und Edge geht
   der Ton dabei an einen Dienst des Herstellers: **nicht lokal**, braucht
   Internet. Das Spiel meldet, wenn der Ersatz läuft.

`voice.engine`: `auto` (Vosk, sonst Ersatz), `vosk`, `webspeech` oder `off`.
Umschalten geht auch im Debug-Feld. Mit `off` zeigt das Startbild keinen
Mikrofon-Knopf und das Debug-Feld keine Sprach-Einstellungen – für Orte, an
denen es kein Mikrofon gibt.

**Sprechbeginn** erkennt `src/voice/vad.ts` über den Mikrofonpegel: beim Start
2 s Umgebungslärm messen (bitte still sein), Schwelle = Lärm × `thresholdFactor`
(begrenzt durch `minThreshold`/`maxThreshold`), Sprechbeginn nach 120 ms über der
Schwelle. „Lärm neu messen" im Debug-Feld wiederholt die Messung.

### Was am 19.11.2026 gemessen wurde

Headless-Chromium, synthetische Sprache (`espeak-ng`), simuliertes Mikrofon.
**Nicht gemessen: echte Stimme an echtem Mikrofon** – das ging in der
Umgebung, in der der Prototyp entstand, nicht.

* Alle neun Wörter in zwei Stimmen erkannt (18 von 18), auch mit Rauschen
  unterlegt (18 von 18). Modell lädt in rund 2 s.
* Vosk liefert sein Endergebnis von sich aus erst 1,1–1,4 s nach Sprechbeginn –
  später als das 1200-ms-Fenster. Deshalb fordert die Pegelerkennung es beim
  Sprechende sofort an. In der ganzen Kette (Mikrofon → „!" → Vosk → Aktion)
  lagen dann **570–830 ms zwischen Sprechbeginn und Aktion**.
* Der Bot spricht laut Vorgabe 450 ms ± 100 ms. Er ist damit schneller als die
  gemessene Kette. Der Regler „Bot: simulierte Sprechzeit" gleicht das aus.
* Vorläufige Ergebnisse kippen gelegentlich zwischen `block` und `bluff`.
  Deshalb zählt in der Vorgabe-Einstellung nur das Endergebnis
  (`voice.commit: "final"`). `"partial"` handelt schon auf ein vorläufiges
  Ergebnis, das `voice.partialStableMs` lang gleich bleibt – auf dieses Risiko.
  In der Messung brachte das keinen klaren Zeitgewinn (567–782 ms).
* Die Grammatik zwingt jedes Geräusch auf das ähnlichste Befehlswort: „black"
  wird `block`, „lift" wird `left`, „sleep" wird `sweep`, jeweils mit Sicherheit
  1,00. Unähnliches fällt durch („hello" → `block` mit 0,39 und damit unter
  `voice.minConfidence`; „okay" → unbekannt; ein Rauschstoss → nichts).
* Bei eindeutig gesprochenen Wörtern meldet Vosk fast immer 1,00. Die
  angezeigte Sicherheit sagt deshalb wenig; unter 1,00 lag sie nur mit Rauschen
  (0,72–0,82).

## Bot

Der Bot (`src/combat/bot.ts`) geht durch dieselben zwei Eingänge wie der Spieler
(`speechStart`, `command`) und hat dieselben Nachteile:

Reiz → Reaktionszeit 250 ms ± 80 ms → Entscheidung = simulierter Sprechbeginn,
das „!" erscheint → Sprechzeit 450 ms ± 100 ms → erst dann der Befehl.

Er sieht vom Gegner nur, was sichtbar ist: Ein `bluff` sieht für ihn aus wie ein
`strike`. Er spricht ein Wort nach dem anderen und nimmt ein begonnenes nicht
zurück.

| Stufe | Verhalten |
| --- | --- |
| leicht | greift zufällig an, blockt selten |
| mittel | reagiert auf Aushol-Animationen, macht dabei Fehler, kaum Timing |
| schwer | wehrt getimt ab, kontert, nutzt `bluff` und `kick` gegen häufiges Blocken und `sweep` gegen häufiges Rollen |

Gemessen in Bot-gegen-Bot-Matches (je 30): schwer schlägt mittel 30:0, mittel
schlägt leicht 30:0. **Wie stark die Stufen gegen einen Menschen sind, ist nicht
gemessen.**

## Debug-Feld

Oben rechts: Richtungsblock an/aus, Bot-Stufe, simulierte Sprechzeit des Bots,
simulierte Sprechzeit der Tastatur (das „!" erscheint beim Tastendruck, der Befehl
erst danach – so lässt sich die Sprachverzögerung mit der Tastatur nachstellen),
Spracherkennung, Lärm neu messen, Neustart.

Im Entwicklungsserver liegt das Spiel zusätzlich als `window.voiceArena` in der
Browser-Konsole.

## Aufbau

```
public/combat_config.json    alle Werte
public/audio/                AudioWorklet für das Mikrofon
scripts/fetch-model.mjs      lädt das Sprachmodell
src/combat/                  Kampflogik – ohne Three.js, ohne Browser
  types.ts                   Befehle, Zustände, Ereignisse
  config.ts                  Aufbau und Prüfung der Konfiguration
  sim.ts                     Regeln, fester 10-ms-Schritt, Ereignisse
  bot.ts                     Bot in drei Stufen
  rng.ts                     Zufall (xorshift32), wiederholbar
  session.ts                 Simulation + Bots im festen Takt
src/render/                  Three.js: Arena, Figuren, Effekte
src/voice/                   Mikrofon, Pegelerkennung, Vosk, Web Speech API
src/ui/                      HUD, Debug-Feld, Start- und Schlussbild
src/game/game.ts             verbindet alles
tests/                       vitest, nur Kampflogik
```

### Kampflogik

`src/combat` importiert nichts ausserhalb seines Ordners. `npm run typecheck`
prüft das hart: Der Ordner wird ein zweites Mal **ohne DOM-Typen** geprüft
(`tsconfig.combat.json`) – ein `window` oder `document` dort bricht den Lauf ab.

* Fester Schritt von 10 ms, alle Zeiten in ganzen Millisekunden.
* Deterministisch: Die Regeln kennen keinen Zufall und keine Uhr. Zufall hat nur
  der Bot, aus `Rng` mit Startwert. Gleicher Startwert, gleiche Eingaben in
  gleichen Schritten → dieselbe Ereignisfolge (Test „Determinismus").
* Zwei Eingänge: `speechStart(kämpfer)` und `command(kämpfer, befehl)`.
* Alles Weitere kommt als Ereignis aus `drainEvents()`: `ActionStarted`, `Hit`,
  `Blocked`, `Parried`, `GuardBroken`, `Evaded`, `Interrupted`, `WeaponBroken`,
  `Exhausted`, `RoundEnd`, `MatchEnd` – dazu für Anzeige und Bot `RoundIntro`,
  `RoundStart`, `CommandBuffered`, `CommandRejected`, `SpeechStarted`,
  `SpeechResolved`, `SpeechPenalty`.

### Für die Portierung nach Unity (C#)

* `FighterData`, `CombatEvent` und die Konfiguration sind flache Datensätze aus
  Zahlen, Zeichenketten und Wahrheitswerten: `interface` → `struct`/`class`, die
  Zeichenketten-Typen → `enum`.
* `CombatEvent` ist absichtlich **ein** Datensatz für alle Ereignisarten. Welche
  Felder eine Art nutzt, steht an der Stelle, an der sie erzeugt wird (`sim.ts`).
* `Rng` rechnet nur mit 32-Bit-Ganzzahlen; die Folge entsteht in C# mit `uint`
  genauso.
* Leben, Ausdauer und Haltbarkeit sind Kommazahlen (25 % von 10 ist 2,5). Die
  Ausdauer wächst in Schritten von 0,12; Vergleiche haben eine kleine Toleranz.

### Figuren durch GLB-Modelle ersetzen

Die Szene kennt eine Figur nur über `FighterVisual`
(`src/render/fighterVisual.ts`): `root`, `update(eingabe, dt)`, drei Ankerpunkte,
`dispose`. `update` bekommt `clip`, `phase`, `progress` (0..1) und `timeMs`.
Für ein Modell eine zweite Fabrik schreiben, die es lädt und je `clip` den
gleichnamigen AnimationClip auf `progress` stellt, und sie in `src/main.ts`
anstelle von `createPrimitiveFighter` übergeben. Clips: `idle`, `strike`, `left`,
`right`, `kick`, `sweep`, `charge`, `block_high`, `block_left`, `block_right`,
`roll`, `stagger`, `stunned`, `paralyzed`, `down`, `ko`, `victory`.

Die Figur schaut in ihrem eigenen Koordinatensystem nach +Z, ihre linke Seite
ist +X. `left` holt auf *ihrer* linken Seite aus.

## Tests

```bash
npm test
```

Nur Kampflogik (`tests/`): perfektes Parieren und zu früher Block, falsche
Blockrichtung, `kick` und `charge` brechen den Block, `roll` gegen `sweep`,
Unterbrechung beim Ausholen, Ablehnung ohne Ausdauer, Schwert zerbricht und
Faustwerte gelten, Strafe für Sprechen ohne Befehl, Best of 3 endet korrekt.
Dazu Befehlspuffer, Scheinangriff, Regeneration, Determinismus und der Bot
(Sprech- und Reaktionszeit, alle Stufen spielen ein Match zu Ende).

Grafik, Oberfläche und Sprache haben keine automatischen Tests.

## Abhängigkeiten

`three`, `vosk-browser` (Laufzeit); `vite`, `vitest`, `typescript`,
`@types/three` (Entwicklung).

`npm audit` meldet zwei Funde mittlerer Stufe: `uuid` unter `vosk-browser`
(GHSA-w5hq-g745-h8pq, betrifft `v3`/`v5`/`v6` mit übergebenem Puffer). Einen
Fix gibt es nicht, `vosk-browser` ist seit Dezember 2022 unverändert. Die
ausgelieferte Datei `vosk.js` enthält `uuid` fest eingebaut und ruft daraus nur
`v4` auf.
