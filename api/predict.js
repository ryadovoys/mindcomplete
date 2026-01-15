import { getContext } from './_lib/contextService.js';
import { supabase } from './_lib/supabaseClient.js';

const CONFIG = {
  MAX_TOKENS: 400,
  TEMPERATURE: 0.7,
  MODEL: 'gemini-2.0-flash',
};

// Helper to get Context Anchors from database
async function getContextAnchors(anchorIds) {
  if (!supabase || !anchorIds || !anchorIds.length) return [];

  const { data, error } = await supabase
    .from('context_anchors')
    .select('summary, items, rules, writing_style')
    .in('id', anchorIds);

  if (error || !data) return [];
  return data;
}


export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, sessionId, anchorIds, anchorId, rules, writingStyle } = req.body;

  // Support both array and legacy single ID
  const idsToFetch = anchorIds || (anchorId ? [anchorId] : []);

  console.log(`[PREDICT] Request received. Text length: ${text?.length}, Session: ${sessionId}, Anchors: ${idsToFetch.length}`);

  if (!text) {
    console.error('[PREDICT] Error: No text provided');
    return res.status(400).json({ error: 'Text is required' });
  }

  // Check for API key - prefer Google AI, fallback to OpenRouter
  const useGoogleAI = !!process.env.GOOGLE_AI_API_KEY;
  const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    console.error('[PREDICT] Error: No API key configured');
    return res.status(500).json({ error: 'API key not configured' });
  }

  // Build system prompt with context if available
  let systemPrompt = `Continue the user's thought from where they stopped. Write 1 paragraph that naturally extends their idea, matching their tone and style. Do not repeat their text or add meta commentary. Just provide the seamless continuation.`;

  // Check for Context Anchors (new unified context system)
  if (idsToFetch.length > 0) {
    const anchors = await getContextAnchors(idsToFetch);

    if (anchors && anchors.length > 0) {
      let combinedContext = '';

      anchors.forEach((anchor, index) => {
        combinedContext += `<context_anchor_${index + 1}>\n${anchor.summary}\n`;
        if (anchor.rules) combinedContext += `Rules: ${anchor.rules}\n`;
        if (anchor.writing_style) combinedContext += `Style: ${anchor.writing_style}\n`;
        combinedContext += `</context_anchor_${index + 1}>\n\n`;
      });

      systemPrompt = `You are helping the user write content. Here is your context brief from multiple sources:

${combinedContext}

${rules ? `<global_rules>\n${rules}\n</global_rules>\n\n` : ''}${writingStyle && writingStyle !== 'none' ? `<global_writing_style>\n${writingStyle}\n</global_writing_style>\n\n` : ''}Based on this context, continue the user's thought from where they stopped. Write 1 paragraph that naturally extends their idea, incorporating relevant information from the context when appropriate. Match their tone and style. Do not repeat their text or add meta commentary. Just provide the seamless continuation.`;
    }
  }
  // Fall back to legacy context system if no anchor
  else {
    // Add rules if provided
    if (rules && rules.trim()) {
      systemPrompt = `Follow these rules when writing:

<rules>
${rules}
</rules>

${systemPrompt}`;
    }

    // Add writing style if provided
    if (writingStyle && writingStyle.trim()) {
      systemPrompt = `Follow this writing style:

<writing_style>
${writingStyle}
</writing_style>

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

` : ''}${writingStyle && writingStyle.trim() ? `Also follow this writing style:

<writing_style>
${writingStyle}
</writing_style>

` : ''}Based on this context, continue the user's thought from where they stopped. Write 1 paragraph that naturally extends their idea, incorporating relevant information from the reference material when appropriate. Match their tone and style. Do not repeat their text or add meta commentary. Just provide the seamless continuation.`;
      }
    }
  }

  try {
    let response;

    if (useGoogleAI) {
      // Use Google AI API directly
      console.log(`[PREDICT] Calling Google AI with model: ${CONFIG.MODEL}`);
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: systemPrompt + '\n\n' + text }]
            }
          ],
          generationConfig: {
            maxOutputTokens: CONFIG.MAX_TOKENS,
            temperature: CONFIG.TEMPERATURE
          }
        })
      });
    } else {
      // Fallback to OpenRouter
      console.log(`[PREDICT] Calling OpenRouter with model: xiaomi/mimo-v2-flash:free`);
      const host = req.headers.host || 'purplevalley.co';
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': `https://${host}`,
          'X-Title': 'Purple Valley'
        },
        body: JSON.stringify({
          model: 'xiaomi/mimo-v2-flash:free',
          stream: true,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ],
          max_tokens: CONFIG.MAX_TOKENS,
          temperature: CONFIG.TEMPERATURE
        })
      });
    }

    if (!response.ok) {
      const errorStatus = response.status;
      const errorText = await response.text();
      console.error(`[PREDICT] API error (${errorStatus}):`, errorText);
      return res.status(errorStatus).json({ error: `API request failed: ${errorText}` });
    }

    console.log(`[PREDICT] Stream started (${useGoogleAI ? 'Google AI' : 'OpenRouter'})`);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Stream the response to client
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        if (useGoogleAI) {
          // Convert Google AI SSE format to OpenRouter-compatible format
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                if (text) {
                  // Convert to OpenRouter format for client compatibility
                  const openRouterFormat = {
                    choices: [{ delta: { content: text } }]
                  };
                  res.write(`data: ${JSON.stringify(openRouterFormat)}\n\n`);
                }
              } catch (e) {
                // Skip unparseable lines
              }
            }
          }
        } else {
          // Pass through OpenRouter format as-is
          res.write(chunk);
        }
      }
    } catch (streamError) {
      console.log('[PREDICT] Stream ended or interrupted');
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('[PREDICT] Server error:', error);
    res.status(500).json({ error: `Failed to get prediction: ${error.message}` });
  }
}
