// Debug script to identify what's blocking toolbar clicks
// Add this temporarily to debug the click issue

console.log('🔍 Debug script loaded');

// Check all fixed position elements and their z-index
function checkFixedElements() {
    const allElements = document.querySelectorAll('*');
    const fixedElements = [];

    allElements.forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.position === 'fixed') {
            fixedElements.push({
                element: el,
                zIndex: style.zIndex,
                pointerEvents: style.pointerEvents,
                display: style.display,
                id: el.id || el.className
            });
        }
    });

    console.table(fixedElements);
    return fixedElements;
}

// Check what element is at the toolbar position
function checkElementAtToolbarPosition() {
    const toolbar = document.querySelector('.editor-toolbar');
    if (!toolbar) {
        console.log('❌ Toolbar not found');
        return;
    }

    const rect = toolbar.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const elementAtPoint = document.elementFromPoint(centerX, centerY);

    console.log('🎯 Element at toolbar center:', {
        toolbar: toolbar,
        elementAtPoint: elementAtPoint,
        isToolbar: elementAtPoint === toolbar || toolbar.contains(elementAtPoint),
        toolbarZIndex: window.getComputedStyle(toolbar).zIndex,
        elementZIndex: elementAtPoint ? window.getComputedStyle(elementAtPoint).zIndex : 'N/A'
    });

    return elementAtPoint;
}

// Add click listeners to toolbar buttons to see if they fire
function addToolbarDebugListeners() {
    const buttons = document.querySelectorAll('.toolbar-btn');
    console.log(`🔘 Found ${buttons.length} toolbar buttons`);

    buttons.forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
            console.log(`✅ Button ${index + 1} clicked!`, e);
        }, true); // Use capture phase
    });
}

// Check views status
function checkViews() {
    const dashboardView = document.getElementById('dashboard-view');
    const editorView = document.getElementById('editor-view');

    console.log('📱 Views status:', {
        dashboard: {
            display: dashboardView ? window.getComputedStyle(dashboardView).display : 'not found',
            zIndex: dashboardView ? window.getComputedStyle(dashboardView).zIndex : 'N/A'
        },
        editor: {
            display: editorView ? window.getComputedStyle(editorView).display : 'not found',
            zIndex: editorView ? window.getComputedStyle(editorView).zIndex : 'N/A'
        }
    });
}

// Run checks after page load
window.addEventListener('load', () => {
    setTimeout(() => {
        console.log('\n=== TOOLBAR DEBUG INFO ===\n');
        checkViews();
        console.log('\n');
        checkFixedElements();
        console.log('\n');
        checkElementAtToolbarPosition();
        console.log('\n');
        addToolbarDebugListeners();
        console.log('\n=== END DEBUG INFO ===\n');
    }, 1000);
});

// Expose functions globally for manual testing
window.debugToolbar = {
    checkFixedElements,
    checkElementAtToolbarPosition,
    checkViews
};

console.log('💡 Run window.debugToolbar.checkElementAtToolbarPosition() to check what element is blocking');
