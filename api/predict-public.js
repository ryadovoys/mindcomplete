const CONFIG = {
  TEMPERATURE: 0.7,
  MODEL: 'gemini-2.5-flash',
};

function lengthSettings(rawLength) {
  const n = Math.max(0, Math.min(100, Number(rawLength) || 0));
  if (n < 33) {
    return { maxTokens: 120, instruction: 'Write a short continuation, 1-2 sentences max.' };
  }
  if (n < 66) {
    return { maxTokens: 320, instruction: 'Write a continuation of about one paragraph.' };
  }
  return { maxTokens: 700, instruction: 'Write a longer continuation, up to two short paragraphs.' };
}

function buildSystemInstruction(instruction, contextBlock) {
  return `You are a writing autocomplete. Your only job is to continue the user's text from the exact point where it ends.

ABSOLUTE RULES:
- The user's existing text is wrapped in <user_text>...</user_text>. You MUST NOT output any part of what is inside <user_text>. Do not echo, paraphrase, or restart it. Do not include the tags.
- Your output begins with the very next character (often a space) that would naturally follow the last character inside <user_text>. If the last character is a letter, start with a space.
- ${instruction}
- Match the user's tone, register, and vocabulary.
- Do not address the user. Do not narrate. No "Sure", no "Here is", no quotes, no markdown.
${contextBlock}
EXAMPLE
Input: <user_text>The morning was cold and</user_text>
Output: quiet, with frost climbing the inside of the window.

EXAMPLE
Input: <user_text>I built this because most AI tools feel like</user_text>
Output: a separate room you have to walk into, ask, and leave. I wanted something that lives inside the writing itself.`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, context, length } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Text is required' });
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const { maxTokens, instruction } = lengthSettings(length);

  let contextBlock = '';
  if (context && typeof context === 'string' && context.trim()) {
    contextBlock = `
REFERENCE MATERIAL (background only, never quote verbatim):
<reference>
${context.slice(0, 20000)}
</reference>
`;
  }

  const systemInstruction = buildSystemInstruction(instruction, contextBlock);
  const userMessage = `<user_text>${text}</user_text>`;

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { role: 'system', parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: CONFIG.TEMPERATURE,
            stopSequences: ['<user_text>', '</user_text>'],
            thinkingConfig: { thinkingBudget: 0 },
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
