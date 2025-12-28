import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { parseFile, combineContexts } from './fileParser.js';
import { setContext, getContext, deleteContext } from './contextStore.js';

const CONFIG = {
  MAX_TOKENS: 400,
  TEMPERATURE: 0.7,
  MODEL: 'xiaomi/mimo-v2-flash:free',
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max per file
    files: 5 // Max 5 files
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/x-markdown',
      'application/octet-stream' // iOS Chrome sends this for text files
    ];
    const allowedExtensions = ['.md', '.txt', '.pdf'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));

    if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not supported: ${file.originalname}`));
    }
  }
});

// Helper to handle multer errors and return JSON
const handleUpload = (req, res, next) => {
  upload.array('files', 5)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
};

// Upload context files
app.post('/api/context', handleUpload, async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const parsedFiles = await Promise.all(
      req.files.map((file) =>
        parseFile(file.buffer, file.mimetype, file.originalname)
      )
    );

    const combined = combineContexts(parsedFiles);
    const sessionId = uuidv4();

    await setContext(sessionId, combined);

    res.json({
      sessionId,
      files: combined.files,
      estimatedTokens: combined.estimatedTokens
    });
  } catch (error) {
    console.error('Context upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear context
app.delete('/api/context/:sessionId', async (req, res) => {
  await deleteContext(req.params.sessionId);
  res.json({ success: true });
});

app.post('/api/predict', async (req, res) => {
  const { text, sessionId } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
  }

  // Build system prompt with context if available
  let systemPrompt = `Continue the user's thought from where they stopped. Write 1 paragraph that naturally extends their idea, matching their tone and style. Do not repeat their text or add meta commentary. Just provide the seamless continuation.`;

  if (sessionId) {
    const context = await getContext(sessionId);
    if (context) {
      systemPrompt = `You are helping the user write content related to the following reference material:

<reference_context>
${context.text}
</reference_context>

Based on this context, continue the user's thought from where they stopped. Write 1 paragraph that naturally extends their idea, incorporating relevant information from the reference material when appropriate. Match their tone and style. Do not repeat their text or add meta commentary. Just provide the seamless continuation.`;
    }
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': `http://localhost:${PORT}`,
        'X-Title': 'Mindcomplete'
      },
      body: JSON.stringify({
        model: CONFIG.MODEL,
        stream: true,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: text
          }
        ],
        max_tokens: CONFIG.MAX_TOKENS,
        temperature: CONFIG.TEMPERATURE
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenRouter API error:', error);
      return res.status(response.status).json({ error: 'API request failed' });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Stream the response to client
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
      }
    } catch (streamError) {
      // Client disconnected
      console.log('Stream ended (client disconnected)');
    }

    res.end();
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to get prediction' });
  }
});

app.listen(PORT, () => {
  console.log(`Mindcomplete running at http://localhost:${PORT}`);
});
