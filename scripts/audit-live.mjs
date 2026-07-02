import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(await fs.readFile(path.join(root, 'data', 'live.json'), 'utf8'));
const errors = [];
const warnings = [];

if (data.fixtures?.length !== 104) errors.push(`Expected 104 fixtures, received ${data.fixtures?.length || 0}`);
if (Object.keys(data.teams || {}).length !== 48) errors.push(`Expected 48 teams, received ${Object.keys(data.teams || {}).length}`);

const expectedStages = { 'group-stage':72, 'round-of-32':16, 'round-of-16':8, quarterfinals:4, semifinals:2, '3rd-place-match':1, final:1 };
for (const [stage, expected] of Object.entries(expectedStages)) {
  const actual = data.fixtures.filter(f => f.stageSlug === stage).length;
  if (actual !== expected) errors.push(`${stage}: expected ${expected}, received ${actual}`);
}

for (const [code, team] of Object.entries(data.teams || {})) {
  const recent = team.recent || [];
  if (!recent.length) warnings.push(`${code}: no recent results returned`);
  if (recent.length < 10) warnings.push(`${code}: only ${recent.length}/10 recent results returned`);
  if ((team.players || []).length < 26) warnings.push(`${code}: only ${team.players?.length || 0}/26 players returned`);
  for (const [index, match] of recent.entries()) {
    const score = String(match.score).match(/^(\d+)-(\d+)$/);
    if (!score) { errors.push(`${code} recent #${index + 1}: invalid score ${match.score}`); continue; }
    const home = Number(score[1]), away = Number(score[2]);
    const expected = home > away ? 'W' : home === away ? 'D' : 'L';
    if (match.result !== expected) errors.push(`${code} recent #${index + 1}: ${match.score} cannot be ${match.result}`);
  }
}

console.log(`Audit: ${data.fixtures.length} fixtures, ${Object.keys(data.teams).length} teams, ${Object.values(data.teams).reduce((n, t) => n + (t.recent?.length || 0), 0)} recent results`);
for (const warning of warnings) console.warn(`WARNING ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR ${error}`);
  process.exit(1);
}
