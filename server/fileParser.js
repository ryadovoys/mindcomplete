import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const MAX_CONTEXT_CHARS = 50000; // ~12,500 tokens (4 chars per token estimate)

export async function parseFile(buffer, mimetype, filename) {
  let text = '';
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));

  // Detect file type by extension first (more reliable on mobile)
  if (ext === '.pdf' || mimetype === 'application/pdf') {
    const data = await pdfParse(buffer);
    text = data.text;
  } else if (
    ext === '.txt' ||
    ext === '.md' ||
    mimetype === 'text/plain' ||
    mimetype === 'text/markdown' ||
    mimetype === 'text/x-markdown' ||
    mimetype === 'application/octet-stream' // iOS sends this for text files
  ) {
    text = buffer.toString('utf-8');
  } else {
    throw new Error(`Unsupported file type: ${mimetype} (${filename})`);
  }

  // Clean whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return {
    filename,
    text,
    charCount: text.length,
    estimatedTokens: Math.ceil(text.length / 4)
  };
}

export function combineContexts(parsedFiles) {
  let combined = parsedFiles
    .map((f) => `--- ${f.filename} ---\n${f.text}`)
    .join('\n\n');

  // Truncate if too long
  if (combined.length > MAX_CONTEXT_CHARS) {
    combined =
      combined.slice(0, MAX_CONTEXT_CHARS) +
      '\n\n[Content truncated due to length]';
  }

  return {
    text: combined,
    charCount: combined.length,
    estimatedTokens: Math.ceil(combined.length / 4),
    files: parsedFiles.map((f) => f.filename)
  };
}
