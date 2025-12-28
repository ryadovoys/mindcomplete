import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import pdfParse from 'pdf-parse';

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

// Parse multipart form data manually for Vercel
async function parseMultipartForm(req) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    throw new Error('Expected multipart/form-data');
  }

  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!boundaryMatch) throw new Error('No boundary found');
  const boundary = boundaryMatch[1] || boundaryMatch[2];

  // Read body as buffer
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  const body = buffer.toString('latin1');

  const parts = body.split(`--${boundary}`).slice(1, -1);
  const files = [];

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headers = part.slice(0, headerEnd);
    const content = part.slice(headerEnd + 4, part.lastIndexOf('\r\n'));

    const filenameMatch = headers.match(/filename="([^"]+)"/);
    const contentTypeMatch = headers.match(/Content-Type:\s*(.+)/i);

    if (filenameMatch) {
      const filename = filenameMatch[1];
      const mimeType = contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream';

      // Convert back to buffer using latin1 encoding to preserve binary data
      const fileBuffer = Buffer.from(content, 'latin1');

      files.push({ buffer: fileBuffer, mimeType, filename });
    }
  }

  return files;
}

export const config = {
  api: {
    bodyParser: false, // Disable default body parser for file uploads
  },
};

export default async function handler(req, res) {
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

    if (supabase && sessionId) {
      await supabase.from('contexts').delete().eq('session_id', sessionId);
    }

    return res.status(200).json({ success: true });
  }

  // POST - upload context
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!supabase) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    const files = await parseMultipartForm(req);

    if (files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Validate file types
    const allowedExtensions = ['.md', '.txt', '.pdf'];
    for (const file of files) {
      const ext = file.filename.toLowerCase().slice(file.filename.lastIndexOf('.'));
      if (!allowedExtensions.includes(ext)) {
        return res.status(400).json({ error: `File type not supported: ${file.filename}` });
      }
    }

    const parsedFiles = await Promise.all(
      files.map(file => parseFile(file.buffer, file.mimeType, file.filename))
    );

    const combined = combineContexts(parsedFiles);
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + CONTEXT_TTL_MS).toISOString();

    const { error } = await supabase
      .from('contexts')
      .upsert({
        session_id: sessionId,
        text: combined.text,
        char_count: combined.charCount,
        estimated_tokens: combined.estimatedTokens,
        files: combined.files,
        expires_at: expiresAt
      }, {
        onConflict: 'session_id'
      });

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Failed to save context' });
    }

    res.status(200).json({
      sessionId,
      files: combined.files,
      estimatedTokens: combined.estimatedTokens
    });
  } catch (error) {
    console.error('Context upload error:', error);
    res.status(500).json({ error: error.message });
  }
}
