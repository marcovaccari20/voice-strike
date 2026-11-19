import { defineConfig } from 'vitest/config';

// Das Mikrofon gibt der Browser nur auf localhost oder ueber https frei -
// deshalb bindet der Entwicklungsserver ausdruecklich an localhost.
export default defineConfig({
  server: { host: 'localhost', port: 5173 },
  preview: { host: 'localhost', port: 4173 },
  build: {
    target: 'es2022',
    // vosk-browser bringt Worker und WebAssembly als eine 5,8-MB-Datei mit.
    chunkSizeWarningLimit: 7000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
