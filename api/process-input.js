// Unified Input Processing API
// Handles Image Analysis (Gemini) and URL Scraping
// Consolidates previous api/analyze-image.js and api/scrape-url.js

const OPENROUTER_MODELS = [
    'google/gemini-2.0-flash-exp:free',    // Primary free model
    'allenai/molmo-2-8b:free',             // Fallback 1 (Open Source)
    'nvidia/nemotron-nano-12b-v2-vl:free', // Fallback 2 (Open Source)
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

    const { type } = req.body;

    // --- ROUTE: Image Analysis ---
    if (type === 'image') {
        return handleImageAnalysis(req, res);
    }

    // --- ROUTE: URL Scraping ---
    if (type === 'url') {
        return handleUrlScraping(req, res);
    }

    return res.status(400).json({ error: 'Invalid or missing "type". Must be "image" or "url".' });
}

/* ==========================================================================
   IMAGE ANALYSIS LOGIC
   ========================================================================== */
async function handleImageAnalysis(req, res) {
    const { imageData, mimeType, imageUrl, prompt } = req.body;

    if (!imageData && !imageUrl) {
        return res.status(400).json({ error: 'Either imageData (base64) or imageUrl is required' });
    }

    // Check for API key - prefer Google AI, fallback to OpenRouter
    const useGoogleAI = !!process.env.GOOGLE_AI_API_KEY;
    const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'No API key configured' });
    }

    console.log(`[PROCESS] Analyzing image with ${useGoogleAI ? 'Google AI' : 'OpenRouter'}...`);

    if (useGoogleAI) {
        // Use Google AI directly
        try {
            const result = await analyzeWithGoogleAI(apiKey, { imageData, mimeType, imageUrl, prompt });
            console.log(`[PROCESS] Success with Google AI: ${result.description.length} chars`);
            return res.status(200).json({
                ...result,
                modelUsed: 'gemini-2.0-flash'
            });
        } catch (error) {
            console.error('[PROCESS] Google AI failed:', error.message);
            return res.status(500).json({ error: `Image analysis failed: ${error.message}` });
        }
    }

    // Fallback to OpenRouter with model chain
    const host = req.headers.host || 'purplevalley.co';
    let lastError = null;

    for (const model of OPENROUTER_MODELS) {
        try {
            console.log(`[PROCESS] Trying model: ${model}`);
            const result = await analyzeWithOpenRouter(model, { imageData, mimeType, imageUrl, prompt }, host, apiKey);
            console.log(`[PROCESS] Success with ${model}: ${result.description.length} chars`);
            return res.status(200).json({
                ...result,
                modelUsed: model
            });
        } catch (error) {
            console.warn(`[PROCESS] Failed with ${model}:`, error.message);
            lastError = error;
            continue;
        }
    }

    console.error('[PROCESS] All vision models failed. Last error:', lastError);
    return res.status(500).json({
        error: `All vision models failed. Last error: ${lastError?.message || 'Unknown error'}`
    });
}

async function analyzeWithGoogleAI(apiKey, content) {
    const detectedMimeType = content.mimeType || detectMimeType(content.imageData);

    const parts = [
        { text: content.prompt || 'Analyze this image and describe it briefly.' }
    ];

    if (content.imageData) {
        parts.push({
            inlineData: {
                mimeType: detectedMimeType,
                data: content.imageData
            }
        });
    } else if (content.imageUrl) {
        // For URL, we need to fetch and convert to base64
        const imgResponse = await fetch(content.imageUrl);
        const buffer = await imgResponse.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        parts.push({
            inlineData: {
                mimeType: imgResponse.headers.get('content-type') || 'image/jpeg',
                data: base64
            }
        });
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
                maxOutputTokens: 500,
                temperature: 0.5
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const description = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Unable to analyze image';

    return {
        description: description.trim(),
        estimatedTokens: Math.ceil(description.length / 4)
    };
}

async function analyzeWithOpenRouter(modelId, content, host, apiKey) {
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
            'Authorization': `Bearer ${apiKey}`,
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
                            text: content.prompt || `Analyze this image...`,
                        },
                    ],
                },
            ],
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

    const analysis = {
        description: description.trim(),
        estimatedTokens: Math.ceil(description.length / 4),
    };

    return analysis;
}

function detectMimeType(base64Data) {
    if (base64Data.startsWith('/9j/')) return 'image/jpeg';
    if (base64Data.startsWith('iVBORw')) return 'image/png';
    if (base64Data.startsWith('R0lGOD')) return 'image/gif';
    if (base64Data.startsWith('UklGR')) return 'image/webp';
    return 'image/png';
}


/* ==========================================================================
   URL SCRAPING LOGIC
   ========================================================================== */
async function handleUrlScraping(req, res) {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are supported' });
        }
    } catch (e) {
        return res.status(400).json({ error: 'Invalid URL format' });
    }

    console.log(`[PROCESS] Scraping: ${url}`);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; PurpleValleyBot/1.0)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            return res.status(400).json({ error: `Failed to fetch URL: ${response.status} ${response.statusText}` });
        }

        const html = await response.text();
        const extracted = extractContent(html, parsedUrl.hostname);

        console.log(`[PROCESS] Extracted ${extracted.content.length} chars from ${url}`);

        const summary = extracted.content.slice(0, 2000);
        const estimatedTokens = Math.ceil(summary.length / 4);

        return res.status(200).json({
            title: extracted.title,
            description: extracted.description,
            content: summary,
            estimatedTokens,
            url: url,
        });

    } catch (error) {
        console.error('[PROCESS] Scrub error:', error.message);
        if (error.name === 'AbortError') return res.status(408).json({ error: 'Request timed out' });
        return res.status(500).json({ error: `Failed to scrape URL: ${error.message}` });
    }
}

function extractContent(html, hostname) {
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? decodeHTMLEntities(titleMatch[1].trim()) : hostname;

    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
        html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
    const description = descMatch ? decodeHTMLEntities(descMatch[1].trim()) : '';

    // Clean HTML
    let content = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');

    // Extract main content
    const mainContent = extractMainContent(content);

    // Remove tags
    let text = mainContent
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    text = decodeHTMLEntities(text);

    if (text.length < 200) {
        text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    return {
        title,
        description,
        content: text,
    };
}

function extractMainContent(html) {
    const patterns = [
        /<article[^>]*>([\s\S]*?)<\/article>/gi,
        /<main[^>]*>([\s\S]*?)<\/main>/gi,
        /<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    ];

    for (const pattern of patterns) {
        const matches = [...html.matchAll(pattern)];
        if (matches.length > 0) {
            const largest = matches.reduce((a, b) => (a[1]?.length || 0) > (b[1]?.length || 0) ? a : b);
            if (largest[1] && largest[1].length > 100) return largest[1];
        }
    }
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return bodyMatch ? bodyMatch[1] : html;
}

function decodeHTMLEntities(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
}
