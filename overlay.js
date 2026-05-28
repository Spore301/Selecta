// overlay.js

class SelectaOverlay {
  constructor() {
    this.host = null;
    this.shadow = null;
    this.overlayElement = null;
    this.currentPort = null;
    this.activeMode = 'dictionary';
    
    // Bind listeners
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.sendFollowup = this.sendFollowup.bind(this);
  }

  init() {
    if (this.host) return;

    // Create shadow host container
    this.host = document.createElement('div');
    this.host.id = 'selecta-overlay-host';
    
    // Attach Shadow DOM
    this.shadow = this.host.attachShadow({ mode: 'open' });

    // Load Outfit font inside Shadow DOM
    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600&display=swap';
    this.shadow.appendChild(fontLink);

    // Link overlay.css stylesheet
    const cssLink = document.createElement('link');
    cssLink.rel = 'stylesheet';
    cssLink.href = chrome.runtime.getURL('overlay.css');
    this.shadow.appendChild(cssLink);

    // Build markup inside overlay container
    this.overlayElement = document.createElement('div');
    this.overlayElement.className = 'selecta-overlay hidden';
    this.overlayElement.innerHTML = `
      <div class="overlay-container">
        <div class="overlay-header">
          <div class="logo-group">
            <svg class="logo-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
            <span class="logo-title">Selecta</span>
          </div>
          <div class="overlay-actions">
            <button class="action-btn" id="selecta-copy-btn" title="Copy explanation">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span class="tooltip" id="selecta-tooltip">Copy</span>
            </button>
            <button class="action-btn pause-btn" id="selecta-pause-btn" title="Pause Selecta">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="10" y1="15" x2="10" y2="9"></line><line x1="14" y1="15" x2="14" y2="9"></line></svg>
              <span class="tooltip">Pause</span>
            </button>
            <button class="action-btn close-btn" id="selecta-close-btn" title="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </div>
        <div class="overlay-body">
          <div class="chat-messages" id="selecta-chat-messages">
            <!-- Dynamic dictionary card container -->
            <div class="dictionary-card" id="selecta-dictionary-card">
              <div class="dictionary-header">
                <span class="dictionary-term" id="selecta-dict-term">Word</span>
                <span class="dictionary-label" id="selecta-dict-label">dictionary entry</span>
              </div>
              <div class="dictionary-definition" id="selecta-explanation">Loading explanation...</div>
            </div>
          </div>
        </div>
        <div class="chat-input-row">
          <input type="text" class="chat-input" id="selecta-chat-input" placeholder="Ask follow-up..." />
          <button class="chat-send-btn" id="selecta-chat-send" title="Send question">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
          </button>
        </div>
      </div>
      
      <!-- Persistent paused floating badge -->
      <div class="paused-badge" id="selecta-paused-badge" title="Click to Resume Selecta">
        <svg class="paused-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="10" y1="15" x2="10" y2="9"></line><line x1="14" y1="15" x2="14" y2="9"></line></svg>
        <span>Paused</span>
      </div>
    `;

    this.shadow.appendChild(this.overlayElement);
    document.body.appendChild(this.host);

    // Setup action click listeners
    this.shadow.getElementById('selecta-copy-btn').addEventListener('click', () => this.copyExplanation());
    this.shadow.getElementById('selecta-close-btn').addEventListener('click', () => this.hide());
    this.shadow.getElementById('selecta-pause-btn').addEventListener('click', () => this.pauseService());
    
    // Resume trigger from paused badge
    this.shadow.getElementById('selecta-paused-badge').addEventListener('click', () => {
      chrome.storage.local.set({ enabled: true });
    });

    // Chat follow-up triggers
    this.shadow.getElementById('selecta-chat-send').addEventListener('click', this.sendFollowup);
    this.shadow.getElementById('selecta-chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.sendFollowup();
      }
    });
  }

  show(term, mode, context) {
    this.init();
    this.activeMode = mode;

    // Retrieve active theme setting
    chrome.storage.local.get({ theme: 'system' }, (res) => {
      let activeTheme = res.theme;
      if (activeTheme === 'system') {
        activeTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      this.overlayElement.setAttribute('data-theme', activeTheme);
    });

    // Setup initial header text and clean card
    const dictTerm = this.shadow.getElementById('selecta-dict-term');
    const dictLabel = this.shadow.getElementById('selecta-dict-label');
    const messagesContainer = this.shadow.getElementById('selecta-chat-messages');

    // Clean previous follow-up bubbles (keep only dictionary card)
    messagesContainer.innerHTML = `
      <div class="dictionary-card" id="selecta-dictionary-card">
        <div class="dictionary-header">
          <span class="dictionary-term" id="selecta-dict-term">Word</span>
          <span class="dictionary-label" id="selecta-dict-label">dictionary entry</span>
        </div>
        <div class="dictionary-definition" id="selecta-explanation">Loading explanation...</div>
      </div>
    `;

    const explanationEl = this.shadow.getElementById('selecta-explanation');
    const inputEl = this.shadow.getElementById('selecta-chat-input');

    inputEl.value = '';
    inputEl.disabled = true;
    this.shadow.getElementById('selecta-chat-send').disabled = true;

    if (mode === 'dictionary') {
      this.shadow.getElementById('selecta-dict-term').textContent = term;
      this.shadow.getElementById('selecta-dict-label').textContent = 'dictionary entry';
    } else {
      this.shadow.getElementById('selecta-dict-term').textContent = 'Summary';
      this.shadow.getElementById('selecta-dict-label').textContent = 'passage digest';
    }

    explanationEl.textContent = '';
    explanationEl.classList.add('loading');

    // Make visible
    this.overlayElement.classList.remove('hidden');
    this.overlayElement.classList.add('visible');

    // Dismiss events
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('mousedown', this.handleMouseDown);

    // Cancel active connection if any
    if (this.currentPort) {
      this.currentPort.disconnect();
    }

    // Connect to background script
    this.currentPort = chrome.runtime.connect({ name: 'selecta-stream' });
    
    // Initiate stream request
    this.currentPort.postMessage({
      type: 'start',
      mode,
      term,
      context,
      url: window.location.href
    });

    let currentText = '';

    this.currentPort.onMessage.addListener((msg) => {
      if (msg.type === 'chunk') {
        currentText += msg.text;
        explanationEl.classList.remove('loading');
        explanationEl.innerHTML = this.parseMarkdown(currentText);
      } else if (msg.type === 'error') {
        explanationEl.classList.remove('loading');
        explanationEl.innerHTML = `<span class="error-text">${msg.message}</span>`;
      } else if (msg.type === 'done') {
        explanationEl.classList.remove('loading');
        explanationEl.innerHTML = this.parseMarkdown(msg.text);
        
        // Enable follow-up inputs
        inputEl.disabled = false;
        this.shadow.getElementById('selecta-chat-send').disabled = false;
        inputEl.focus();
      }
    });
  }

  sendFollowup() {
    const inputEl = this.shadow.getElementById('selecta-chat-input');
    const text = inputEl.value.trim();
    if (!text || !this.currentPort) return;

    inputEl.value = '';
    inputEl.disabled = true;
    this.shadow.getElementById('selecta-chat-send').disabled = true;

    const messagesContainer = this.shadow.getElementById('selecta-chat-messages');

    // Append User message bubble
    const userBubble = document.createElement('div');
    userBubble.className = 'chat-bubble user';
    userBubble.textContent = text;
    messagesContainer.appendChild(userBubble);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Append Assistant response bubble template
    const assistantBubble = document.createElement('div');
    assistantBubble.className = 'chat-bubble assistant loading';
    messagesContainer.appendChild(assistantBubble);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Request stream
    this.currentPort.postMessage({ type: 'followup', text });

    let responseText = '';
    
    // Listen for incoming chunks for this turn
    const followupListener = (msg) => {
      if (msg.type === 'chunk') {
        responseText += msg.text;
        assistantBubble.classList.remove('loading');
        assistantBubble.innerHTML = this.parseMarkdown(responseText);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      } else if (msg.type === 'error') {
        assistantBubble.classList.remove('loading');
        assistantBubble.innerHTML = `<span class="error-text">${msg.message}</span>`;
        this.currentPort.onMessage.removeListener(followupListener);
      } else if (msg.type === 'done') {
        assistantBubble.classList.remove('loading');
        assistantBubble.innerHTML = this.parseMarkdown(msg.text);
        
        inputEl.disabled = false;
        this.shadow.getElementById('selecta-chat-send').disabled = false;
        inputEl.focus();
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        // Clean listener to avoid duplicates on next turn
        this.currentPort.onMessage.removeListener(followupListener);
      }
    };

    this.currentPort.onMessage.addListener(followupListener);
  }

  // Lightweight Regex-based Markdown-to-HTML parser (Outfit font styling only)
  parseMarkdown(text) {
    if (!text) return '';
    let html = text;

    // Prevent script insertion XSS
    html = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Parse blockquotes
    html = html.replace(/^&gt;\s+(.*)$/gim, '<blockquote>$1</blockquote>');

    // Parse Headers
    html = html.replace(/^### (.*)$/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*)$/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*)$/gim, '<h1>$1</h1>');

    // Parse bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Parse italics
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Parse inline code
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');

    // Parse unordered lists
    let lines = html.split('\n');
    let inList = false;
    for (let index = 0; index < lines.length; index++) {
      let line = lines[index].trim();
      if (line.startsWith('* ') || line.startsWith('- ')) {
        let content = line.substring(2);
        if (!inList) {
          lines[index] = '<ul><li>' + content + '</li>';
          inList = true;
        } else {
          lines[index] = '<li>' + content + '</li>';
        }
      } else {
        if (inList) {
          lines[index] = '</ul>' + lines[index];
          inList = false;
        }
      }
    }
    if (inList) {
      lines.push('</ul>');
    }
    html = lines.join('\n');

    // Convert paragraph splits
    html = html.split(/\n{2,}/).map(p => {
      p = p.trim();
      if (!p) return '';
      if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<blockquote') || p.startsWith('</ul')) {
        return p;
      }
      return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    }).filter(Boolean).join('');

    return html;
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
    document.removeEventListener('mousedown', this.handleMouseDown);
  }

  handleKeyDown(e) {
    if (e.key === 'Escape') {
      this.hide();
    }
  }

  handleMouseDown(e) {
    // Hide overlay if clicked outside shadow boundaries
    if (this.host && !this.host.contains(e.target) && !e.composedPath().includes(this.host)) {
      this.hide();
    }
  }

  pauseService() {
    chrome.storage.local.set({ enabled: false }, () => {
      this.hide();
    });
  }

  showPausedBadge() {
    this.init();
    const badge = this.shadow.getElementById('selecta-paused-badge');
    
    // Get stored theme
    chrome.storage.local.get({ theme: 'system' }, (res) => {
      let activeTheme = res.theme;
      if (activeTheme === 'system') {
        activeTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      this.overlayElement.setAttribute('data-theme', activeTheme);
      badge.setAttribute('data-theme', activeTheme);
    });

    if (badge) {
      badge.classList.add('visible');
    }
  }

  removePausedBadge() {
    if (!this.shadow) return;
    const badge = this.shadow.getElementById('selecta-paused-badge');
    if (badge) {
      badge.classList.remove('visible');
    }
  }

  async copyExplanation() {
    // Gather definition and follow-up text to copy
    const elements = this.shadow.querySelectorAll('.dictionary-definition, .chat-bubble.assistant');
    if (elements.length === 0) return;

    let textToCopy = '';
    elements.forEach((el, idx) => {
      const txt = el.textContent.trim();
      if (txt && txt !== 'Loading explanation...' && !txt.startsWith('API Key Required')) {
        if (idx === 0) {
          textToCopy += `Word: ${this.shadow.getElementById('selecta-dict-term').textContent}\nDefinition:\n${txt}`;
        } else {
          textToCopy += `\n\nFollow-up:\n${txt}`;
        }
      }
    });

    if (!textToCopy) return;

    try {
      await navigator.clipboard.writeText(textToCopy);
      const tooltip = this.shadow.getElementById('selecta-tooltip');
      tooltip.textContent = 'Copied!';
      setTimeout(() => {
        tooltip.textContent = 'Copy';
      }, 2000);
    } catch (err) {
      console.error('Copy to clipboard failed:', err);
    }
  }
}

// Global instance in content scope
window.selectaOverlay = new SelectaOverlay();
