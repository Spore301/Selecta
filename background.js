// Configure Side Panel behavior to open on action click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Error setting panel behavior:", error));

// Automatically inject extension scripts into existing tabs on install/update
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const tab of tabs) {
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.includes('chromewebstore.google.com') || tab.url.includes('chrome.google.com/webstore')) {
        continue;
      }
      try {
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['overlay.css']
        });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['overlay.js', 'content.js']
        });
      } catch (err) {
        console.warn(`[Selecta] Skipping injection on tab ${tab.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[Selecta] Tab query on install failed:", err);
  }
});

// Message listener for popup/settings actions (e.g. testing the API key)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'validate-key') {
    validateApiKey(message.apiKey)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message || "Unknown error" }));
    return true; // Keep message channel open for async response
  }
});

// Helper to validate a DeepSeek API key
async function validateApiKey(apiKey) {
  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Ping' }],
        max_tokens: 5
      })
    });

    if (response.ok) {
      return { success: true };
    } else {
      const errorText = await response.text();
      let errorMsg = `API Error: ${response.status} ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error && errorJson.error.message) {
          errorMsg = errorJson.error.message;
        }
      } catch (e) {}
      return { success: false, error: errorMsg };
    }
  } catch (err) {
    return { success: false, error: err.message || 'Network connection failed' };
  }
}

// Connection listener for page-wide text lookup streams
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'selecta-stream') return;

  const tabId = port.sender && port.sender.tab ? port.sender.tab.id : 'default';
  const sessionKey = `selecta_session_${tabId}`;

  port.isDisconnected = false;
  port.onDisconnect.addListener(() => {
    port.isDisconnected = true;
  });

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'start') {
      const { term, context, mode, selectedText, url } = msg;

      // Securely fetch API key from storage
      const storage = await chrome.storage.local.get({ apiKey: '' });
      const apiKey = storage.apiKey;

      if (!apiKey) {
        port.postMessage({
          type: 'error',
          message: 'API Key Required. Open the Selecta Side Panel (click the extension icon) to configure your DeepSeek API key.'
        });
        return;
      }

      // Prepare appropriate prompts based on current mode
      let systemPrompt = '';
      let userPrompt = '';

      if (mode === 'summarize') {
        systemPrompt = `You are a concise AI text summarizer. Summarize the provided text in 2–3 brief bullet points using markdown. Keep it clear, readable, and structured. Do not add conversational filler.`;
        userPrompt = `Text to summarize: ${selectedText}`;
      } else {
        systemPrompt = `You are a helpful, context-aware AI reading companion. Explain the selected text or term clearly to clarify the user's doubts. Use the surrounding context to provide a highly relevant, structured explanation. Use markdown formatting to make it readable and clear. Do not add conversational filler.`;
        userPrompt = `Selected Text: ${term}\nSurrounding Context: ${context}`;
      }

      const conversation = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];
      const resolvedTerm = term || (selectedText ? selectedText.slice(0, 30) + '...' : 'Text Selection');

      // Initialize session store
      await chrome.storage.local.set({
        [sessionKey]: {
          conversation,
          url,
          term: resolvedTerm
        }
      });

      // Trigger streaming completion
      await streamDeepSeek(port, apiKey, conversation, sessionKey);

    } else if (msg.type === 'chat') {
      const { text } = msg;

      // Securely fetch API key from storage
      const storage = await chrome.storage.local.get({ apiKey: '' });
      const apiKey = storage.apiKey;

      if (!apiKey) {
        port.postMessage({ type: 'error', message: 'API Key is missing.' });
        return;
      }

      const sessionData = await chrome.storage.local.get(sessionKey);
      const session = sessionData[sessionKey];

      if (!session || !session.conversation) {
        port.postMessage({ type: 'error', message: 'No active chat session found.' });
        return;
      }

      const conversation = session.conversation;
      conversation.push({ role: 'user', content: text });

      // Save immediate state
      session.conversation = conversation;
      await chrome.storage.local.set({ [sessionKey]: session });

      // Trigger streaming completion for follow-up
      await streamDeepSeek(port, apiKey, conversation, sessionKey);
    }
  });
});

// Orchestrates SSE fetch stream and communicates with content script port
async function streamDeepSeek(port, apiKey, conversation, sessionKey) {
  try {
    if (port.isDisconnected) return;

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: conversation,
        stream: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `API Error: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error && errorJson.error.message) {
          errorMsg = errorJson.error.message;
        }
      } catch (e) {}
      if (!port.isDisconnected) {
        port.postMessage({ type: 'error', message: errorMsg });
      }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let responseText = '';

    while (true) {
      if (port.isDisconnected) {
        reader.cancel();
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep last incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed === 'data: [DONE]') continue;

        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const content = data.choices[0]?.delta?.content || '';
            if (content) {
              responseText += content;
              if (!port.isDisconnected) {
                port.postMessage({ type: 'chunk', text: content });
              } else {
                reader.cancel();
                return;
              }
            }
          } catch (e) {
            console.error('Error parsing stream chunk:', trimmed, e);
          }
        }
      }
    }

    // Process leftover buffer
    if (buffer && buffer.startsWith('data: ')) {
      const trimmed = buffer.trim();
      if (trimmed !== 'data: [DONE]') {
        try {
          const data = JSON.parse(trimmed.slice(6));
          const content = data.choices[0]?.delta?.content || '';
          if (content && !port.isDisconnected) {
            responseText += content;
            port.postMessage({ type: 'chunk', text: content });
          }
        } catch (e) {}
      }
    }

    // Save final response text to current session memory
    conversation.push({ role: 'assistant', content: responseText });

    if (!port.isDisconnected) {
      // Notify completion
      port.postMessage({ type: 'done', fullText: responseText });

      // Save this lookup to History in chrome.storage.local
      // We only save primary lookups (not individual counter-chats)
      // (length === 3: system, user, assistant)
      if (conversation.length === 3) {
        const sessionData = await chrome.storage.local.get(sessionKey);
        const session = sessionData[sessionKey] || {};
        await saveLookupToHistory(session.term || 'Text Selection', responseText, session.url || '');
      }
    }

    // Persist updated conversation memory
    const sessionData = await chrome.storage.local.get(sessionKey);
    const session = sessionData[sessionKey] || {};
    session.conversation = conversation;
    await chrome.storage.local.set({ [sessionKey]: session });

  } catch (err) {
    if (!port.isDisconnected) {
      port.postMessage({ type: 'error', message: err.message || 'A network error occurred' });
    }
  }
}

// Save lookup to history local storage (Max 500 records, FIFO eviction)
async function saveLookupToHistory(term, explanation, url) {
  try {
    const data = await chrome.storage.local.get({ history: [] });
    const history = data.history;

    const newRecord = {
      term: term,
      explanation: explanation,
      url: url || '',
      timestamp: new Date().toISOString()
    };

    // Prepend to display in reverse-chronological order
    history.unshift(newRecord);

    if (history.length > 500) {
      history.pop();
    }

    await chrome.storage.local.set({ history });
  } catch (e) {
    console.error('Error saving history record:', e);
  }
}

// Cleanup tab session storage when tab is closed
chrome.tabs.onRemoved.addListener((closedTabId) => {
  chrome.storage.local.remove(`selecta_session_${closedTabId}`);
});
