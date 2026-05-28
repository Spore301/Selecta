// background.js

// Configure Side Panel behavior to open on action click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Error setting panel behavior:", error));

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
        systemPrompt = `You are a helpful, precise dictionary. Explain the selected term in a clean dictionary-style layout. Provide the part of speech, a concise definition, and optionally a brief usage example or key synonym. Use markdown formatting to make it look structured and readable. Do not add conversational filler.`;
        userPrompt = `Term: ${term}\nContext: ${context}`;
      }

      // Initialize port conversation memory
      port.conversation = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];
      port.url = url;
      port.term = term || (selectedText ? selectedText.slice(0, 30) + '...' : 'Text Selection');

      // Trigger streaming completion
      await streamDeepSeek(port, apiKey);

    } else if (msg.type === 'chat') {
      const { text } = msg;

      // Securely fetch API key from storage
      const storage = await chrome.storage.local.get({ apiKey: '' });
      const apiKey = storage.apiKey;

      if (!apiKey) {
        port.postMessage({ type: 'error', message: 'API Key is missing.' });
        return;
      }

      if (!port.conversation) {
        port.postMessage({ type: 'error', message: 'No active chat session found.' });
        return;
      }

      // Add follow-up question to messages
      port.conversation.push({ role: 'user', content: text });

      // Trigger streaming completion for follow-up
      await streamDeepSeek(port, apiKey);
    }
  });
});

// Orchestrates SSE fetch stream and communicates with content script port
async function streamDeepSeek(port, apiKey) {
  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: port.conversation,
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
      port.postMessage({ type: 'error', message: errorMsg });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let responseText = '';

    while (true) {
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
              port.postMessage({ type: 'chunk', text: content });
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
          if (content) {
            responseText += content;
            port.postMessage({ type: 'chunk', text: content });
          }
        } catch (e) {}
      }
    }

    // Save final response text to current session memory
    port.conversation.push({ role: 'assistant', content: responseText });

    // Notify completion
    port.postMessage({ type: 'done', fullText: responseText });

    // Save this lookup to History in chrome.storage.local
    // We only save primary lookups (not individual counter-chats)
    // We detect if this was the first assistant response in conversation
    // (length === 3: system, user, assistant)
    if (port.conversation.length === 3) {
      await saveLookupToHistory(port.term, responseText, port.url);
    }

  } catch (err) {
    port.postMessage({ type: 'error', message: err.message || 'A network error occurred' });
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
