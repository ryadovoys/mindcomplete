// Context Anchor API endpoint
// Generates and manages the unified Context Anchor for a session

import { supabase } from './_lib/supabaseClient.js';
import {
    combineContextItems,
    generateClarifications,
    synthesizeContextAnchor as fallbackSynthesis
} from './_lib/contextDigest.js';

const MODELS = [
    'google/gemini-2.0-flash-exp:free',
    'google/gemini-flash-1.5',
    'openai/gpt-4o-mini',
];

export default async function handler(req, res) {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // GET - Retrieve existing anchor(s)
    if (req.method === 'GET') {
        const anchorId = req.query.id;

        try {
            // Get user ID if authenticated
            let userId = null;
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.slice(7);
                const { data: { user } } = await supabase.auth.getUser(token);
                userId = user?.id || null;
            }

            if (anchorId) {
                // Get specific anchor
                const { data, error } = await supabase
                    .from('context_anchors')
                    .select('*')
                    .eq('id', anchorId)
                    .single();

                if (error || !data) {
                    return res.status(404).json({ error: 'Anchor not found' });
                }
                return res.status(200).json(data);
            } else {
                if (!userId) {
                    return res.status(401).json({ error: 'Authentication required to list anchors' });
                }

                const { data, error } = await supabase
                    .from('context_anchors')
                    .select('*')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false });

                if (error) {
                    throw error;
                }

                return res.status(200).json(data || []);
            }
        } catch (error) {
            console.error('[CONTEXT-ANCHOR] GET error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    // POST - Create new anchor or generate clarifications
    if (req.method === 'POST') {
        const { items, rules, writingStyle, preferences, action } = req.body;

        // Generate clarifications only (no anchor creation yet)
        if (action === 'clarify') {
            const combined = combineContextItems(items || []);

            // ... (clarification logic remains same, specialized for structure) ...
            // For now using the lib function, but could be LLM powered too.
            const options = {
                hasImages: (items || []).some(i => i.type === 'image' || i.source === 'image_analysis'),
                hasText: (items || []).some(i => i.type === 'file' || i.type === 'url'),
                urlDomains: (items || [])
                    .filter(i => i.type === 'url' && i.url)
                    .map(i => {
                        try { return new URL(i.url).hostname; } catch { return null; }
                    })
                    .filter(Boolean),
            };

            const clarifications = generateClarifications(combined.digest, options);

            return res.status(200).json({
                clarifications,
                needsClarification: clarifications.length > 0,
                digest: combined.digest,
                estimatedTokens: combined.estimatedTokens,
            });
        }

        // Create the anchor
        try {
            const combined = combineContextItems(items || []);

            // Try LLM Synthesis first
            let anchorText;

            // Check if it's a simple text-only anchor (no files, no images, no URLs)
            const isTextOnly = items.length === 1 && items[0].type === 'instruction';

            if (isTextOnly) {
                anchorText = items[0].content;
            } else {
                try {
                    anchorText = await synthesizeWithLLM(items, combined.digest, { rules, writingStyle, preferences });
                } catch (llmError) {
                    console.warn('[CONTEXT-ANCHOR] LLM Synthesis failed, using fallback:', llmError);
                    anchorText = fallbackSynthesis(combined.digest, preferences || {}, {
                        rules,
                        writingStyle,
                    });
                }
            }


            // Get user ID if authenticated
            let userId = null;
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.slice(7);
                const { data: { user } } = await supabase.auth.getUser(token);
                userId = user?.id || null;
            }

            // Save to database
            const { data, error } = await supabase
                .from('context_anchors')
                .insert({
                    user_id: userId,
                    summary: anchorText,
                    items: items || [],
                    rules: rules || null,
                    writing_style: writingStyle || null,
                    clarifications: preferences || null,
                })
                .select()
                .single();

            if (error) {
                console.error('[CONTEXT-ANCHOR] Insert error:', error);
                return res.status(500).json({ error: 'Failed to save anchor' });
            }

            console.log(`[CONTEXT-ANCHOR] Created anchor: ${data.id}`);

            return res.status(201).json({
                anchorId: data.id,
                summary: anchorText,
                estimatedTokens: combined.estimatedTokens,
                itemCount: combined.itemCount,
            });
        } catch (error) {
            console.error('[CONTEXT-ANCHOR] POST error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    // PUT - Update existing anchor with new preferences
    if (req.method === 'PUT') {
        const { anchorId, preferences, items, rules, writingStyle } = req.body;

        if (!anchorId) {
            return res.status(400).json({ error: 'Anchor ID is required' });
        }

        try {
            // Fetch existing anchor
            const { data: existing, error: fetchError } = await supabase
                .from('context_anchors')
                .select('*')
                .eq('id', anchorId)
                .single();

            if (fetchError || !existing) {
                return res.status(404).json({ error: 'Anchor not found' });
            }

            // Merge items and regenerate anchor
            const mergedItems = items || existing.items || [];
            const combined = combineContextItems(mergedItems);
            const mergedPreferences = { ...(existing.clarifications || {}), ...(preferences || {}) };

            const anchor = synthesizeContextAnchor(combined.digest, mergedPreferences, {
                rules: rules || existing.rules,
                writingStyle: writingStyle || existing.writing_style,
            });

            // Update in database
            const { data, error: updateError } = await supabase
                .from('context_anchors')
                .update({
                    summary: anchor,
                    items: mergedItems,
                    rules: rules || existing.rules,
                    writing_style: writingStyle || existing.writing_style,
                    clarifications: mergedPreferences,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', anchorId)
                .select()
                .single();

            if (updateError) {
                console.error('[CONTEXT-ANCHOR] Update error:', updateError);
                return res.status(500).json({ error: 'Failed to update anchor' });
            }

            return res.status(200).json({
                anchorId: data.id,
                summary: anchor,
                estimatedTokens: combined.estimatedTokens,
                itemCount: combined.itemCount,
            });

        } catch (error) {
            console.error('[CONTEXT-ANCHOR] PUT error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    // DELETE - Remove anchor
    if (req.method === 'DELETE') {
        const anchorId = req.query.id || req.body?.anchorId;

        if (!anchorId) {
            return res.status(400).json({ error: 'Anchor ID is required' });
        }

        try {
            const { error } = await supabase
                .from('context_anchors')
                .delete()
                .eq('id', anchorId);

            if (error) {
                console.error('[CONTEXT-ANCHOR] Delete error:', error);
                return res.status(500).json({ error: 'Failed to delete anchor' });
            }

            return res.status(200).json({ success: true });
        } catch (error) {
            console.error('[CONTEXT-ANCHOR] DELETE error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

async function synthesizeWithLLM(items, fullDigest, options) {
    if (!process.env.OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY not configured');
    }

    // Construct a rich prompt
    const systemPrompt = `You are an expert Content Strategist and AI Instruction Architect.
Your goal is to create a "Context Anchor" - a structured, persistent set of INSTRUCTIONS for another AI to follow.
Your output must be a GUIDE for writing, NOT the writing itself.

CRITICAL INSTRUCTION:
DO NOT WRITE THE REQUESTED CONTENT.
If the user says "Write a blog post", do NOT write the blog post.
Instead, write the RULES that another AI should use to write that blog post.

INPUTS:
1. User's Context Items (images, files, URLs).
2. User's specific Instructions/Intent (what they want to DO with this content).

YOUR TASK:
Analyze the provided items and instructions to create a structured output.
Extract the INTENT and generate Rules/Guidelines for THAT intent.

OUTPUT FORMAT:
[Start directly with the Detailed Context Summary. Do not use a header like "CONTEXT ANCHOR".]
[Detailed summary of the content provided. CRITICAL: If an image is provided, you MUST DESCRIBE IT visually (e.g., "A digital artwork showing a surreal moonlit landscape with purple hues..."). Do NOT reference filenames.]

Writing Rules:
- [Extracted Rule 1. E.g. "Use engaging, social-media friendly tone."]
- [Extracted Rule 2. E.g. "Incorporate specific keywords: #Art, #Design."]
- [Do NOT generate the actual post here. Just rules.]

Focus Points:
- [Point 1. E.g. "Highlight the color contrast in the image based on the user's input."]
- [Point 2. E.g. "Connect the visual to digital creativity themes."]

(Keep the total output under 200 words. Focus on CLARITY and UTILITY for the writer AI).
`;

    const userPrompt = `Here are the items the user provided:
${JSON.stringify(items.map(i => ({ type: i.type, source: i.source, content: i.content, meta: i.meta })), null, 2)}

User Preferences/Style: ${JSON.stringify(options)}

Generate the Context Anchor now. Remember: Do NOT write the content. Write the INSTRUCTIONS for it.`;

    for (const model of MODELS) {
        try {
            console.log(`[CONTEXT-ANCHOR] Synthesizing with model: ${model}`);
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'HTTP-Referer': 'https://purplevalley.co',
                    'X-Title': 'Purple Valley',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.7,
                    max_tokens: 500 // Limit output length
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`OpenRouter error: ${response.status} - ${errText}`);
            }

            const result = await response.json();
            return result.choices[0].message.content.trim();

        } catch (err) {
            console.warn(`[CONTEXT-ANCHOR] Model ${model} failed:`, err.message);
            // Try next model
        }
    }

    throw new Error('All models failed to synthesize anchor');
}
