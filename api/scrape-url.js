// URL Scraping API endpoint
// Uses simple fetch + HTML parsing (no Firecrawl dependency)

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

    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL format
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are supported' });
        }
    } catch (e) {
        return res.status(400).json({ error: 'Invalid URL format' });
    }

    console.log(`[SCRAPE-URL] Scraping: ${url}`);

    try {
        // Fetch the page with a reasonable timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; PurpleValleyBot/1.0)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            },
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            return res.status(400).json({ error: `Failed to fetch URL: ${response.status} ${response.statusText}` });
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
            return res.status(400).json({ error: 'URL does not return HTML content' });
        }

        const html = await response.text();

        // Parse HTML and extract content
        const extracted = extractContent(html, parsedUrl.hostname);

        console.log(`[SCRAPE-URL] Extracted ${extracted.content.length} chars from ${url}`);

        // Generate summary (first 2000 chars of cleaned content)
        const summary = extracted.content.slice(0, 2000);
        const estimatedTokens = Math.ceil(summary.length / 4);

        res.status(200).json({
            title: extracted.title,
            description: extracted.description,
            content: summary,
            estimatedTokens,
            url: url,
        });

    } catch (error) {
        console.error('[SCRAPE-URL] Error:', error.message);

        if (error.name === 'AbortError') {
            return res.status(408).json({ error: 'Request timed out' });
        }

        return res.status(500).json({ error: `Failed to scrape URL: ${error.message}` });
    }
}

/**
 * Extract meaningful content from HTML
 * Simple regex-based approach (no cheerio dependency for serverless)
 */
function extractContent(html, hostname) {
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? decodeHTMLEntities(titleMatch[1].trim()) : hostname;

    // Extract meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
        html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
    const description = descMatch ? decodeHTMLEntities(descMatch[1].trim()) : '';

    // Extract Open Graph description as fallback
    const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
    const ogDescription = ogDescMatch ? decodeHTMLEntities(ogDescMatch[1].trim()) : '';

    // Remove script and style tags
    let content = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');

    // Try to find main content areas
    const mainContent = extractMainContent(content);

    // Remove all HTML tags
    let text = mainContent
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Decode HTML entities
    text = decodeHTMLEntities(text);

    // If extracted text is too short, try broader extraction
    if (text.length < 200) {
        text = content
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        text = decodeHTMLEntities(text);
    }

    return {
        title,
        description: description || ogDescription,
        content: text,
    };
}

/**
 * Try to extract main content from common content containers
 */
function extractMainContent(html) {
    // Priority order of content selectors
    const patterns = [
        /<article[^>]*>([\s\S]*?)<\/article>/gi,
        /<main[^>]*>([\s\S]*?)<\/main>/gi,
        /<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
        /<div[^>]*id=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
        /<div[^>]*class=["'][^"']*article[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
        /<div[^>]*class=["'][^"']*post[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    ];

    for (const pattern of patterns) {
        const matches = [...html.matchAll(pattern)];
        if (matches.length > 0) {
            // Return the largest match (most content)
            const largest = matches.reduce((a, b) =>
                (a[1]?.length || 0) > (b[1]?.length || 0) ? a : b
            );
            if (largest[1] && largest[1].length > 100) {
                return largest[1];
            }
        }
    }

    // Fallback: return body content
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return bodyMatch ? bodyMatch[1] : html;
}

/**
 * Decode common HTML entities
 */
function decodeHTMLEntities(text) {
    const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&#x27;': "'",
        '&#x2F;': '/',
        '&apos;': "'",
        '&ndash;': '–',
        '&mdash;': '—',
        '&hellip;': '…',
        '&copy;': '©',
        '&reg;': '®',
        '&trade;': '™',
    };

    let result = text;
    for (const [entity, char] of Object.entries(entities)) {
        result = result.replace(new RegExp(entity, 'g'), char);
    }

    // Handle numeric entities
    result = result.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
    result = result.replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));

    return result;
}
