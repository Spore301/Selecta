// sidepanel.js

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const tabHistory = document.getElementById('tab-history');
  const tabSettings = document.getElementById('tab-settings');
  const paneHistory = document.getElementById('pane-history');
  const paneSettings = document.getElementById('pane-settings');

  const toggleService = document.getElementById('toggle-service');
  const historySearch = document.getElementById('history-search');
  const historyList = document.getElementById('history-list');
  const historyEmpty = document.getElementById('history-empty');

  const inputApiKey = document.getElementById('input-api-key');
  const btnSaveKey = document.getElementById('btn-save-key');
  const btnSaveText = document.getElementById('btn-save-text');
  const btnSaveSpinner = document.getElementById('btn-save-spinner');
  const keyStatusMsg = document.getElementById('key-status-msg');
  const toggleKeyVisibility = document.getElementById('toggle-key-visibility');

  const selectMode = document.getElementById('select-mode');
  const groupSlider = document.getElementById('group-slider');
  const inputSlider = document.getElementById('input-slider');
  const sliderValueDisplay = document.getElementById('slider-value-display');
  const sliderDescription = document.getElementById('slider-description');

  const inputBlocklist = document.getElementById('input-blocklist');
  const selectTheme = document.getElementById('select-theme');
  const btnClearHistory = document.getElementById('btn-clear-history');

  let activeHistory = [];

  // --- Initial Configuration & State Loader ---
  function init() {
    // Load Settings
    chrome.storage.local.get({
      enabled: true,
      apiKey: '',
      mode: 'auto',
      wordLimit: 30,
      blocklist: '',
      theme: 'system'
    }, (settings) => {
      // Toggle
      toggleService.checked = settings.enabled;
      
      // API Key
      inputApiKey.value = settings.apiKey;
      
      // Mode & Slider
      selectMode.value = settings.mode;
      inputSlider.value = settings.wordLimit;
      updateSliderUI(settings.mode, settings.wordLimit);

      // Blocklist
      inputBlocklist.value = settings.blocklist;

      // Theme
      selectTheme.value = settings.theme;
      applyTheme(settings.theme);

      // Load lookup history list
      loadHistory();
    });

    // Setup listener for history changes reported by background worker
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'history_updated') {
        loadHistory();
      }
    });
  }

  // --- Theme Management ---
  function applyTheme(theme) {
    let activeTheme = theme;
    if (theme === 'system') {
      activeTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.body.setAttribute('data-theme', activeTheme);
  }

  selectTheme.addEventListener('change', () => {
    const val = selectTheme.value;
    chrome.storage.local.set({ theme: val }, () => {
      applyTheme(val);
    });
  });

  // Watch system preferences changes if 'system' is selected
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (selectTheme.value === 'system') {
      applyTheme('system');
    }
  });

  // --- Navigation Controls ---
  tabHistory.addEventListener('click', () => {
    tabHistory.classList.add('active');
    tabSettings.classList.remove('active');
    paneHistory.classList.remove('hidden');
    paneSettings.classList.add('hidden');
    loadHistory(); // Refresh lists when opening tab
  });

  tabSettings.addEventListener('click', () => {
    tabSettings.classList.add('active');
    tabHistory.classList.remove('active');
    paneSettings.classList.remove('hidden');
    paneHistory.classList.add('hidden');
  });

  // --- Service Toggle ON/OFF ---
  toggleService.addEventListener('change', () => {
    chrome.storage.local.set({ enabled: toggleService.checked });
  });

  // --- Mode & Slider Threshold Settings ---
  selectMode.addEventListener('change', () => {
    const mode = selectMode.value;
    const limit = parseInt(inputSlider.value, 10);
    chrome.storage.local.set({ mode });
    updateSliderUI(mode, limit);
  });

  inputSlider.addEventListener('input', () => {
    const mode = selectMode.value;
    const limit = parseInt(inputSlider.value, 10);
    chrome.storage.local.set({ wordLimit: limit });
    updateSliderUI(mode, limit);
  });

  function updateSliderUI(mode, limit) {
    sliderValueDisplay.textContent = `${limit} words`;
    sliderDescription.textContent = `Dictionary if selection <= ${limit} words, Summarize if larger.`;
    
    if (mode === 'auto') {
      groupSlider.classList.remove('disabled');
      inputSlider.disabled = false;
    } else {
      groupSlider.classList.add('disabled');
      inputSlider.disabled = true;
    }
  }

  // --- Site Blocklist Settings ---
  inputBlocklist.addEventListener('input', () => {
    chrome.storage.local.set({ blocklist: inputBlocklist.value });
  });

  // --- API Key Visiblity Toggle ---
  toggleKeyVisibility.addEventListener('click', (e) => {
    e.preventDefault();
    if (inputApiKey.type === 'password') {
      inputApiKey.type = 'text';
      toggleKeyVisibility.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
    } else {
      inputApiKey.type = 'password';
      toggleKeyVisibility.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    }
  });

  // --- Save & Test API Key ---
  btnSaveKey.addEventListener('click', () => {
    const key = inputApiKey.value.trim();
    if (!key) {
      showKeyStatus('Please enter a key.', 'error');
      return;
    }

    // Set loading spinner state
    btnSaveSpinner.classList.remove('hidden');
    btnSaveText.textContent = 'Testing...';
    btnSaveKey.disabled = true;
    showKeyStatus('', '');

    // Send key message to background context to execute test fetches (bypass CORS)
    chrome.runtime.sendMessage({ type: 'test_key', apiKey: key }, (res) => {
      // Revert loading states
      btnSaveSpinner.classList.add('hidden');
      btnSaveText.textContent = 'Test & Save';
      btnSaveKey.disabled = false;

      if (res && res.success) {
        chrome.storage.local.set({ apiKey: key }, () => {
          showKeyStatus('API Key is valid and saved!', 'success');
        });
      } else {
        const errorMsg = (res && res.error) ? res.error : 'Invalid API key validation test.';
        showKeyStatus(errorMsg, 'error');
      }
    });
  });

  function showKeyStatus(msg, type) {
    keyStatusMsg.textContent = msg;
    keyStatusMsg.className = 'validation-msg';
    if (type === 'success') {
      keyStatusMsg.classList.add('success');
    } else if (type === 'error') {
      keyStatusMsg.classList.add('error');
    }
  }

  // --- Clear History Control ---
  btnClearHistory.addEventListener('click', () => {
    if (confirm('Are you sure you want to permanently clear your lookup history?')) {
      chrome.storage.local.set({ history: [] }, () => {
        loadHistory();
      });
    }
  });

  // --- History Management & Render Functions ---
  function loadHistory() {
    chrome.storage.local.get({ history: [] }, (res) => {
      activeHistory = res.history;
      renderHistoryList(activeHistory);
    });
  }

  function renderHistoryList(items) {
    // Clear list but keep empty state element
    const emptyTemplate = historyEmpty.cloneNode(true);
    historyList.innerHTML = '';
    historyList.appendChild(emptyTemplate);

    const query = historySearch.value.trim().toLowerCase();
    
    // Filter history based on search query
    const filtered = items.filter(item => {
      return item.term.toLowerCase().includes(query) || 
             item.explanation.toLowerCase().includes(query);
    });

    if (filtered.length === 0) {
      emptyTemplate.style.display = 'flex';
      if (query) {
        emptyTemplate.querySelector('span').textContent = 'No lookups match your query.';
      } else {
        emptyTemplate.querySelector('span').innerHTML = 'No explanation history yet.<br>Select any text on a web page to begin.';
      }
      return;
    }

    emptyTemplate.style.display = 'none';

    filtered.forEach((item, index) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'history-item';
      
      const formattedTime = formatTimestamp(item.timestamp);
      const displayUrl = formatUrl(item.url);

      itemEl.innerHTML = `
        <div class="history-item-header">
          <span class="history-term" title="${item.term}">${escapeHtml(item.term)}</span>
          <span class="history-time">${formattedTime}</span>
        </div>
        <div class="history-explanation" title="Click to Expand/Collapse">${escapeHtml(item.explanation)}</div>
        <div class="history-footer">
          <a href="${item.url}" target="_blank" class="history-url" title="${item.url}">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 3px; display: inline; vertical-align: middle;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            ${escapeHtml(displayUrl)}
          </a>
          <button class="delete-item-btn" data-timestamp="${item.timestamp}" title="Delete Lookup">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      `;

      // Expand/Collapse text on click
      const explanationEl = itemEl.querySelector('.history-explanation');
      explanationEl.addEventListener('click', () => {
        explanationEl.classList.toggle('expanded');
      });

      // Individual deletion trigger
      const deleteBtn = itemEl.querySelector('.delete-item-btn');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const stamp = deleteBtn.getAttribute('data-timestamp');
        deleteHistoryItem(stamp);
      });

      historyList.appendChild(itemEl);
    });
  }

  function deleteHistoryItem(timestamp) {
    const updated = activeHistory.filter(item => item.timestamp !== timestamp);
    chrome.storage.local.set({ history: updated }, () => {
      loadHistory();
    });
  }

  // --- Real-time Search Handler ---
  historySearch.addEventListener('input', () => {
    renderHistoryList(activeHistory);
  });

  // --- String formatting helpers ---
  function formatTimestamp(isoString) {
    try {
      const date = new Date(isoString);
      const diffMs = Date.now() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  function formatUrl(urlString) {
    try {
      const url = new URL(urlString);
      return url.hostname.replace('www.', '');
    } catch (e) {
      return 'page';
    }
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Run initializer routines
  init();
});
