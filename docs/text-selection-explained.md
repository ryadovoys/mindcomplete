# Mindcomplete: How Text Selection Works

## Overview

Mindcomplete is an AI writing assistant that predicts and suggests text continuations. When you type text and pause, the app generates a prediction that appears inline (in pink color) after your text.

You can accept all or part of this prediction using different interaction modes.

---

## Visual Structure

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  "I think that artificial intelligence"                 │  ← Your text (white)
│  "will change the world in many ways                    │  ← Prediction (pink)
│   that we cannot yet imagine."                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

The prediction appears **inline** — it continues directly from where your text ends, wrapping naturally to new lines.

---

## Two Interaction Modes

### 1. Normal Mode (Default)

**Purpose:** Quick acceptance of prediction text up to a specific word.

**How it works:**

```
Your text: "I think that"
Prediction: "artificial intelligence will change everything"

You tap on "will":
                    ↓ tap here
"artificial intelligence will change everything"
└──────────────────────┘
   This part gets accepted
```

**Behavior:**
- Tap on any word in the prediction
- All text from the START of prediction UP TO AND INCLUDING that word gets accepted
- The accepted text becomes part of your document (turns white)
- Remaining prediction stays visible (or new prediction is requested)

**Example flow:**

```
BEFORE TAP:
"I think that" + [artificial intelligence will change everything]
                 ↑ prediction (pink)

TAP ON "will":
                         ↓
[artificial intelligence will] change everything

AFTER TAP:
"I think that artificial intelligence will " + [change everything]
└──────────────────────────────────────────┘   └─────────────────┘
            Your text (white)                   Remaining prediction
```

**Key point:** In Normal mode, you always accept FROM THE BEGINNING. You cannot select a middle portion.

---

### 2. Select Mode

**Purpose:** Select a specific range/chunk from the prediction (not necessarily from the beginning).

**How to activate:** Tap the menu button → Select

**How it works (Mobile - Tap & Drag):**

```
Prediction: "artificial intelligence will change everything forever"

1. Touch and hold on "will"
   → First word gets highlighted

2. Drag finger to "everything"
   → Range expands as you drag

3. Release finger
   → Selected range is ready for confirmation

         drag from here ──────────► to here
                ↓                      ↓
"artificial intelligence [will change everything] forever"
                         └─────────────────────┘
                            Selected range (white)
```

**How it works (Desktop - Two Clicks):**

```
1. First click on "will"
   → Sets the START of selection

2. Second click on "everything"
   → Sets the END of selection

"artificial intelligence [will change everything] forever"
                         └─────────────────────┘
                            Selected range
```

**After selection is made:**
- A confirm button (✓) appears
- Tap confirm to accept ONLY the selected range
- The selected text gets added to your document

**Example flow:**

```
BEFORE SELECTION:
"I think that" + [artificial intelligence will change everything forever]

SELECT "will change everything":
"I think that" + artificial intelligence [will change everything] forever
                                         └─────────────────────┘
                                              Selected (white)

AFTER CONFIRM:
"I think that will change everything " + [new prediction...]
```

**Key point:** In Select mode, you can pick ANY chunk from the middle. You're not forced to start from the beginning.

---

## Comparison Table

| Feature | Normal Mode | Select Mode |
|---------|-------------|-------------|
| Activation | Default | Menu → Select |
| Selection start | Always from beginning | Any word |
| Selection end | Word you tap | Word where drag ends |
| Gesture (mobile) | Single tap | Tap & drag |
| Gesture (desktop) | Single click | Two clicks |
| Confirmation | Instant | Requires confirm button |
| Use case | Quick acceptance | Precise chunk selection |

---

## Word-Based Selection

Both modes use **word-based** selection, not character-based:

```
Prediction: "artificial intelligence"

If you tap anywhere on "intelligence":
- Even on the "i" at the start
- Even on the "e" at the end
- The WHOLE word "intelligence" is included

"artificial [intelligence]"
            └─────────────┘
              Entire word selected
```

This makes it easier to select on touch devices where precise character targeting is difficult.

---

## What Happens to Accepted Text

When you accept text (in either mode):

1. **Text is appended** to your document
2. **Space is auto-added** after the text (for easier continued typing)
3. **If text ends with period** → paragraph break is added
4. **Remaining prediction** either stays visible or new prediction is requested

```
Accept: "will change everything."
                              ↑ ends with period

Result in document:
"I think that will change everything.
"                                    ← New paragraph started
```

---

## Touch Detection

The app detects whether you tapped on the prediction or on your own text:

```
"Your text here" [prediction continues here
                  and wraps to next line]

Tap zones:
├─────────────┤ ← Tapping here = editing your text (no action)
               ├──────────────────────┤ ← Tapping here = selecting prediction
```

Only taps that land directly on the pink prediction text trigger selection. Tapping on white (your) text lets you edit normally.

---

## Visual Feedback

### Hover (Desktop only)
When you move mouse over prediction, the text from start to current word turns white:

```
Mouse over "will":
                  ↓ mouse here
"[artificial intelligence will] change everything"
 └─────────────────────────────┘
        Highlighted white (preview)
```

### Touch (Mobile)
No hover preview. Tap directly triggers action.

### Select Mode Highlighting
In select mode, selected range appears in white:

```
"artificial [will change everything] forever"
            └─────────────────────┘
                  White text
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Tab | Accept ENTIRE prediction |
| → (Arrow Right) | Extend selection by one character (when cursor at end) |
| Enter (in Select mode) | Confirm selection |
| Escape | Exit Select mode |

---

## Summary

- **Normal Mode** = Quick, tap-to-accept from beginning to tapped word
- **Select Mode** = Precise, drag-to-select any chunk from prediction
- Both modes are **word-based** for easier touch interaction
- Accepted text automatically gets proper spacing and paragraph breaks
