// background.js

// Enable opening of the side panel when the extension icon is clicked
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Error setting panel behavior:', error));
});

// Listener for simple messages (e.g., API key validation)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'test_key') {
    testApiKey(message.apiKey).then(sendResponse);
    return true; // Indicates async response
  }
});

// Connection port handler for streaming completions
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'selecta-stream') return;

  let chatHistory = [];
  let systemPrompt = '';
  let initialTerm = '';
  let pageUrl = '';

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'start') {
      const { mode, term, context, url } = msg;
      initialTerm = term;
      pageUrl = url;

      // Get API Key from storage
      const storage = await chrome.storage.local.get(['apiKey']);
      if (!storage.apiKey) {
        port.postMessage({ 
          type: 'error', 
          message: 'API Key Required. Please click the Selecta extension icon to open the Side Panel and configure your DeepSeek API key.' 
        });
        return;
      }

      // Configure prompt based on mode
      if (mode === 'dictionary') {
        systemPrompt = 'You are a helpful, precise dictionary. Explain the selected term in a clean dictionary-style layout. Provide the part of speech, a concise definition, and optionally a brief usage example or key synonym. Use markdown formatting to make it look structured and readable. Do not add conversational filler.';
        chatHistory = [
          {
            role: 'user',
            content: `Term: ${term}\nContext: ${context}`
          }
        ];
      } else {
        systemPrompt = 'You are a concise AI text summarizer. Summarize the provided text in 2-3 brief bullet points using markdown. Keep it clear, readable, and structured. Do not add conversational filler.';
        chatHistory = [
          {
            role: 'user',
            content: `Text to summarize: ${term}`
          }
        ];
      }

      // Start stream
      runStream(port, systemPrompt, chatHistory, storage.apiKey, true);

    } else if (msg.type === 'followup') {
      const { text } = msg;

      // Add to conversation history
      chatHistory.push({ role: 'user', content: text });

      // Get API Key from storage
      const storage = await chrome.storage.local.get(['apiKey']);
      if (!storage.apiKey) {
        port.postMessage({ type: 'error', message: 'API Key is missing.' });
        return;
      }

      // Start stream for follow-up
      runStream(port, systemPrompt, chatHistory, storage.apiKey, false);
    }
  });

  // Helper to run DeepSeek completion stream
  async function runStream(port, systemPrompt, history, apiKey, isInitial) {
    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            ...history
          ],
          stream: true
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `API Error: ${response.status} ${response.statusText}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error && errorJson.error.message) {
            errorMessage = errorJson.error.message;
          }
        } catch (e) {}
        port.postMessage({ type: 'error', message: errorMessage });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let fullAssistantMessage = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Hold onto incomplete last line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === 'data: [DONE]') continue;

          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              const choice = data.choices[0];
              const content = choice.delta?.content || '';
              if (content) {
                fullAssistantMessage += content;
                port.postMessage({ type: 'chunk', text: content });
              }
            } catch (e) {
              console.error('Error parsing SSE line:', trimmed, e);
            }
          }
        }
      }

      // Flush remaining buffer
      if (buffer && buffer.startsWith('data: ')) {
        try {
          const trimmed = buffer.trim();
          if (trimmed !== 'data: [DONE]') {
            const data = JSON.parse(trimmed.slice(6));
            const choice = data.choices[0];
            const content = choice.delta?.content || '';
            if (content) {
              fullAssistantMessage += content;
              port.postMessage({ type: 'chunk', text: content });
            }
          }
        } catch (e) {}
      }

      // Save assistant message to local history array for follow-up turns
      chatHistory.push({ role: 'assistant', content: fullAssistantMessage });

      // If it is the initial lookup, write to storage history
      if (isInitial) {
        await saveToHistory(initialTerm, fullAssistantMessage, pageUrl);
      }

      port.postMessage({ type: 'done', text: fullAssistantMessage });

    } catch (err) {
      port.postMessage({ type: 'error', message: err.message || 'Failed to connect to DeepSeek API.' });
    }
  }
});

// Save lookup query to local history
async function saveToHistory(term, explanation, url) {
  try {
    const result = await chrome.storage.local.get({ history: [] });
    const history = result.history;

    const newEntry = {
      term,
      explanation,
      url,
      timestamp: new Date().toISOString()
    };

    // Prepend new entry
    history.unshift(newEntry);

    // Evict older entries if size exceeds 500
    if (history.length > 500) {
      history.pop();
    }

    await chrome.storage.local.set({ history });
    
    // Notify side panel if it is open
    chrome.runtime.sendMessage({ type: 'history_updated' }).catch(() => {
      // Ignore error if side panel is closed
    });
  } catch (e) {
    console.error('Failed to save history entry:', e);
  }
}

// Validate API Key
async function testApiKey(apiKey) {
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
      let errorMessage = `API Error: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error && errorJson.error.message) {
          errorMessage = errorJson.error.message;
        }
      } catch (e) {}
      return { success: false, error: errorMessage };
    }
  } catch (err) {
    return { success: false, error: err.message || 'Failed to contact DeepSeek API due to a network issue.' };
  }
}
