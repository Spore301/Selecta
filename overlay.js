// overlay.js

class SelectaOverlay {
  constructor() {
    this.host = null;
    this.shadow = null;
    this.overlayElement = null;
    this.pausedBadge = null;
    this.currentPort = null;
    this.activeStreamingText = '';
    this.activeStreamingContainer = null;
    this.chatTurnCounter = 0;

    // Bind event listeners
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleOutsideClick = this.handleOutsideClick.bind(this);
  }

  init() {
    if (this.host) return;

    // Create shadow host
    this.host = document.createElement('div');
    this.host.id = 'selecta-overlay-host';
    this.shadow = this.host.attachShadow({ mode: 'open' });

    // Load stylesheet link
    const cssLink = document.createElement('link');
    cssLink.rel = 'stylesheet';
    cssLink.href = chrome.runtime.getURL('overlay.css');
    this.shadow.appendChild(cssLink);

    // Create wrapper div
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'selecta-overlay-wrapper';
    this.shadow.appendChild(this.wrapper);

    // 1. In-page overlay HTML
    this.overlayElement = document.createElement('div');
    this.overlayElement.className = 'selecta-overlay hidden';
    this.overlayElement.innerHTML = `
      <div class="overlay-container">
        <div class="overlay-header">
          <div class="overlay-title-wrapper">
            <span class="overlay-subtitle" id="selecta-mode-title">Dictionary</span>
            <span class="overlay-title" id="selecta-word-title">Term</span>
          </div>
          <div class="overlay-actions">
            <button class="action-btn" id="selecta-copy-btn" title="Copy text">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span class="tooltip" id="selecta-copy-tooltip">Copy</span>
            </button>
            <button class="action-btn pause-btn" id="selecta-pause-btn" title="Pause Selecta">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>
              <span class="tooltip">Pause</span>
            </button>
            <button class="action-btn" id="selecta-close-btn" title="Dismiss">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              <span class="tooltip">Dismiss</span>
            </button>
          </div>
        </div>
        <div class="overlay-body" id="selecta-body">
          <div class="overlay-content" id="selecta-main-content">Select text to explain...</div>
        </div>
        <div class="overlay-chat-section">
          <div class="chat-input-wrapper">
            <input type="text" class="chat-input" id="selecta-chat-input" placeholder="Ask follow-up question..." disabled />
            <button class="chat-send-btn" id="selecta-chat-send" disabled>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </div>
        </div>
      </div>
    `;
    this.wrapper.appendChild(this.overlayElement);

    // 2. Grammarly-like floating paused badge HTML
    this.pausedBadge = document.createElement('div');
    this.pausedBadge.className = 'selecta-paused-badge hidden';
    this.pausedBadge.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="6" y="4" width="4" height="16" rx="1"></rect>
        <rect x="14" y="4" width="4" height="16" rx="1"></rect>
      </svg>
      <div class="badge-popover" id="selecta-popover">
        <div class="popover-title">Selecta Paused</div>
        <button class="popover-btn" id="selecta-resume-btn">Resume</button>
      </div>
    `;
    this.wrapper.appendChild(this.pausedBadge);

    document.body.appendChild(this.host);

    // Setup action event listeners
    this.shadow.getElementById('selecta-copy-btn').addEventListener('click', () => this.copyToClipboard());
    this.shadow.getElementById('selecta-pause-btn').addEventListener('click', () => this.pauseService());
    this.shadow.getElementById('selecta-close-btn').addEventListener('click', () => this.hide());
    this.shadow.getElementById('selecta-chat-send').addEventListener('click', () => this.submitFollowUp());

    const chatInput = this.shadow.getElementById('selecta-chat-input');
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submitFollowUp();
      }
    });

    // Paused badge events
    this.pausedBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pausedBadge.classList.toggle('popover-open');
    });

    this.shadow.getElementById('selecta-resume-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.resumeService();
    });

    // Check if the service is already paused on load to show badge
    chrome.storage.local.get({ enabled: true }, (res) => {
      if (!res.enabled) {
        this.showPausedBadge();
      }
    });
  }

  show(term, context, mode, selectedText) {
    this.init();
    this.hidePausedBadge();

    // Load active theme
    chrome.storage.local.get({ theme: 'system' }, (res) => {
      let activeTheme = res.theme;
      if (activeTheme === 'system') {
        activeTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      this.wrapper.setAttribute('data-theme', activeTheme);
    });

    // Clear previous chat turns
    const body = this.shadow.getElementById('selecta-body');
    const mainContent = this.shadow.getElementById('selecta-main-content');
    body.innerHTML = '';
    body.appendChild(mainContent);

    // Reset controls
    this.chatTurnCounter = 0;
    const chatInput = this.shadow.getElementById('selecta-chat-input');
    chatInput.value = '';
    chatInput.disabled = true;
    this.shadow.getElementById('selecta-chat-send').disabled = true;

    // Display appropriate title based on mode
    const modeTitle = this.shadow.getElementById('selecta-mode-title');
    const wordTitle = this.shadow.getElementById('selecta-word-title');
    if (mode === 'summarize') {
      modeTitle.textContent = 'Summarizer';
      wordTitle.textContent = 'Passage Selection';
    } else {
      modeTitle.textContent = 'Dictionary';
      wordTitle.textContent = term;
    }

    // Set loading indicator
    mainContent.innerHTML = `
      <div class="overlay-content loading">
        Analyzing selection
        <div class="loading-dots">
          <div class="loading-dot"></div>
          <div class="loading-dot"></div>
          <div class="loading-dot"></div>
        </div>
      </div>
    `;

    // Make visible
    this.overlayElement.classList.remove('hidden');
    this.overlayElement.classList.add('visible');

    // Attach dismissal listeners
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('mousedown', this.handleOutsideClick);

    // Disconnect old port if any
    if (this.currentPort) {
      this.currentPort.disconnect();
    }

    // Connect to background script
    this.currentPort = chrome.runtime.connect({ name: 'selecta-stream' });
    this.activeStreamingText = '';
    this.activeStreamingContainer = mainContent;

    // Send search message
    this.currentPort.postMessage({
      type: 'start',
      term,
      context,
      mode,
      selectedText,
      url: window.location.href
    });

    this.currentPort.onMessage.addListener((msg) => {
      if (msg.type === 'chunk') {
        if (this.activeStreamingContainer) {
          // If first chunk, clear loading state
          if (this.activeStreamingText === '') {
            this.activeStreamingContainer.innerHTML = '';
          }
          this.activeStreamingText += msg.text;
          // Render chunk raw (simple streaming effect)
          this.activeStreamingContainer.textContent = this.activeStreamingText;
          // Scroll container to bottom
          const body = this.shadow.getElementById('selecta-body');
          body.scrollTop = body.scrollHeight;
        }
      } else if (msg.type === 'error') {
        if (this.activeStreamingContainer) {
          this.activeStreamingContainer.innerHTML = `<span class="error-text">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            ${msg.message}
          </span>`;
        }
        chatInput.disabled = true;
        this.shadow.getElementById('selecta-chat-send').disabled = true;
      } else if (msg.type === 'done') {
        if (this.activeStreamingContainer) {
          // Render complete markdown output
          this.activeStreamingContainer.innerHTML = this.parseMarkdown(this.activeStreamingText || msg.fullText);
        }
        // Enable chat inputs
        chatInput.disabled = false;
        chatInput.placeholder = "Ask follow-up question...";
        this.shadow.getElementById('selecta-chat-send').disabled = false;
      }
    });
  }

  submitFollowUp() {
    const chatInput = this.shadow.getElementById('selecta-chat-input');
    const question = chatInput.value.trim();
    if (!question || !this.currentPort) return;

    chatInput.value = '';
    chatInput.disabled = true;
    this.shadow.getElementById('selecta-chat-send').disabled = true;

    this.chatTurnCounter++;
    const turnId = this.chatTurnCounter;

    // Create elements for this chat turn
    const body = this.shadow.getElementById('selecta-body');
    const turnDiv = document.createElement('div');
    turnDiv.className = 'chat-turn';
    turnDiv.innerHTML = `
      <div class="chat-question">Q: ${this.escapeHtml(question)}</div>
      <div class="chat-answer" id="answer-${turnId}">
        <div class="overlay-content loading">
          Thinking
          <div class="loading-dots">
            <div class="loading-dot"></div>
            <div class="loading-dot"></div>
            <div class="loading-dot"></div>
          </div>
        </div>
      </div>
    `;
    body.appendChild(turnDiv);
    body.scrollTop = body.scrollHeight;

    this.activeStreamingText = '';
    this.activeStreamingContainer = this.shadow.getElementById(`answer-${turnId}`);

    // Send query to background
    this.currentPort.postMessage({
      type: 'chat',
      text: question
    });
  }

  hide() {
    if (!this.overlayElement) return;
    this.overlayElement.classList.remove('visible');
    this.overlayElement.classList.add('hidden');

    if (this.currentPort) {
      this.currentPort.disconnect();
      this.currentPort = null;
    }

    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('mousedown', this.handleOutsideClick);
  }

  pauseService() {
    this.hide();
    chrome.storage.local.set({ enabled: false }, () => {
      this.showPausedBadge();
    });
  }

  resumeService() {
    chrome.storage.local.set({ enabled: true }, () => {
      this.hidePausedBadge();
    });
  }

  showPausedBadge() {
    this.init();
    this.pausedBadge.classList.remove('hidden');
    this.pausedBadge.classList.remove('popover-open');
  }

  hidePausedBadge() {
    if (this.pausedBadge) {
      this.pausedBadge.classList.add('hidden');
      this.pausedBadge.classList.remove('popover-open');
    }
  }

  handleKeyDown(e) {
    if (e.key === 'Escape') {
      this.hide();
    }
  }

  handleOutsideClick(e) {
    // Check if the click is outside the shadow host
    if (this.host && !this.host.contains(e.target) && !e.composedPath().includes(this.host)) {
      this.hide();
    }
  }

  async copyToClipboard() {
    const textElements = this.shadow.getElementById('selecta-body').innerText;
    if (!textElements || textElements === 'Select text to explain...') return;

    try {
      await navigator.clipboard.writeText(textElements);
      const tooltip = this.shadow.getElementById('selecta-copy-tooltip');
      tooltip.textContent = 'Copied!';
      setTimeout(() => {
        tooltip.textContent = 'Copy';
      }, 1500);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  }

  // Escape HTML helper
  escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Lightweight Regex-based Markdown Parser (Outfit styling compatible)
  parseMarkdown(text) {
    if (!text) return '';
    let html = text.trim();

    // Escape raw tag delimiters
    html = this.escapeHtml(html);

    // 1. Render Dictionary Dividers (e.g. "term | phonetic" or "word | partOfSpeech")
    html = html.replace(/^([^*|\n]+?)\s*\|\s*([^\n]+)/gm, '<div class="overlay-title">$1</div><div class="dict-pos">$2</div>');

    // 2. Headings
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // 3. Examples block (e.g. *Example: text* or _Example: text_)
    html = html.replace(/(?:\*|_)(Example:\s*[^*_\n]+)(?:\*|_)/gim, '<div class="dict-example">$1</div>');

    // 4. Code Blocks and Inline Code
    html = html.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>');

    // 5. Bold & Italic
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="md-bold">$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em class="md-italic">$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em class="md-italic">$1</em>');

    // 6. Split blocks by paragraphs (separated by double newlines)
    const blocks = html.split(/\n\n+/);
    const parsedBlocks = blocks.map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';

      // Check if it's already structured as a header, subheader, or list
      if (trimmed.startsWith('<h') || trimmed.startsWith('<div') || trimmed.startsWith('<ul')) {
        return trimmed;
      }

      // Check for bullet list blocks
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const lines = trimmed.split(/\n/);
        const listItems = [];
        for (let line of lines) {
          line = line.trim();
          if (line.startsWith('- ') || line.startsWith('* ')) {
            const content = line.substring(2).trim();
            listItems.push(`<li class="md-list-item">${content}</li>`);
          }
        }
        return `<ul class="md-list">${listItems.join('')}</ul>`;
      }

      // Check for ordered list blocks (e.g., 1. 2. 3.)
      if (/^\d+\.\s+/.test(trimmed)) {
        const lines = trimmed.split(/\n/);
        const listItems = [];
        for (let line of lines) {
          line = line.trim();
          const match = line.match(/^\d+\.\s+(.*)/);
          if (match) {
            listItems.push(`<li class="md-list-item">${match[1]}</li>`);
          }
        }
        return `<ol class="md-list">${listItems.join('')}</ol>`;
      }

      // Default paragraph wrapper
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    });

    return parsedBlocks.join('');
  }
}

// Bind to window to share with content.js
window.selectaOverlay = new SelectaOverlay();
