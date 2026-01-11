// Image Analysis API endpoint
// Uses Google Gemini 2.0 Flash (free tier) for vision with fallbacks

const MODELS = [
    'google/gemini-2.0-flash-exp:free',    // Primary free model
    'allenai/molmo-2-8b:free',             // Fallback 1 (Open Source)
    'nvidia/nemotron-nano-12b-v2-vl:free', // Fallback 2 (Open Source)
    'google/gemini-flash-1.5',             // Fallback 3 (Standard Flash)
    'google/gemini-2.0-flash-exp',         // Fallback 4 (Paid/Standard 2.0 if available)
    'openai/gpt-4o-mini',                  // Fallback 5 (OpenAI cheap vision)
];

export default async function handler(req, res) {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { imageData, mimeType, imageUrl, prompt } = req.body;

    if (!imageData && !imageUrl) {
        return res.status(400).json({ error: 'Either imageData (base64) or imageUrl is required' });
    }

    if (!process.env.OPENROUTER_API_KEY) {
        return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
    }

    console.log(`[ANALYZE-IMAGE] Analyzing image...`);

    try {
        const host = req.headers.host || 'purplevalley.co';
        let lastError = null;

        // Try models in sequence until one succeeds
        for (const model of MODELS) {
            try {
                console.log(`[ANALYZE-IMAGE] Trying model: ${model}`);
                const result = await analyzeWithModel(model, { imageData, mimeType, imageUrl, prompt }, host);

                console.log(`[ANALYZE-IMAGE] Success with ${model}: ${result.description.length} chars`);
                return res.status(200).json({
                    ...result,
                    modelUsed: model
                });

            } catch (error) {
                console.warn(`[ANALYZE-IMAGE] Failed with ${model}:`, error.message);
                lastError = error;

                // If it's not a rate limit or server error (e.g. auth error), maybe stop?
                // For now, we continue to try all models as it's safer for reliability
                continue;
            }
        }

        // If all failed
        console.error('[ANALYZE-IMAGE] All models failed. Last error:', lastError);
        return res.status(500).json({
            error: `All vision models failed. Last error: ${lastError?.message || 'Unknown error'}`
        });

    } catch (error) {
        console.error('[ANALYZE-IMAGE] Critical Error:', error.message);
        return res.status(500).json({ error: `Failed to analyze image: ${error.message}` });
    }
}

async function analyzeWithModel(modelId, content, host) {
    // Build the image content for the API
    let imageContent;
    if (content.imageData) {
        // Base64 encoded image
        const detectedMimeType = content.mimeType || detectMimeType(content.imageData);
        imageContent = {
            type: 'image_url',
            image_url: {
                url: `data:${detectedMimeType};base64,${content.imageData}`,
            },
        };
    } else {
        // URL-based image
        imageContent = {
            type: 'image_url',
            image_url: {
                url: content.imageUrl,
            },
        };
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': `https://${host}`,
            'X-Title': 'Purple Valley',
        },
        body: JSON.stringify({
            model: modelId,
            messages: [
                {
                    role: 'user',
                    content: [
                        imageContent,
                        {
                            type: 'text',
                            text: content.prompt || `Analyze this image and provide a concise description for use as writing context. Include:
1. Main subjects/objects in the image
2. Setting/environment
3. Mood/atmosphere
4. Any text visible in the image
5. Key details that might be relevant for creative writing

Keep your response under 300 words and focus on details useful for a writer.`,
                        },
                    ],
                },
            ],
            // Adjust tokens/temp based on model if needed, but defaults are usually fine
            max_tokens: 500,
            temperature: 0.5,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const description = data.choices?.[0]?.message?.content || 'Unable to analyze image';

    // Parse out structured info from the description
    const analysis = {
        description: description.trim(),
        estimatedTokens: Math.ceil(description.length / 4),
    };

    // Try to extract subjects if mentioned
    const subjectsMatch = description.match(/(?:subjects?|main (?:subjects?|elements?))[\s:]+([^.]+)/i);
    if (subjectsMatch) {
        analysis.subjects = subjectsMatch[1].trim();
    }

    // Try to extract mood if mentioned
    const moodMatch = description.match(/(?:mood|atmosphere|tone)[\s:]+([^.]+)/i);
    if (moodMatch) {
        analysis.mood = moodMatch[1].trim();
    }

    return analysis;
}

/**
 * Detect MIME type from base64 data
 */
function detectMimeType(base64Data) {
    // Check for common image signatures in base64
    if (base64Data.startsWith('/9j/')) {
        return 'image/jpeg';
    }
    if (base64Data.startsWith('iVBORw')) {
        return 'image/png';
    }
    if (base64Data.startsWith('R0lGOD')) {
        return 'image/gif';
    }
    if (base64Data.startsWith('UklGR')) {
        return 'image/webp';
    }
    // Default to PNG
    return 'image/png';
}
