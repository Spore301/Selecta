// sidepanel.js

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initSettings();
  loadHistory();
  initStorageListener();
});

// 1. Navigation Tab Switches
function initTabs() {
  const btnHistory = document.getElementById('tab-history');
  const btnSettings = document.getElementById('tab-settings');
  const paneHistory = document.getElementById('pane-history');
  const paneSettings = document.getElementById('pane-settings');

  btnHistory.addEventListener('click', () => {
    btnHistory.classList.add('active');
    btnSettings.classList.remove('active');
    paneHistory.classList.remove('hidden');
    paneSettings.classList.add('hidden');
  });

  btnSettings.addEventListener('click', () => {
    btnSettings.classList.add('active');
    btnHistory.classList.remove('active');
    paneSettings.classList.remove('hidden');
    paneHistory.classList.add('hidden');
  });
}

// 2. Settings Synchronization & Custom Event Handlers
async function initSettings() {
  const serviceToggle = document.getElementById('service-toggle');
  const apiKeyInput = document.getElementById('api-key-input');
  const toggleKeyBtn = document.getElementById('toggle-key-visibility');
  const testKeyBtn = document.getElementById('test-key-btn');
  const modeSelect = document.getElementById('mode-select');
  const sliderGroup = document.getElementById('slider-group');
  const limitSlider = document.getElementById('word-limit-slider');
  const limitVal = document.getElementById('word-limit-val');
  const blocklistInput = document.getElementById('blocklist-input');
  const themeSelect = document.getElementById('theme-select');
  const clearHistoryBtn = document.getElementById('clear-history-btn');

  // Load current values
  const settings = await chrome.storage.local.get({
    enabled: true,
    apiKey: '',
    mode: 'auto',
    wordLimit: 30,
    blocklist: '',
    theme: 'system'
  });

  // Apply service state toggle
  serviceToggle.checked = settings.enabled;
  updateStatusText(settings.enabled);
  serviceToggle.addEventListener('change', () => {
    const isEnabled = serviceToggle.checked;
    chrome.storage.local.set({ enabled: isEnabled });
    updateStatusText(isEnabled);
  });

  // Apply API Key field
  apiKeyInput.value = settings.apiKey;
  
  // Password Visibility Toggle
  toggleKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
    } else {
      apiKeyInput.type = 'password';
    }
  });

  // API Key Testing
  testKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    showValidationMsg('testing', 'Testing key, please wait...');

    testKeyBtn.disabled = true;
    document.getElementById('test-spinner').classList.remove('hidden');
    document.getElementById('test-btn-text').textContent = 'Testing...';

    chrome.runtime.sendMessage({ type: 'validate-key', apiKey: key }, (response) => {
      testKeyBtn.disabled = false;
      document.getElementById('test-spinner').classList.add('hidden');
      document.getElementById('test-btn-text').textContent = 'Test & Save';

      if (response && response.success) {
        chrome.storage.local.set({ apiKey: key }, () => {
          showValidationMsg('success', 'Key tested and saved successfully!');
        });
      } else {
        const errorMsg = (response && response.error) ? response.error : 'Invalid API key or network error.';
        showValidationMsg('error', errorMsg);
      }
    });
  });

  // Apply companion Mode
  modeSelect.value = settings.mode;
  toggleSliderVisibility(settings.mode, sliderGroup);
  
  modeSelect.addEventListener('change', () => {
    const selectedMode = modeSelect.value;
    chrome.storage.local.set({ mode: selectedMode });
    toggleSliderVisibility(selectedMode, sliderGroup);
  });

  // Apply Word Limit Slider
  limitSlider.value = settings.wordLimit;
  limitVal.textContent = `${settings.wordLimit} words`;
  
  limitSlider.addEventListener('input', () => {
    const limit = parseInt(limitSlider.value, 10);
    limitVal.textContent = `${limit} words`;
    chrome.storage.local.set({ wordLimit: limit });
  });

  // Apply Blocklist
  blocklistInput.value = settings.blocklist;
  blocklistInput.addEventListener('input', () => {
    chrome.storage.local.set({ blocklist: blocklistInput.value });
  });

  // Apply Theme Selector
  themeSelect.value = settings.theme;
  applyTheme(settings.theme);
  themeSelect.addEventListener('change', () => {
    chrome.storage.local.set({ theme: themeSelect.value });
    applyTheme(themeSelect.value);
  });

  // Danger Zone: Clear History
  clearHistoryBtn.addEventListener('click', () => {
    if (confirm("Are you sure you want to clear your lookup history? This cannot be undone.")) {
      chrome.storage.local.set({ history: [] }, () => {
        loadHistory();
      });
    }
  });
}

// 3. History Retrieval & Layout Rendering
async function loadHistory(searchQuery = '') {
  const historyList = document.getElementById('history-list');
  const data = await chrome.storage.local.get({ history: [] });
  const items = data.history;

  // Clear listing
  historyList.innerHTML = '';

  const filteredItems = items.filter(item => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const termMatch = item.term && item.term.toLowerCase().includes(query);
    const explMatch = item.explanation && item.explanation.toLowerCase().includes(query);
    return termMatch || explMatch;
  });

  if (filteredItems.length === 0) {
    historyList.innerHTML = `
      <div class="history-empty">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <span>${searchQuery ? 'No search matches found.' : 'No lookups recorded yet.<br>Select text on any webpage to begin.'}</span>
      </div>
    `;
    return;
  }

  // Render cards
  filteredItems.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'history-item';
    
    const formattedDate = new Date(item.timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    card.innerHTML = `
      <div class="history-item-header">
        <span class="history-term" title="${escapeHtml(item.term)}">${escapeHtml(item.term)}</span>
        <span class="history-time">${formattedDate}</span>
      </div>
      <div class="history-explanation" id="exp-${index}">${escapeHtml(item.explanation)}</div>
      <div class="history-footer">
        <a class="history-url" href="${escapeHtml(item.url)}" target="_blank" title="${escapeHtml(item.url)}">${getDomain(item.url)}</a>
        <button class="delete-item-btn" id="del-${index}" title="Delete record">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;

    historyList.appendChild(card);

    // Expand/Collapse description toggle
    const explDiv = card.querySelector(`#exp-${index}`);
    explDiv.addEventListener('click', () => {
      explDiv.classList.toggle('expanded');
    });

    // Delete item trigger
    card.querySelector(`#del-${index}`).addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Remove lookup for "${item.term}"?`)) {
        await deleteHistoryItem(item.timestamp);
      }
    });
  });
}

// History delete item helper
async function deleteHistoryItem(timestamp) {
  const data = await chrome.storage.local.get({ history: [] });
  const updatedHistory = data.history.filter(item => item.timestamp !== timestamp);
  await chrome.storage.local.set({ history: updatedHistory });
  loadHistory(document.getElementById('search-input').value.trim());
}

// 4. Live Search Bindings
document.getElementById('search-input').addEventListener('input', (e) => {
  const val = e.target.value.trim();
  loadHistory(val);
});

// Helper: Toggle status text label
function updateStatusText(enabled) {
  const label = document.getElementById('status-text');
  label.textContent = enabled ? 'Selecta Active' : 'Selecta Paused';
}

// Helper: Show validation notifications
function showValidationMsg(type, text) {
  const msgDiv = document.getElementById('validation-msg');
  msgDiv.className = 'validation-msg'; // reset classes
  msgDiv.classList.remove('hidden');

  if (type === 'success') {
    msgDiv.classList.add('success');
    msgDiv.textContent = text;
  } else if (type === 'error') {
    msgDiv.classList.add('error');
    msgDiv.textContent = text;
  } else {
    // testing message
    msgDiv.textContent = text;
  }
}

// Helper: Toggle slider visibility
function toggleSliderVisibility(mode, sliderGroup) {
  if (mode === 'auto') {
    sliderGroup.classList.remove('hidden');
  } else {
    sliderGroup.classList.add('hidden');
  }
}

// Helper: Apply dark/light/system theme
function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    // system theme matching
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  }
}

// Helper: Storage Change Listener (updates listings automatically when background saves lookups)
function initStorageListener() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.history) {
        const query = document.getElementById('search-input').value.trim();
        loadHistory(query);
      }
      if (changes.enabled) {
        document.getElementById('service-toggle').checked = changes.enabled.newValue;
        updateStatusText(changes.enabled.newValue);
      }
    }
  });
}

// Helper: Extract domain label from raw URL
function getDomain(urlStr) {
  if (!urlStr) return 'Local Page';
  try {
    const url = new URL(urlStr);
    return url.hostname.replace('www.', '');
  } catch (e) {
    return 'Webpage';
  }
}

// Helper: Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
