# Selecta — Instant AI Explainer
### Product Requirements Document · v1.0

**Platform:** Chrome / Edge (Manifest V3)  
**Model:** BYOK — `deepseek-chat`  
**Scope:** MVP  

---

## Problem & Goal

Users frequently encounter unfamiliar words, terms, or phrases while browsing. Switching tabs to search breaks reading flow. Selecta eliminates that context-switch by delivering a concise, contextually-aware explanation in under 2 seconds, directly on the page.

---

## Core User Flow

```
User selects text → Grab ±10 word context → Call DeepSeek API → Show overlay → Save to history
```

---

## Design Constraint

> **All UI implementation must strictly follow `design.md`**, located at the project root.  
> `design.md` is the single source of truth for colors, typography, spacing, component patterns, border radii, and overlay styling. No visual decisions should be made that contradict or extend it without explicit sign-off. This applies to:
> - The floating overlay (position, size, typography, shadow, animation)  
> - The popup (API key input, history tab, toggle, settings)  
> - Any in-page injected elements (loading states, error states, copy button)  
>
> When in doubt, consult `design.md` before writing any CSS.

---

## Features

### Must Have

#### Explanation Overlay
A non-intrusive floating panel anchored to the top of the viewport (not cursor-following). Streams the DeepSeek response token-by-token. Dismissed by clicking outside or pressing Escape. Displays the selected word/phrase as a header with the explanation rendered below.

#### Contextual Window — ±10 Words
On selection, the content script asynchronously walks the DOM to extract up to 10 words before and 10 words after the selected text. This surrounding context is appended silently to the API prompt — not shown to the user — so the explanation is page-aware. Uses a `TreeWalker` targeting `TEXT_NODE` across the selection's `commonAncestorContainer`.

#### User-Provided API Key
On first use, the extension popup prompts for a DeepSeek API key. The key is stored in `chrome.storage.local`. A masked input with a "test key" button validates the key before saving. Users can update or clear the key from the popup settings panel at any time.

#### Lookup History
Every lookup is saved to `chrome.storage.local` as a JSON record:
```json
{ "term": "", "explanation": "", "url": "", "timestamp": "" }
```
The popup's history tab renders these in reverse-chronological order. Users can delete individual entries or clear all history. Max 500 entries (FIFO eviction).

---

### Should Have

#### Enable / Disable Toggle
A prominent toggle in the popup lets users pause Selecta without uninstalling. The overlay will not fire when disabled. State persists in `chrome.storage.local`.

#### Copy Explanation Button
A small copy icon inside the overlay writes the explanation text to the clipboard. Shows a brief "Copied" confirmation state.

---

### Nice to Have

#### Site Blocklist
A text field in settings lets users enter domains (e.g. `gmail.com`) where the extension should never fire. Useful for text-input-heavy apps where accidental selection is common.

#### Search History
A search input at the top of the history tab filters entries by term or explanation text in real time.

---

## Technical Spec

| Property | Value |
|---|---|
| Manifest version | MV3 |
| Permissions | `activeTab`, `storage`, `scripting` |
| Model | `deepseek-chat` |
| API call type | Streaming (SSE) |
| Context extraction | Async DOM walk, ±10 words |
| History store | `chrome.storage.local` (JSON array) |
| API key store | `chrome.storage.local` |
| Overlay position | Fixed, top of viewport |
| Max history entries | 500 (FIFO eviction) |
| Min selection length | 2 characters |

---

## API Prompt Design

**System prompt:**
```
You are a concise explainer. Given a selected term and its surrounding text, respond with 1–3 short sentences explaining it. No markdown.
```

**User message:**
```
Term: [selected text]
Context: […10 words before] [TERM] [10 words after…]
```

---

## File Structure

```
manifest.json
background.js        ← service worker
content.js           ← selection listener + context grab
overlay.js           ← overlay UI + streaming render
overlay.css          ← must comply with design.md
popup/
  index.html         ← API key · toggle · history
  popup.js
  popup.css          ← must comply with design.md
design.md            ← source of truth for all visual decisions
```

---

## Non-Goals (Out of Scope for MVP)

- Firefox / Safari support  
- Multi-model selection (GPT, Claude, etc.)  
- Cloud sync of history  
- Sentence / paragraph-length selections  
- Image or non-text content analysis  
- Offline / cached explanations  

---

## Open Questions

| Question | Suggested Default |
|---|---|
| Debounce delay after mouseup? | 400ms |
| Max selected text length before truncation? | ~80 characters |
| Show overlay on mobile (Android Chrome)? | Defer to v2 |
| Rate limit handling UX? | Show inline error in overlay |
