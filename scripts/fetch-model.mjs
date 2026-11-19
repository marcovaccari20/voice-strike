// Holt das kleine englische Vosk-Modell nach public/models/.
//
//   npm run modell            laedt das Modell (einmalig, rund 40 MB)
//   npm run dev               ruft dieses Skript vorher mit --leise auf
//
// WARUM NICHT IM REPO: 41 MB Binaerdatei, die sich nie aendert. Sie waere in
// jeder Kopie und in der Historie fuer immer dabei.
//
// WARUM DIESE QUELLEN: vosk-browser erwartet das Modell als .tar.gz. Der
// Hersteller (alphacephei.com) bietet es nur als .zip an; die fertige
// .tar.gz liegt beim Autor von vosk-browser. Die Pruefsumme unten stellt
// sicher, dass genau die Datei ankommt, mit der der Prototyp geprueft wurde -
// egal von welcher der Adressen.
//
// Mit --leise endet das Skript auch bei einem Fehlschlag mit 0: Dann startet
// `npm run dev` trotzdem, und das Spiel weicht auf die Web Speech API oder
// die Tastatur aus.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const DATEI = 'vosk-model-small-en-us-0.15.tar.gz';
const GROESSE = 41184862;
const SHA256_DER_DATEI = 'f0b24bb92a48ca575b6a96500d6b543f0f079c573dfe85bbe16001fc0404e1d8';
const QUELLEN = [
  `https://ccoreilly.github.io/vosk-browser/models/${DATEI}`,
  `https://raw.githubusercontent.com/ccoreilly/vosk-browser/gh-pages/models/${DATEI}`,
];

const leise = process.argv.includes('--leise');
const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..');
const ziel = join(wurzel, 'public', 'models', DATEI);

// Nodes eingebautes fetch beachtet HTTPS_PROXY nur mit NODE_USE_ENV_PROXY=1.
// Hinter einem Proxy deshalb einmal mit dieser Einstellung neu starten.
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxy && process.env.NODE_USE_ENV_PROXY !== '1') {
  const kind = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(kind.status ?? 1);
}

function sha256(pfad) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(pfad)
      .on('data', (teil) => hash.update(teil))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

async function vorhandenUndRichtig() {
  if (!existsSync(ziel)) return false;
  if (statSync(ziel).size !== GROESSE) return false;
  return (await sha256(ziel)) === SHA256_DER_DATEI;
}

async function laden(adresse) {
  const antwort = await fetch(adresse, { redirect: 'follow' });
  if (!antwort.ok || !antwort.body) throw new Error(`HTTP ${antwort.status}`);
  const teil = `${ziel}.teil`;
  await pipeline(Readable.fromWeb(antwort.body), createWriteStream(teil));
  const summe = await sha256(teil);
  if (summe !== SHA256_DER_DATEI) {
    rmSync(teil, { force: true });
    throw new Error('Prüfsumme stimmt nicht');
  }
  renameSync(teil, ziel);
}

async function main() {
  if (await vorhandenUndRichtig()) {
    if (!leise) console.log(`Sprachmodell ist vorhanden: public/models/${DATEI}`);
    return true;
  }
  mkdirSync(dirname(ziel), { recursive: true });
  console.log(`Sprachmodell wird geladen (einmalig, ${(GROESSE / 1e6).toFixed(0)} MB) ...`);
  for (const adresse of QUELLEN) {
    const host = new URL(adresse).host;
    try {
      await laden(adresse);
      console.log(`Sprachmodell geladen von ${host}.`);
      return true;
    } catch (fehler) {
      const ursache = fehler?.cause?.message ? ` (${fehler.cause.message})` : '';
      console.warn(`  ${host}: ${fehler.message}${ursache}`);
    }
  }
  console.warn(
    [
      '',
      'Das Sprachmodell liess sich nicht laden.',
      `Von Hand: eine der Adressen oben herunterladen und als public/models/${DATEI} ablegen.`,
      'Ohne Modell weicht das Spiel auf die Web Speech API des Browsers oder die Tastatur aus.',
      '',
    ].join('\n'),
  );
  return false;
}

const gelungen = await main();
process.exit(gelungen || leise ? 0 : 1);
