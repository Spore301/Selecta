// content.js

let selectDebounceTimer = null;

// Initialize on load
function initSelectionListener() {
  document.addEventListener('mouseup', handleMouseUp);
  
  // Watch for storage changes to react to toggles or settings updates in real time
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
      const isEnabled = changes.enabled.newValue;
      if (isEnabled) {
        if (window.selectaOverlay) {
          window.selectaOverlay.removePausedBadge();
        }
      } else {
        if (window.selectaOverlay) {
          window.selectaOverlay.showPausedBadge();
        }
      }
    }
  });

  // Verify enable/disable state on load
  chrome.storage.local.get({ enabled: true }, (res) => {
    if (!res.enabled && window.selectaOverlay) {
      window.selectaOverlay.showPausedBadge();
    }
  });
}

// Check selection and fire overlay
async function handleMouseUp(e) {
  if (selectDebounceTimer) {
    clearTimeout(selectDebounceTimer);
  }

  selectDebounceTimer = setTimeout(async () => {
    const selection = window.getSelection();
    const term = selection.toString().trim();

    // Verification guards
    if (term.length < 2) return;

    // Check if clicked inside our overlay shadow DOM
    const host = document.getElementById('selecta-overlay-host');
    if (host && (host.contains(e.target) || e.composedPath().includes(host))) {
      return;
    }

    // Retrieve settings
    const settings = await chrome.storage.local.get({
      enabled: true,
      mode: 'auto',
      wordLimit: 30,
      blocklist: ''
    });

    if (!settings.enabled) return;

    // Check site blocklist
    const currentHost = window.location.hostname;
    const blocklistItems = settings.blocklist.split('\n').map(d => d.trim()).filter(Boolean);
    const isBlocklisted = blocklistItems.some(domain => currentHost.includes(domain));
    if (isBlocklisted) return;

    // Calculate word count
    const words = term.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;

    let targetMode = 'dictionary'; // Default mode
    if (settings.mode === 'auto') {
      if (wordCount > settings.wordLimit) {
        targetMode = 'summary';
      }
    } else if (settings.mode === 'summarize') {
      targetMode = 'summary';
    }

    // Perform operations based on target mode
    if (targetMode === 'dictionary') {
      const context = getSelectedContext(selection);
      if (window.selectaOverlay) {
        window.selectaOverlay.show(term, 'dictionary', context);
      }
    } else {
      // Summarizer mode
      if (window.selectaOverlay) {
        window.selectaOverlay.show(term, 'summary', null);
      }
    }
  }, 400);
}

// Extract ±10 words contextual window around the selection
function getSelectedContext(selection) {
  if (!selection || selection.rangeCount === 0) return '';
  
  try {
    const range = selection.getRangeAt(0);
    const startContainer = range.startContainer;
    const startOffset = range.startOffset;
    const endContainer = range.endContainer;
    const endOffset = range.endOffset;

    let ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType === Node.TEXT_NODE) {
      ancestor = ancestor.parentNode;
    }

    // Walk text nodes within the common ancestor
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

    // Resolve index of start/end text containers
    let startIndex = textNodes.indexOf(startContainer);
    let endIndex = textNodes.indexOf(endContainer);

    // Fallbacks if node is element node
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

    // Words before selection
    let wordsBefore = [];
    if (startIndex >= 0 && startIndex < textNodes.length) {
      const node = textNodes[startIndex];
      const textBefore = node.textContent.substring(0, node === startContainer ? startOffset : 0);
      wordsBefore = textBefore.trim().split(/\s+/).filter(Boolean);
    }

    let i = startIndex - 1;
    while (wordsBefore.length < 10 && i >= 0) {
      const node = textNodes[i];
      const nodeWords = node.textContent.trim().split(/\s+/).filter(Boolean);
      wordsBefore = [...nodeWords, ...wordsBefore];
      i--;
    }
    if (wordsBefore.length > 10) {
      wordsBefore = wordsBefore.slice(-10);
    }

    // Words after selection
    let wordsAfter = [];
    if (endIndex >= 0 && endIndex < textNodes.length) {
      const node = textNodes[endIndex];
      const textAfter = node.textContent.substring(node === endContainer ? endOffset : node.textContent.length);
      wordsAfter = textAfter.trim().split(/\s+/).filter(Boolean);
    }

    let j = endIndex + 1;
    while (wordsAfter.length < 10 && j < textNodes.length) {
      const node = textNodes[j];
      const nodeWords = node.textContent.trim().split(/\s+/).filter(Boolean);
      wordsAfter = [...wordsAfter, ...nodeWords];
      j++;
    }
    if (wordsAfter.length > 10) {
      wordsAfter = wordsAfter.slice(0, 10);
    }

    return `${wordsBefore.join(' ')} [TERM] ${wordsAfter.join(' ')}`;
  } catch (err) {
    console.error('Failed to extract selection context:', err);
    return `[TERM]`;
  }
}

// Run listener setup
initSelectionListener();
