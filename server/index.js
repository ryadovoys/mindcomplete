import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { parseFile, combineContexts } from './fileParser.js';
import { setContext, getContext, deleteContext } from './contextStore.js';
import { createValley, getValleys, getValley, deleteValley } from './valleysStore.js';

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

// Valleys API routes
app.get('/api/valleys', async (req, res) => {
  try {
    const valleys = await getValleys();
    res.json({ valleys });
  } catch (error) {
    console.error('Get valleys error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/valleys', async (req, res) => {
  try {
    const { title, text, rules, contextSessionId } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }
    const valley = await createValley({ title, text, rules, contextSessionId });
    res.json(valley);
  } catch (error) {
    console.error('Create valley error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/valleys/:id', async (req, res) => {
  try {
    const valley = await getValley(req.params.id);
    if (!valley) {
      return res.status(404).json({ error: 'Valley not found' });
    }
    res.json(valley);
  } catch (error) {
    console.error('Get valley error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/valleys/:id', async (req, res) => {
  try {
    await deleteValley(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete valley error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/predict', async (req, res) => {
  const { text, sessionId, rules } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
  }

  // Build system prompt with context if available
  let systemPrompt = `Continue the user's thought from where they stopped. Write 1 paragraph that naturally extends their idea, matching their tone and style. Do not repeat their text or add meta commentary. Just provide the seamless continuation.`;

  // Add rules if provided
  if (rules && rules.trim()) {
    systemPrompt = `Follow these rules when writing:

<rules>
${rules}
</rules>

${systemPrompt}`;
  }

  // Add file context if available
  if (sessionId) {
    const context = await getContext(sessionId);
    if (context) {
      systemPrompt = `You are helping the user write content related to the following reference material:

<reference_context>
${context.text}
</reference_context>

${rules && rules.trim() ? `Also follow these rules when writing:

<rules>
${rules}
</rules>

` : ''}Based on this context, continue the user's thought from where they stopped. Write 1 paragraph that naturally extends their idea, incorporating relevant information from the reference material when appropriate. Match their tone and style. Do not repeat their text or add meta commentary. Just provide the seamless continuation.`;
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

// Image generation config
const IMAGE_CONFIG = {
  PROMPT_MODEL: 'xiaomi/mimo-v2-flash:free',
  IMAGE_MODEL: 'bytedance-seed/seedream-4.5',
  STYLE_SUFFIX: ', in the style of Hayao Miyazaki Studio Ghibli anime, soft watercolor palette, detailed hand-painted backgrounds, whimsical atmosphere, warm lighting',
};

// Generate image prompt from text using LLM
async function generateImagePrompt(text, apiKey, guidance = '') {
  let systemPrompt = `You are an image prompt generator. Analyze the given text and create a short, vivid image prompt (max 80 words) that illustrates the scene, mood, or concept from the text. Focus especially on the last few sentences as they represent the current moment.

Describe visual elements: characters, setting, lighting, colors, atmosphere. Be specific and painterly.

Output ONLY the image prompt, nothing else. No quotes, no explanations.`;

  // Add user guidance if provided
  if (guidance && guidance.trim()) {
    systemPrompt += `\n\nIMPORTANT - Follow this guidance from the user:\n${guidance}`;
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': `http://localhost:${PORT}`,
      'X-Title': 'purple valley'
    },
    body: JSON.stringify({
      model: IMAGE_CONFIG.PROMPT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      max_tokens: 150,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    throw new Error('Failed to generate image prompt');
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// Generate image using OpenRouter (via chat completions endpoint)
async function generateImage(prompt, apiKey) {
  const requestBody = {
    model: IMAGE_CONFIG.IMAGE_MODEL,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  };

  console.log('Image API request:', JSON.stringify(requestBody, null, 2));

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': `http://localhost:${PORT}`,
      'X-Title': 'purple valley'
    },
    body: JSON.stringify(requestBody)
  });

  const responseText = await response.text();
  console.log('Image API response status:', response.status);

  if (!response.ok) {
    throw new Error(`Failed to generate image: ${responseText}`);
  }

  try {
    const data = JSON.parse(responseText);

    // Check for image URL in various possible locations
    let imageUrl = null;

    // Check for images array in message (seedream format)
    const messageImages = data.choices?.[0]?.message?.images;
    if (messageImages && messageImages.length > 0) {
      const firstImage = messageImages[0];
      imageUrl = firstImage.image_url?.url || firstImage.url || firstImage;
      console.log('Found image in message.images');
    }

    // Check message content for URL
    if (!imageUrl) {
      const content = data.choices?.[0]?.message?.content;
      if (content && content.trim()) {
        // Check if it's markdown format ![alt](url)
        const mdMatch = content.match(/!\[.*?\]\((.*?)\)/);
        if (mdMatch) {
          imageUrl = mdMatch[1];
        }
        // Check if it's a plain URL
        const urlMatch = content.match(/(https?:\/\/[^\s\)"']+)/i);
        if (urlMatch && !imageUrl) {
          imageUrl = urlMatch[1];
        }
        // Check if content itself is a data URL
        if (!imageUrl && content.startsWith('data:image')) {
          imageUrl = content;
        }
      }
    }

    // Check for image_url in message
    if (!imageUrl) {
      const messageImageUrl = data.choices?.[0]?.message?.image_url;
      if (messageImageUrl) {
        imageUrl = messageImageUrl.url || messageImageUrl;
      }
    }

    // Check for images array at root
    if (!imageUrl && data.images && data.images.length > 0) {
      imageUrl = data.images[0].url || data.images[0];
    }

    // Check for data array (OpenAI format)
    if (!imageUrl && data.data && data.data.length > 0) {
      imageUrl = data.data[0].url || data.data[0].b64_json;
    }

    console.log('Extracted image URL:', imageUrl ? imageUrl.substring(0, 50) + '...' : null);

    if (!imageUrl) {
      throw new Error('No image URL found in response');
    }

    return { data: [{ url: imageUrl }] };
  } catch (e) {
    console.error('Parse error:', e.message);
    throw new Error(`Failed to parse response: ${e.message}`);
  }
}

app.post('/api/generate-image', async (req, res) => {
  const { text, guidance } = req.body;

  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'Text is required' });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;

  try {
    // Step 1: Generate image prompt from text (with optional guidance)
    console.log('Generating image prompt from text...');
    if (guidance) console.log('With guidance:', guidance);
    const basePrompt = await generateImagePrompt(text, apiKey, guidance);

    if (!basePrompt) {
      return res.status(500).json({ error: 'Failed to generate image prompt' });
    }

    // Step 2: Add Miyazaki style suffix
    const finalPrompt = basePrompt + IMAGE_CONFIG.STYLE_SUFFIX;
    console.log('Final prompt:', finalPrompt);

    // Step 3: Generate image
    console.log('Generating image...');
    const imageResult = await generateImage(finalPrompt, apiKey);

    // Return the image data
    res.json({
      success: true,
      prompt: finalPrompt,
      image: imageResult.data?.[0] || imageResult
    });

  } catch (error) {
    console.error('Image generation error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate image' });
  }
});

app.listen(PORT, () => {
  console.log(`Mindcomplete running at http://localhost:${PORT}`);
});
