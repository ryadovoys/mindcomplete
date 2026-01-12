// Context Digest Service
// Shared logic for processing and synthesizing context from multiple sources

/**
 * Generate a unified context digest from multiple input items
 * @param {Array} items - Array of context items (files, URLs, images)
 * @returns {Object} - Combined digest with summary and metadata
 */
export function combineContextItems(items) {
    if (!items || items.length === 0) {
        return {
            digest: '',
            itemCount: 0,
            estimatedTokens: 0,
        };
    }

    let digest = '';
    let totalTokens = 0;

    for (const item of items) {
        let itemDigest = '';

        switch (item.type) {
            case 'file':
                itemDigest = `[FILE: ${item.name}]\n${item.content}\n\n`;
                break;
            case 'url':
                itemDigest = `[WEB: ${item.title || item.url}]\n${item.content}\n\n`;
                break;
            case 'image':
                itemDigest = `[IMAGE: ${item.name || 'Uploaded image'}]\n${item.description}\n\n`;
                break;
            default:
                itemDigest = `[CONTENT]\n${item.content || ''}\n\n`;
        }

        digest += itemDigest;
        totalTokens += item.estimatedTokens || Math.ceil(itemDigest.length / 4);
    }

    return {
        digest: digest.trim(),
        itemCount: items.length,
        estimatedTokens: totalTokens,
    };
}

/**
 * Generate clarification questions based on context ambiguity
 * This analyzes the digest and identifies areas where user input would help
 * @param {string} digest - The combined context digest
 * @param {Object} options - Additional options
 * @returns {Array} - Array of clarification questions
 */
export function generateClarifications(digest, options = {}) {
    const clarifications = [];

    // Check for e-commerce content
    if (detectEcommerceContent(digest)) {
        clarifications.push({
            id: 'ecommerce-focus',
            question: 'I see you\'re referencing a commerce page. What should I prioritize?',
            type: 'choice',
            options: [
                { value: 'pricing', label: 'Pricing and value proposition' },
                { value: 'features', label: 'Product features and benefits' },
                { value: 'reviews', label: 'Customer reviews and social proof' },
                { value: 'comparison', label: 'Competitive comparison' },
            ],
        });
    }

    // Check for mixed content types
    if (options.hasImages && options.hasText) {
        clarifications.push({
            id: 'content-balance',
            question: 'You\'ve added both images and text. How should I balance them?',
            type: 'choice',
            options: [
                { value: 'visual-primary', label: 'Visual descriptions are most important' },
                { value: 'text-primary', label: 'Text content is most important' },
                { value: 'balanced', label: 'Both are equally important' },
            ],
        });
    }

    // Check for multiple URLs from different domains
    if (options.urlDomains && options.urlDomains.length > 1) {
        clarifications.push({
            id: 'source-priority',
            question: 'You\'ve added content from multiple sources. Should any take priority?',
            type: 'choice',
            options: [
                { value: 'equal', label: 'Treat all sources equally' },
                { value: 'first', label: 'Prioritize the first source' },
                { value: 'latest', label: 'Prioritize the most recent source' },
            ],
        });
    }

    // Check for technical content
    if (detectTechnicalContent(digest)) {
        clarifications.push({
            id: 'technical-level',
            question: 'This content seems technical. What\'s the target audience level?',
            type: 'choice',
            options: [
                { value: 'beginner', label: 'Beginner (explain concepts simply)' },
                { value: 'intermediate', label: 'Intermediate (some background assumed)' },
                { value: 'expert', label: 'Expert (technical depth preferred)' },
            ],
        });
    }

    return clarifications;
}

/**
 * Synthesize a Context Anchor (~200 words) from the digest and user preferences
 * @param {string} digest - The combined context digest
 * @param {Object} preferences - User preferences from clarifications
 * @param {Object} options - Additional options (rules, writingStyle)
 * @returns {string} - The synthesized Context Anchor
 */
export function synthesizeContextAnchor(digest, preferences = {}, options = {}) {
    // Build the anchor header
    let anchor = 'CONTEXT ANCHOR:\n\n';

    // Add writing style if specified
    if (options.writingStyle && options.writingStyle !== 'none') {
        anchor += `Style Focus: ${getStyleDescription(options.writingStyle)}\n\n`;
    }

    // Add user preferences from clarifications
    if (Object.keys(preferences).length > 0) {
        anchor += 'User Preferences:\n';
        for (const [key, value] of Object.entries(preferences)) {
            anchor += `- ${formatPreference(key, value)}\n`;
        }
        anchor += '\n';
    }

    // Summarize the digest (first ~1500 chars to fit in ~200 words after formatting)
    const digestSummary = digest.slice(0, 1500);
    anchor += `Context Summary:\n${digestSummary}`;

    // Truncate to ~200 words (~1000 chars) if needed
    if (anchor.length > 1200) {
        anchor = anchor.slice(0, 1197) + '...';
    }

    return anchor;
}

// Helper functions

function detectEcommerceContent(text) {
    const ecommercePatterns = [
        /\$\d+\.?\d*/i,           // Price patterns
        /add to cart/i,
        /buy now/i,
        /checkout/i,
        /shopping/i,
        /product\s+description/i,
        /free shipping/i,
        /in stock/i,
        /out of stock/i,
    ];
    return ecommercePatterns.some(pattern => pattern.test(text));
}

function detectTechnicalContent(text) {
    const technicalPatterns = [
        /api\s+endpoint/i,
        /function\s+\w+\s*\(/i,
        /class\s+\w+/i,
        /algorithm/i,
        /database/i,
        /deployment/i,
        /server/i,
        /frontend|backend/i,
        /npm|yarn|pip/i,
    ];
    const matchCount = technicalPatterns.filter(pattern => pattern.test(text)).length;
    return matchCount >= 2; // At least 2 technical patterns
}

function getStyleDescription(style) {
    const styles = {
        social: 'Short, concise, social media friendly',
        story: 'Narrative, descriptive storytelling',
        ideation: 'Creative, expansive brainstorming',
        custom: 'Custom user-defined style',
    };
    return styles[style] || style;
}

function formatPreference(key, value) {
    const formatters = {
        'ecommerce-focus': (v) => `E-commerce focus: ${v}`,
        'content-balance': (v) => `Content priority: ${v}`,
        'source-priority': (v) => `Source handling: ${v}`,
        'technical-level': (v) => `Audience level: ${v}`,
    };
    return formatters[key] ? formatters[key](value) : `${key}: ${value}`;
}
