# Plan: Match App to Figma Design - Storyflo Rebrand

## Overview
Update the app to match Figma designs exactly, including rebranding to "Storyflo" and matching all styling variables.

## Figma References
- Desktop: `119:102` - Main screen with new header layout
- Mobile: `128:302` - Mobile version
- Context Modal: `135:472` - Manage context popup

---

## Key Changes from Figma Analysis

### 1. Branding
- Change from "Writecomplete" to "Storyflo"

### 2. Header Layout (NEW)
**Desktop:**
- Height: 100px
- Padding: 40px horizontal
- Left: Hamburger menu icon (24px) in 48px container + "Storyflo" text (28px)
- Right: Settings/app_registration icon in 48px container
- Icon containers: 48px size, 16px border-radius, surface background

**Mobile:**
- Same layout, adapted spacing

### 3. Typography Fixes
| Token | Current | Figma | Action |
|-------|---------|-------|--------|
| H1 weight | 500 | 400 | Fix |
| Ghost text | rgba(255,255,255,0.4) | #8a8a8a | Fix |

### 4. Context Modal Button Colors
| Button | Current | Figma | Action |
|--------|---------|-------|--------|
| Save rules | Blue | WHITE (with dark text) | Fix |
| Clear rules | Gray | Gray | OK |
| Upload files | Blue | Blue | OK |
| Remove files | Gray | Gray | OK |

### 5. Placeholder Text
- Current: "Enter your rules or context here..."
- Figma: "Write or paste your rules..."

---

## Files to Modify

| File | Changes |
|------|---------|
| `/public/index.html` | Update header structure, change branding, update placeholder |
| `/public/styles.css` | Fix typography, add header styles, add btn-white class |
| `/public/app.js` | Update menu toggle logic for new header |

---

## Step 1: Update HTML Header (`index.html`)

Replace current header with new layout:

```html
<header class="header">
  <div class="header-left">
    <button class="icon-btn" id="menu-btn" aria-label="Menu">
      <span class="material-symbols-outlined">dehaze</span>
    </button>
    <div class="logo">Storyflo</div>
  </div>
  <div class="header-right">
    <button class="icon-btn" id="settings-btn" aria-label="Settings">
      <span class="material-symbols-outlined">app_registration</span>
    </button>
  </div>
</header>
```

### Update Context Modal Placeholder
```html
<textarea id="context-textarea" placeholder="Write or paste your rules..."></textarea>
```

### Update Save Rules Button
```html
<button class="btn-white" id="save-rules-btn">Save rules</button>
```

---

## Step 2: Update CSS Variables (`styles.css`)

### Fix Typography
```css
/* Change H1 weight from 500 to 400 */
--font-h1-weight: 400;

/* Add ghost text color */
--ghost-text-color: #8a8a8a;
```

### Add Icon Button Style
```css
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  background: var(--figma-surface);
  border: none;
  border-radius: 16px;
  cursor: pointer;
  transition: background 0.2s;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.icon-btn .material-symbols-outlined {
  font-size: var(--icon-size-sm);
  color: var(--text-color);
}
```

### Add White Button Style
```css
.btn-white {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 12px 20px;
  height: 48px;
  font-size: var(--font-body-small-size);
  font-weight: var(--font-body-small-weight);
  font-family: inherit;
  color: #171719; /* Dark text */
  background: #FFFFFF;
  border: none;
  border-radius: 16px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-white:hover {
  opacity: 0.9;
}
```

### Update Header Styles
```css
.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 100px;
  padding: 0 40px;
  z-index: 100;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 20px;
}

.header-right {
  display: flex;
  align-items: center;
}

.logo {
  font-size: var(--font-h1-size);
  font-weight: var(--font-h1-weight);
  color: var(--text-color);
}
```

### Update Ghost Text Color
```css
/* Update prediction/ghost text color */
.inline-prediction {
  color: var(--ghost-text-color);
}
```

---

## Step 3: Update JavaScript (`app.js`)

### Remove FAB Burger Button
- Remove the floating action button (burger-btn) from bottom-right
- Connect menu-btn in header to show context menu or drawer

### Update Menu Logic
- Menu should appear when clicking the hamburger icon in header
- Keep existing menu items (Manage context, Select text, Share, Clear)

---

## Step 4: Mobile Styles

```css
@media (max-width: 768px) {
  .header {
    height: 80px;
    padding: 0 20px;
  }

  .header-left {
    gap: 12px;
  }

  .logo {
    font-size: 22px;
  }
}
```

---

## Summary of Changes

1. **Branding**: Writecomplete → Storyflo
2. **Header**: New layout with hamburger left, logo, settings right
3. **H1 weight**: 500 → 400
4. **Ghost text**: rgba → #8a8a8a
5. **Save rules button**: Blue → White
6. **Placeholder**: Updated text
7. **Remove**: FAB burger button at bottom-right

---

## Testing Checklist
- [ ] Logo shows "Storyflo"
- [ ] Header has correct layout (hamburger | logo | settings)
- [ ] Icon buttons are 48px with 16px border-radius
- [ ] Menu opens from hamburger icon
- [ ] Save rules button is white with dark text
- [ ] Ghost/prediction text is #8a8a8a
- [ ] Mobile layout works correctly
- [ ] All existing functionality preserved
