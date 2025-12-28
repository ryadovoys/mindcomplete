import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import pdfParse from 'pdf-parse';
import Busboy from 'busboy';

const CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TOTAL_CHARS = 50000;

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// Parse file based on type
async function parseFile(buffer, mimeType, filename) {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));

  // Determine type from extension first (more reliable than MIME on mobile)
  let text = '';

  if (ext === '.pdf' || mimeType === 'application/pdf') {
    try {
      const data = await pdfParse(buffer);
      text = data.text;
    } catch (err) {
      throw new Error(`Failed to parse PDF: ${err.message}`);
    }
  } else if (ext === '.txt' || ext === '.md' ||
             mimeType === 'text/plain' ||
             mimeType === 'text/markdown' ||
             mimeType === 'application/octet-stream') {
    text = buffer.toString('utf-8');
  } else {
    throw new Error(`Unsupported file type: ${filename}`);
  }

  return {
    filename,
    text: text.trim(),
    charCount: text.length
  };
}

// Combine multiple files into single context
function combineContexts(parsedFiles) {
  let combinedText = '';
  const files = [];

  for (const file of parsedFiles) {
    if (combinedText.length + file.text.length > MAX_TOTAL_CHARS) {
      const remaining = MAX_TOTAL_CHARS - combinedText.length;
      if (remaining > 0) {
        combinedText += file.text.slice(0, remaining);
        files.push({ name: file.filename, chars: remaining, truncated: true });
      }
      break;
    }
    combinedText += file.text + '\n\n';
    files.push({ name: file.filename, chars: file.charCount, truncated: false });
  }

  return {
    text: combinedText.trim(),
    charCount: combinedText.length,
    estimatedTokens: Math.ceil(combinedText.length / 4),
    files
  };
}

// Parse multipart form data using busboy (reliable for Vercel serverless)
async function parseMultipartForm(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return reject(new Error('Expected multipart/form-data'));
    }

    const busboy = Busboy({ headers: req.headers });
    const files = [];

    busboy.on('file', (fieldname, file, info) => {
      const { filename, mimeType } = info;
      const chunks = [];

      file.on('data', (chunk) => chunks.push(chunk));
      file.on('end', () => {
        files.push({
          buffer: Buffer.concat(chunks),
          mimeType: mimeType || 'application/octet-stream',
          filename
        });
      });
    });

    busboy.on('finish', () => resolve(files));
    busboy.on('error', (err) => reject(err));

    req.pipe(busboy);
  });
}

export const config = {
  api: {
    bodyParser: false, // Disable default body parser for file uploads
  },
};

export default async function handler(req, res) {
  console.log('[context] Handler called:', req.method, req.url);
  console.log('[context] Content-Type:', req.headers['content-type']);
  console.log('[context] Supabase configured:', !!supabase);

  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // DELETE - clear context
  if (req.method === 'DELETE') {
    const sessionId = req.url.split('/').pop();
    console.log('[context] DELETE sessionId:', sessionId);

    if (supabase && sessionId) {
      await supabase.from('contexts').delete().eq('session_id', sessionId);
    }

    return res.status(200).json({ success: true });
  }

  // POST - upload context
  if (req.method !== 'POST') {
    console.log('[context] Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!supabase) {
    console.log('[context] ERROR: Supabase not configured');
    console.log('[context] SUPABASE_URL exists:', !!process.env.SUPABASE_URL);
    console.log('[context] SUPABASE_SERVICE_KEY exists:', !!process.env.SUPABASE_SERVICE_KEY);
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    console.log('[context] Parsing multipart form...');
    const files = await parseMultipartForm(req);
    console.log('[context] Files parsed:', files.length);

    if (files.length === 0) {
      console.log('[context] ERROR: No files in request');
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Log file details
    files.forEach((f, i) => {
      console.log(`[context] File ${i}: ${f.filename}, ${f.mimeType}, ${f.buffer.length} bytes`);
    });

    // Validate file types
    const allowedExtensions = ['.md', '.txt', '.pdf'];
    for (const file of files) {
      const ext = file.filename.toLowerCase().slice(file.filename.lastIndexOf('.'));
      if (!allowedExtensions.includes(ext)) {
        console.log('[context] ERROR: Unsupported file type:', ext);
        return res.status(400).json({ error: `File type not supported: ${file.filename}` });
      }
    }

    console.log('[context] Parsing file contents...');
    const parsedFiles = await Promise.all(
      files.map(file => parseFile(file.buffer, file.mimeType, file.filename))
    );
    console.log('[context] Files parsed successfully');

    const combined = combineContexts(parsedFiles);
    console.log('[context] Combined:', combined.charCount, 'chars,', combined.estimatedTokens, 'tokens');

    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + CONTEXT_TTL_MS).toISOString();

    console.log('[context] Saving to Supabase, sessionId:', sessionId);
    const { error } = await supabase
      .from('contexts')
      .upsert({
        session_id: sessionId,
        text: combined.text,
        char_count: combined.charCount,
        estimated_tokens: combined.estimatedTokens,
        files: combined.files,
        expires_at: expiresAt,
        user_id: null  // Explicit null for RLS policy
      }, {
        onConflict: 'session_id'
      });

    if (error) {
      console.error('[context] Supabase error:', JSON.stringify(error));
      return res.status(500).json({ error: 'Failed to save context' });
    }

    console.log('[context] SUCCESS - returning sessionId:', sessionId);
    res.status(200).json({
      sessionId,
      files: combined.files,
      estimatedTokens: combined.estimatedTokens
    });
  } catch (error) {
    console.error('[context] CATCH error:', error.message);
    console.error('[context] Stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
}
