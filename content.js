// content.js

if (!window.selectaContentScriptLoaded) {
  window.selectaContentScriptLoaded = true;

  let selectDebounceTimer = null;

// Listen to mouseup to capture selections
document.addEventListener('mouseup', handleTextSelection);

function handleTextSelection() {
  if (selectDebounceTimer) {
    clearTimeout(selectDebounceTimer);
  }

  // Set debounce delay (400ms)
  selectDebounceTimer = setTimeout(async () => {
    try {
      const selection = window.getSelection();
      const selectedText = selection.toString().trim();

      // Enforce minimum selection length of 2 characters
      if (selectedText.length < 2) return;

      // Ignore selections if the user is currently dragging or resizing the overlay, or just finished (within 500ms)
      if (window.selectaOverlay && (
        window.selectaOverlay.isDragging || 
        window.selectaOverlay.isResizing || 
        (Date.now() - window.selectaOverlay.lastInteractTime < 500)
      )) {
        return;
      }

      // Ignore selections originating inside the Shadow DOM of the overlay card
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const startRoot = range.startContainer.getRootNode();
        if (startRoot && startRoot instanceof ShadowRoot && startRoot.host && startRoot.host.id === 'selecta-overlay-host') {
          return;
        }
      }

      // Check storage for enabled state, active mode, word limit, and blocklist
      const settings = await chrome.storage.local.get({
        enabled: true,
        mode: 'auto',
        wordLimit: 30,
        blocklist: ''
      });

      // If extension is disabled, do not fire
      if (!settings.enabled) return;

      // Check blocklist
      const currentHost = window.location.hostname;
      if (settings.blocklist) {
        const domains = settings.blocklist
          .split('\n')
          .map(d => d.trim().toLowerCase())
          .filter(d => d.length > 0);
        
        const isBlocked = domains.some(domain => currentHost.toLowerCase().includes(domain));
        if (isBlocked) return;
      }

      // Count words in selection
      const words = selectedText.split(/\s+/).filter(w => w.length > 0);
      const wordCount = words.length;

      // Decide mode: dictionary vs summarize
      let targetMode = 'dictionary';
      if (settings.mode === 'summarize') {
        targetMode = 'summarize';
      } else if (settings.mode === 'auto') {
        if (wordCount > settings.wordLimit) {
          targetMode = 'summarize';
        }
      }

      if (targetMode === 'dictionary') {
        // Extract context (±10 words around selection)
        const context = getSelectedContext(selection);
        
        // Truncate term title for layout comfort if selected text is long
        const term = selectedText.length > 80 ? selectedText.slice(0, 80) + '...' : selectedText;

        if (window.selectaOverlay) {
          window.selectaOverlay.show(term, context, 'dictionary', null);
        }
      } else {
        // Summarize mode
        if (window.selectaOverlay) {
          window.selectaOverlay.show(null, null, 'summarize', selectedText);
        }
      }
    } catch (err) {
      console.error("Selecta content script error:", err);
    }
  }, 400);
}

// Custom text walking algorithm to extract ±10 words around selection
function getSelectedContext(selection) {
  if (!selection || selection.rangeCount === 0) return '[TERM]';
  
  try {
    const range = selection.getRangeAt(0);
    const startContainer = range.startContainer;
    const startOffset = range.startOffset;
    const endContainer = range.endContainer;
    const endOffset = range.endOffset;

    // Get the nearest common ancestor element
    let ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType === Node.TEXT_NODE) {
      ancestor = ancestor.parentNode;
    }

    // Set up a TreeWalker for text nodes under the common ancestor
    const walker = document.createTreeWalker(
      ancestor,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    const textNodes = [];
    let currentNode = walker.nextNode();
    while (currentNode) {
      textNodes.push(currentNode);
      currentNode = walker.nextNode();
    }

    let startIndex = textNodes.indexOf(startContainer);
    let endIndex = textNodes.indexOf(endContainer);

    // Fallback if node references are not direct index matches
    if (startIndex === -1) {
      startIndex = 0;
      for (let i = 0; i < textNodes.length; i++) {
        if (startContainer.contains(textNodes[i]) || startContainer.compareDocumentPosition(textNodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING) {
          startIndex = i;
          break;
        }
      }
    }
    if (endIndex === -1) {
      endIndex = textNodes.length - 1;
      for (let i = textNodes.length - 1; i >= 0; i--) {
        if (endContainer.contains(textNodes[i]) || endContainer.compareDocumentPosition(textNodes[i]) & Node.DOCUMENT_POSITION_PRECEDING) {
          endIndex = i;
          break;
        }
      }
    }

    // 1. Gather text before selection
    let wordsBefore = [];
    if (startIndex >= 0 && startIndex < textNodes.length) {
      const node = textNodes[startIndex];
      // Text before startOffset in the startContainer
      const textBefore = node.textContent.substring(0, node === startContainer ? startOffset : 0);
      wordsBefore = textBefore.trim().split(/\s+/).filter(w => w.length > 0);
    }

    // Walk backwards through preceding text nodes
    let i = startIndex - 1;
    while (wordsBefore.length < 10 && i >= 0) {
      const node = textNodes[i];
      const nodeText = node.textContent;
      const nodeWords = nodeText.trim().split(/\s+/).filter(w => w.length > 0);
      wordsBefore = [...nodeWords, ...wordsBefore];
      i--;
    }
    
    // Slice only the last 10 words
    if (wordsBefore.length > 10) {
      wordsBefore = wordsBefore.slice(-10);
    }

    // 2. Gather text after selection
    let wordsAfter = [];
    if (endIndex >= 0 && endIndex < textNodes.length) {
      const node = textNodes[endIndex];
      // Text after endOffset in the endContainer
      const textAfter = node.textContent.substring(node === endContainer ? endOffset : node.textContent.length);
      wordsAfter = textAfter.trim().split(/\s+/).filter(w => w.length > 0);
    }

    // Walk forwards through subsequent text nodes
    let j = endIndex + 1;
    while (wordsAfter.length < 10 && j < textNodes.length) {
      const node = textNodes[j];
      const nodeText = node.textContent;
      const nodeWords = nodeText.trim().split(/\s+/).filter(w => w.length > 0);
      wordsAfter = [...wordsAfter, ...nodeWords];
      j++;
    }

    // Slice only the first 10 words
    if (wordsAfter.length > 10) {
      wordsAfter = wordsAfter.slice(0, 10);
    }

    // Construct the context layout
    const termPlaceholder = `[TERM]`;
    return `${wordsBefore.join(' ')} ${termPlaceholder} ${wordsAfter.join(' ')}`;
  } catch (e) {
    console.error("Context extraction failed, returning default:", e);
    return '[TERM]';
  }
}

  // Listen to storage changes to coordinate the Grammarly-style paused badge
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && window.selectaOverlay) {
      if (changes.enabled) {
        const enabled = changes.enabled.newValue;
        if (enabled) {
          window.selectaOverlay.hidePausedBadge();
        } else {
          window.selectaOverlay.showPausedBadge();
        }
      }
    }
  });
}
