// A complete token-radar-01 entry for make.fun (Node 22, standard library only).
//
// The program reads the sealed snapshot from --input <file|dir> or ../token-radar-01-kit/input/snapshot.json,
// scores every pre-token protocol with the model in lib/model.ts, writes the ranked board
// to out/board.json, and generates a polished static dashboard under out/dashboard/.
// It renders 3 screenshots (board overview, protocol detail, filtered view) and writes
// out/dossier.json using the vendored make.fun library.
//
// Run locally:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boardIssue,
  buildRadar,
  dataScript,
  parseSnapshot,
  MODEL as DEFAULT_MODEL,
  MODEL_VERSION,
  EARLY_ROWS,
  LIVE_ROWS,
} from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** Parse model constants from --model key=value,key=value,... */
function parseModelOverrides(overrides: string): Partial<typeof DEFAULT_MODEL> {
  const result: Partial<typeof DEFAULT_MODEL> = {};
  for (const pair of overrides.split(',')) {
    const [key, value] = pair.split('=');
    if (key && value) {
      const num = Number(value);
      if (Number.isFinite(num)) {
        (result as Record<string, number>)[key] = num;
      }
    }
  }
  return result;
}

function main(): void {
  // Input: --input <snapshot.json|directory>, default ../token-radar-01-kit/input/snapshot.json
  const inputArg = arg('input', '../token-radar-01-kit/input/snapshot.json');
  const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputFile)) {
    process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory>\n`);
    process.exit(2);
  }

  // Output: --output <dir> or MAKEFUN_OUTPUT_DIR env, default ./out
  const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? 'out');

  // Model constants with CLI overrides merged in (exposed for dashboard sandbox)
  const modelOverrides = parseModelOverrides(arg('model', ''));
  const model: typeof DEFAULT_MODEL = {
    ...DEFAULT_MODEL,
    ...modelOverrides,
  };

  // Parse snapshot
  const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));

  // Build board and radar data using the improved model
  const { board, radar } = buildRadar(snapshot, model);

  // Validate board against gate rules before writing
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
    process.exit(1);
  }

  // Verify board has 200+ rows (40 watchlist + 160 early by TVL)
  if (board.length < 200) {
    process.stderr.write(`token radar: board has only ${board.length} rows, expected ≥200 (40 watchlist + 160 early)\n`);
    process.exit(1);
  }

  // Create output directory
  mkdirSync(out, { recursive: true });

  // Write board.json
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);

  // Write data.js for dashboard
  writeFileSync(join(out, 'data.js'), dataScript(radar));

  // Write model-constants.json for dashboard sandbox
  writeFileSync(
    join(out, 'model-constants.json'),
    `${JSON.stringify({ model, model_version: MODEL_VERSION, early_rows: EARLY_ROWS, live_rows: LIVE_ROWS }, null, 2)}\n`
  );

  /** Copy one directory's regular files into `to`, skipping names that start with a dot. */
  function copyFiles(from: string, to: string): string[] {
    if (!existsSync(from)) return [];
    mkdirSync(to, { recursive: true });
    const copied: string[] = [];
    for (const name of readdirSync(from)) {
      if (name.startsWith('.')) continue;
      const path = join(from, name);
      if (!statSync(path).isFile()) continue;
      copyFileSync(path, join(to, name));
      copied.push(name);
    }
    return copied;
  }

  // Copy dashboard files
  copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));

  // Copy screenshots (require exactly 3 images: board overview, detail, filtered view)
  const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
  if (shots.length < 3) {
    process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3 (board overview, protocol detail, filtered view)\n`);
    process.exit(1);
  }
  for (const name of shots) {
    if (!IMAGE_NAME.test(name)) {
      process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
      process.exit(1);
    }
  }

  // Write dossier.json (scorer rebuilds it from this output and compares bytes)
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, {
      text_max_bytes: TEXT_MAX_BYTES,
      screenshots: SCREENSHOT_CAPS,
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    })
  );

  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'model-constants.json')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`
  );
}

main();