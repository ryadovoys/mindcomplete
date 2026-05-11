const CONFIG = {
  MAX_TOKENS: 200,
  TEMPERATURE: 0.7,
  MODEL: 'gemini-2.0-flash',
};

const BASE_PROMPT = `You are a seamless text continuation assistant. Your ONLY job is to continue the user's text from exactly where they stopped.

CRITICAL RULES:
- NEVER repeat, rephrase, or echo any part of the user's text
- Start your response with the NEXT word that naturally follows their last word
- Write a short continuation, 1-2 sentences max, that flows directly from their ending
- Match their tone, style, and vocabulary
- No greetings, no commentary, no explanations

The user's text ends and your continuation begins immediately.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, context } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Text is required' });
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  let systemPrompt = BASE_PROMPT;
  if (context && typeof context === 'string' && context.trim()) {
    systemPrompt = `You are helping the user write content related to the following reference material:

<reference_context>
${context.slice(0, 20000)}
</reference_context>

Based on this context, continue the user's thought from where they stopped. Write a short continuation, 1-2 sentences max, that naturally extends their idea. Match their tone and style. Do not repeat their text or add meta commentary.`;
  }

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + text }] }],
          generationConfig: {
            maxOutputTokens: CONFIG.MAX_TOKENS,
            temperature: CONFIG.TEMPERATURE,
          },
        }),
      }
    );

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({ error: `Upstream error: ${errText}` });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          const piece = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (piece) {
            res.write(`data: ${JSON.stringify({ content: piece })}\n\n`);
          }
        } catch {
          // skip
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('[PREDICT-PUBLIC]', error);
    res.status(500).json({ error: `Failed to get prediction: ${error.message}` });
  }
}
