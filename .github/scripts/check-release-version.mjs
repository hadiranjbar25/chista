import { readFileSync } from 'node:fs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const version = readJson('package.json').version;
const tauriVersion = readJson('src-tauri/tauri.conf.json').version;
const cargoVersion = readFileSync('src-tauri/Cargo.toml', 'utf8').match(
  /^version\s*=\s*"([^"]+)"/m,
)?.[1];
if (!/^\d+\.\d+\.\d+$/.test(version) || version !== tauriVersion || version !== cargoVersion) {
  throw new Error(
    'Set the same major.minor.patch version in package.json, tauri.conf.json, and Cargo.toml.',
  );
}
if (
  process.env.GITHUB_REF?.startsWith('refs/tags/') &&
  process.env.GITHUB_REF !== `refs/tags/v${version}`
) {
  throw new Error(`The release tag must be v${version}.`);
}
console.log(`Installer version: ${version}`);
