// MindComplete Editor - Figma Plugin
// Text editor with inline AI suggestions

figma.showUI(__html__, {
    width: 500,
    height: 600,
    title: 'MindComplete Editor',
    themeColors: true
});

// Convert Uint8Array to base64 string
function uint8ArrayToBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    // Use figma's built-in btoa equivalent
    return figma.base64Encode(bytes);
}

// Check if a node has image fills
function hasImageFill(node) {
    if (!('fills' in node)) return false;
    var fills = node.fills;
    if (!fills || fills === figma.mixed) return false;
    for (var i = 0; i < fills.length; i++) {
        if (fills[i].type === 'IMAGE' && fills[i].visible !== false) {
            return true;
        }
    }
    return false;
}

// Collect all text and images from a Section (async)
async function collectSectionContent(section) {
    var texts = [];
    var images = [];
    var nodesToProcess = [];

    function traverse(node) {
        if (node.type === 'TEXT') {
            if (node.characters && node.characters.trim()) {
                texts.push({
                    name: node.name,
                    text: node.characters.trim()
                });
            }
        }

        // Check for nodes with image fills
        if (hasImageFill(node)) {
            console.log('[MindComplete] Found image fill in:', node.name, node.type);
            nodesToProcess.push(node);
        }

        // Also check for RECTANGLE, ELLIPSE, FRAME that might have image fills
        // or any node that can be exported as an image
        if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE' || node.type === 'POLYGON') {
            if (!hasImageFill(node) && node.fills && node.fills !== figma.mixed && node.fills.length > 0) {
                // Has some fill, might be useful as visual context
            }
        }

        if ('children' in node) {
            for (var i = 0; i < node.children.length; i++) {
                traverse(node.children[i]);
            }
        }
    }

    traverse(section);

    console.log('[MindComplete] Found', texts.length, 'texts and', nodesToProcess.length, 'images');

    // Export images as base64 (limit to 5 images to avoid slowness)
    var maxImages = 5;
    for (var i = 0; i < Math.min(nodesToProcess.length, maxImages); i++) {
        try {
            var node = nodesToProcess[i];
            console.log('[MindComplete] Exporting image:', node.name);
            var bytes = await node.exportAsync({
                format: 'PNG',
                constraint: { type: 'SCALE', value: 0.5 }
            });
            var base64 = figma.base64Encode(bytes);
            console.log('[MindComplete] Exported', node.name, '- base64 length:', base64.length);
            images.push({
                name: node.name,
                base64: base64,
                mimeType: 'image/png'
            });
        } catch (e) {
            console.log('[MindComplete] Failed to export image:', node.name, e);
        }
    }

    return { texts: texts, images: images };
}

// Get context from selected Section (async)
async function getContextFromSelection() {
    var selection = figma.currentPage.selection;

    if (selection.length === 0) {
        return { success: false, error: 'No selection' };
    }

    var node = selection[0];

    // If it's a Section, collect all content as context
    if (node.type === 'SECTION') {
        var content = await collectSectionContent(node);
        var contextText = content.texts.map(function (t) {
            return t.text;
        }).join('\n\n');

        return {
            success: true,
            type: 'section',
            name: node.name,
            context: contextText,
            items: content.texts,
            images: content.images
        };
    }

    // If it's a Frame or Group, also collect content
    if (node.type === 'FRAME' || node.type === 'GROUP') {
        var content = await collectSectionContent(node);
        var contextText = content.texts.map(function (t) {
            return t.text;
        }).join('\n\n');

        return {
            success: true,
            type: 'frame',
            name: node.name,
            context: contextText,
            items: content.texts,
            images: content.images
        };
    }

    return {
        success: false,
        error: 'Please select a Section or Frame for context.'
    };
}

// Listen for messages from the UI
figma.ui.onmessage = async function (msg) {

    // Get context from selection
    if (msg.type === 'get-context') {
        var result = await getContextFromSelection();
        figma.ui.postMessage({
            type: 'context-result',
            success: result.success,
            error: result.error,
            contextType: result.type,
            name: result.name,
            context: result.context,
            items: result.items,
            images: result.images || []
        });
    }

    // Insert text into selected TextNode or copy to clipboard
    if (msg.type === 'export-to-canvas') {
        var text = msg.text;
        var selection = figma.currentPage.selection;

        // If a TextNode is selected, append text to it
        if (selection.length > 0 && selection[0].type === 'TEXT') {
            var textNode = selection[0];

            // Load the font used in the text node
            var fontName = textNode.fontName;
            if (fontName === figma.mixed) {
                fontName = { family: "Inter", style: "Regular" };
            }

            figma.loadFontAsync(fontName).then(function () {
                // Append text to existing content
                var existingText = textNode.characters;
                var newText = existingText ? existingText + ' ' + text : text;
                textNode.characters = newText;

                figma.ui.postMessage({ type: 'export-result', success: true, action: 'inserted' });
                figma.notify('✨ Text inserted!', { timeout: 2000 });
            }).catch(function () {
                figma.ui.postMessage({ type: 'export-result', success: false, error: 'Failed to load font' });
            });
        } else {
            // No text selected - tell UI to copy to clipboard
            figma.ui.postMessage({ type: 'export-result', success: true, action: 'clipboard' });
        }
    }

    // Resize
    if (msg.type === 'resize') {
        figma.ui.resize(msg.width, msg.height);
    }

    // Close
    if (msg.type === 'close') {
        figma.closePlugin();
    }
};

// Listen for selection changes
figma.on('selectionchange', async function () {
    var result = await getContextFromSelection();
    figma.ui.postMessage({
        type: 'selection-changed',
        success: result.success,
        error: result.error,
        contextType: result.type,
        name: result.name,
        context: result.context,
        items: result.items,
        images: result.images || []
    });
});
