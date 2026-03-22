#!/usr/bin/env node
import { rotateFilesIfNeeded } from './rotation.mjs';

function parseArgs(argv) {
  const files = [];
  let maxBytes;
  let keep;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file') {
      if (argv[i + 1]) files.push(argv[++i]);
      continue;
    }
    if (arg.startsWith('--file=')) {
      files.push(arg.slice('--file='.length));
      continue;
    }
    if (arg === '--max-bytes') {
      maxBytes = Number(argv[++i]);
      continue;
    }
    if (arg.startsWith('--max-bytes=')) {
      maxBytes = Number(arg.slice('--max-bytes='.length));
      continue;
    }
    if (arg === '--keep') {
      keep = Number(argv[++i]);
      continue;
    }
    if (arg.startsWith('--keep=')) {
      keep = Number(arg.slice('--keep='.length));
      continue;
    }
  }
  return { files, options: { ...(Number.isFinite(maxBytes) ? { maxBytes } : {}), ...(Number.isFinite(keep) ? { keep } : {}) } };
}

const { files, options } = parseArgs(process.argv.slice(2));
if (files.length === 0) process.exit(0);
rotateFilesIfNeeded(files, options);
