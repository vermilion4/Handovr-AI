import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../.state.json', import.meta.url);

export function readState(): Record<string, string> {
  return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
}

export function saveState(patch: Record<string, string>): void {
  writeFileSync(FILE, JSON.stringify({ ...readState(), ...patch }, null, 2));
}
