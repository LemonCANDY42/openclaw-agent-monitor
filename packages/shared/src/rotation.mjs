import fs from 'fs';

export const DEFAULT_ROTATION = Object.freeze({
  maxBytes: 512 * 1024,
  keep: 3
});

export function rotateFileIfNeeded(file, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_ROTATION.maxBytes;
  const keep = options.keep ?? DEFAULT_ROTATION.keep;
  try {
    if (!fs.existsSync(file)) return { rotated: false, reason: 'missing' };
    const size = fs.statSync(file).size;
    if (size < maxBytes) return { rotated: false, reason: 'below-threshold', size };
    for (let i = keep; i >= 2; i -= 1) {
      const prev = `${file}.${i - 1}`;
      const next = `${file}.${i}`;
      if (fs.existsSync(prev)) fs.renameSync(prev, next);
    }
    fs.renameSync(file, `${file}.1`);
    return { rotated: true, size };
  } catch (error) {
    return { rotated: false, reason: 'error', error: String(error?.message ?? error) };
  }
}

export function rotateFilesIfNeeded(files, options = {}) {
  return files.map((file) => ({ file, ...rotateFileIfNeeded(file, options) }));
}
