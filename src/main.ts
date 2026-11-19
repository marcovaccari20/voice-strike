// Einstieg: Konfiguration laden, pruefen, Spiel starten.

import './ui/styles.css';
import { parseConfig } from './combat';
import { Game } from './game/game';
import { knightFactory } from './render/knight/knightFighter';
import { buildKnightMesh } from './render/knight/mesh';

function showFatal(host: HTMLElement, message: string): void {
  const box = document.createElement('div');
  box.className = 'overlay';
  const panel = document.createElement('div');
  panel.className = 'panel start';
  const title = document.createElement('h1');
  title.textContent = 'Voice Arena startet nicht';
  const text = document.createElement('p');
  text.textContent = message;
  panel.append(title, text);
  box.appendChild(panel);
  host.appendChild(box);
}

async function boot(): Promise<void> {
  const host = document.getElementById('app');
  const sceneHost = document.getElementById('scene');
  if (!host || !sceneHost) throw new Error('index.html: #app oder #scene fehlt.');

  try {
    // Ohne Zwischenspeicher: Wer Werte aendert, sieht sie nach dem Neuladen.
    const response = await fetch('combat_config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`combat_config.json nicht gefunden (HTTP ${response.status}).`);
    const config = parseConfig(await response.json());
    // Hier wird die Figur gewaehlt: der Ritter mit seinem Netz. Fuer ein
    // fertiges GLB-Modell eine andere Fabrik uebergeben (src/render/fighterVisual.ts).
    const game = new Game(host, sceneHost, config, knightFactory(buildKnightMesh));
    // Nur im Entwicklungsserver: Zugriff aus der Browser-Konsole zum Ausprobieren.
    if (import.meta.env.DEV) (window as unknown as { voiceArena?: Game }).voiceArena = game;
  } catch (error) {
    showFatal(host, error instanceof Error ? error.message : String(error));
  }
}

void boot();
