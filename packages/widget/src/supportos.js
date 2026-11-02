/**
 * SupportOS Embeddable Live Chat Widget (supportos.js)
 * High-performance, zero-dependency embeddable script for customer websites.
 */
(function () {
  'use strict';

  // Read configuration from the current script tag
  const currentScript =
    document.currentScript ||
    (function () {
      const scripts = document.getElementsByTagName('script');
      return scripts[scripts.length - 1];
    })();

  const inboxKey = currentScript?.getAttribute('data-inbox-key') || window.SUPPORTOS_INBOX_KEY;
  const apiUrl =
    currentScript?.getAttribute('data-api-url') ||
    window.SUPPORTOS_API_URL ||
    'http://localhost:4000';

  if (!inboxKey) {
    console.warn('[SupportOS] Widget disabled: missing data-inbox-key attribute.');
    return;
  }

  // Session state storage
  const STORAGE_KEY = `supportos_session_${inboxKey}`;
  let sessionState = {
    conversationId: null,
    visitorToken: null,
    customerName: null,
    customerEmail: null,
  };

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) sessionState = JSON.parse(saved);
  } catch (e) {}

  if (!sessionState.visitorToken) {
    sessionState.visitorToken = 'vis_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionState));
    } catch (e) {}
  }

  let isOpen = false;
  let inboxConfig = {
    name: 'Live Chat',
    widgetColor: '#2563EB',
    greeting: 'Hi there! How can we help you today?',
    organizationName: 'Support',
  };
  let messageList = [];
  let pollInterval = null;

  // 1. Inject Styles
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    #supportos-widget-root {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    #supportos-launcher-btn {
      width: 58px;
      height: 58px;
      border-radius: 29px;
      background: #2563EB;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
      border: none;
      color: #fff;
      outline: none;
    }
    #supportos-launcher-btn:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
    }
    #supportos-chat-window {
      position: fixed;
      bottom: 96px;
      right: 24px;
      width: 380px;
      height: 580px;
      max-height: calc(100vh - 120px);
      max-width: calc(100vw - 32px);
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.16), 0 0 0 1px rgba(0, 0, 0, 0.05);
      display: none;
      flex-direction: column;
      overflow: hidden;
      animation: supportos-slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    @keyframes supportos-slide-up {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .supportos-header {
      background: #2563EB;
      color: #ffffff;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .supportos-header-title {
      font-size: 15px;
      font-weight: 600;
    }
    .supportos-header-sub {
      font-size: 12px;
      opacity: 0.85;
      margin-top: 2px;
    }
    .supportos-close-btn {
      background: transparent;
      border: none;
      color: #fff;
      cursor: pointer;
      opacity: 0.8;
      padding: 4px;
    }
    .supportos-close-btn:hover { opacity: 1; }
    .supportos-messages-container {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      background: #f8fafc;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .supportos-bubble {
      max-width: 82%;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 14px;
      line-height: 1.45;
      word-break: break-word;
    }
    .supportos-bubble.customer {
      align-self: flex-end;
      background: #2563EB;
      color: #ffffff;
      border-bottom-right-radius: 2px;
    }
    .supportos-bubble.agent {
      align-self: flex-start;
      background: #ffffff;
      color: #0f172a;
      border: 1px solid #e2e8f0;
      border-bottom-left-radius: 2px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    }
    .supportos-bubble.system {
      align-self: center;
      background: #e2e8f0;
      color: #475569;
      font-size: 12px;
      border-radius: 8px;
    }
    .supportos-sender-label {
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 2px;
      opacity: 0.75;
    }
    .supportos-composer {
      padding: 12px 16px;
      background: #ffffff;
      border-top: 1px solid #e2e8f0;
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .supportos-input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid #cbd5e1;
      border-radius: 20px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .supportos-input:focus {
      border-color: #2563EB;
    }
    .supportos-send-btn {
      background: #2563EB;
      border: none;
      color: #ffffff;
      width: 36px;
      height: 36px;
      border-radius: 18px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .supportos-welcome-form {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      background: #ffffff;
      flex: 1;
    }
    .supportos-form-input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 14px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
    }
    .supportos-form-input:focus {
      border-color: #2563EB;
    }
    .supportos-start-btn {
      background: #2563EB;
      color: #ffffff;
      border: none;
      padding: 12px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      font-size: 14px;
      margin-top: 4px;
    }
    .supportos-powered-by {
      text-align: center;
      font-size: 11px;
      color: #94a3b8;
      padding: 8px;
      background: #ffffff;
      border-top: 1px solid #f1f5f9;
    }
  `;
  document.head.appendChild(styleEl);

  // 2. Build DOM Elements
  const root = document.createElement('div');
  root.id = 'supportos-widget-root';

  const launcher = document.createElement('button');
  launcher.id = 'supportos-launcher-btn';
  launcher.setAttribute('aria-label', 'Open customer support chat');
  launcher.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
  `;

  const chatWindow = document.createElement('div');
  chatWindow.id = 'supportos-chat-window';
  chatWindow.innerHTML = `
    <div class="supportos-header">
      <div>
        <div class="supportos-header-title" id="supportos-title">Live Support</div>
        <div class="supportos-header-sub" id="supportos-sub">We usually reply in minutes</div>
      </div>
      <button class="supportos-close-btn" id="supportos-close-btn" aria-label="Close chat">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    <div id="supportos-body-container" style="display: flex; flex-direction: column; flex: 1; overflow: hidden;">
      <!-- Welcome Form or Message Stream will render here -->
    </div>
    <div class="supportos-powered-by">
      Powered by <strong>SupportOS</strong>
    </div>
  `;

  root.appendChild(chatWindow);
  root.appendChild(launcher);
  document.body.appendChild(root);

  const bodyContainer = chatWindow.querySelector('#supportos-body-container');
  const closeBtn = chatWindow.querySelector('#supportos-close-btn');

  // Toggle Window
  function toggleChat() {
    isOpen = !isOpen;
    chatWindow.style.display = isOpen ? 'flex' : 'none';
    if (isOpen) {
      if (sessionState.conversationId) {
        renderMessageStream();
        fetchMessages();
        startPolling();
      } else {
        renderWelcomeForm();
      }
    } else {
      stopPolling();
    }
  }

  launcher.addEventListener('click', toggleChat);
  closeBtn.addEventListener('click', toggleChat);

  // Fetch configuration
  async function loadConfig() {
    try {
      const res = await fetch(`${apiUrl}/api/v1/public/inbox-config/${inboxKey}`);
      if (res.ok) {
        const data = await res.json();
        inboxConfig = data.inbox;
        if (inboxConfig.widgetColor) {
          launcher.style.background = inboxConfig.widgetColor;
          const header = chatWindow.querySelector('.supportos-header');
          if (header) header.style.background = inboxConfig.widgetColor;
        }
        const titleEl = chatWindow.querySelector('#supportos-title');
        if (titleEl) titleEl.innerText = inboxConfig.name || 'Support';
      }
    } catch (e) {
      console.warn('[SupportOS] Could not reach support API server.');
    }
  }
  loadConfig();

  // Render Pre-Chat / Welcome Form
  function renderWelcomeForm() {
    bodyContainer.innerHTML = `
      <div class="supportos-welcome-form">
        <p style="font-size: 14px; color: #475569; margin: 0 0 8px 0;">${inboxConfig.greeting}</p>
        <input class="supportos-form-input" id="supportos-form-name" placeholder="Your Name" value="${sessionState.customerName || ''}" required />
        <input class="supportos-form-input" id="supportos-form-email" type="email" placeholder="Your Email Address" value="${sessionState.customerEmail || ''}" required />
        <textarea class="supportos-form-input" id="supportos-form-msg" placeholder="How can we help you?" rows="3" required></textarea>
        <button class="supportos-start-btn" id="supportos-start-btn">Start Conversation</button>
      </div>
    `;

    const startBtn = bodyContainer.querySelector('#supportos-start-btn');
    startBtn.addEventListener('click', async () => {
      const name = bodyContainer.querySelector('#supportos-form-name').value.trim();
      const email = bodyContainer.querySelector('#supportos-form-email').value.trim();
      const msg = bodyContainer.querySelector('#supportos-form-msg').value.trim();

      if (!msg) {
        alert('Please enter a message.');
        return;
      }

      startBtn.disabled = true;
      startBtn.innerText = 'Connecting...';

      try {
        const res = await fetch(`${apiUrl}/api/v1/public/conversations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inboxKey,
            visitorToken: sessionState.visitorToken,
            name: name || 'Visitor',
            email: email || undefined,
            message: msg,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          sessionState.conversationId = data.conversationId;
          sessionState.customerName = name;
          sessionState.customerEmail = email;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionState));

          renderMessageStream();
          fetchMessages();
          startPolling();
        } else {
          alert('Could not start conversation. Please try again.');
          startBtn.disabled = false;
          startBtn.innerText = 'Start Conversation';
        }
      } catch (e) {
        alert('Connection error. Please try again.');
        startBtn.disabled = false;
        startBtn.innerText = 'Start Conversation';
      }
    });
  }

  // Render Message Stream
  function renderMessageStream() {
    bodyContainer.innerHTML = `
      <div class="supportos-messages-container" id="supportos-messages-list">
        <div style="text-align: center; color: #94a3b8; font-size: 13px; margin: 12px 0;">
          Conversation started
        </div>
      </div>
      <div class="supportos-composer">
        <input class="supportos-input" id="supportos-reply-input" placeholder="Type a message..." />
        <button class="supportos-send-btn" id="supportos-reply-btn" aria-label="Send reply">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    `;

    const input = bodyContainer.querySelector('#supportos-reply-input');
    const sendBtn = bodyContainer.querySelector('#supportos-reply-btn');

    async function handleSend() {
      const text = input.value.trim();
      if (!text || !sessionState.conversationId) return;

      input.value = '';

      // Optimistic append
      messageList.push({
        id: 'opt_' + Date.now(),
        senderType: 'CUSTOMER',
        senderName: sessionState.customerName || 'You',
        content: text,
        createdAt: new Date().toISOString(),
      });
      updateMessagesUI();

      try {
        await fetch(`${apiUrl}/api/v1/public/conversations/${sessionState.conversationId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            senderName: sessionState.customerName || 'You',
          }),
        });
        fetchMessages();
      } catch (e) {
        console.error('[SupportOS] Send message failed:', e);
      }
    }

    sendBtn.addEventListener('click', handleSend);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSend();
    });
  }

  // Fetch Message History
  async function fetchMessages() {
    if (!sessionState.conversationId) return;
    try {
      const res = await fetch(`${apiUrl}/api/v1/public/conversations/${sessionState.conversationId}`);
      if (res.ok) {
        const data = await res.json();
        messageList = data.conversation.messages || [];
        updateMessagesUI();
      }
    } catch (e) {}
  }

  function updateMessagesUI() {
    const listEl = bodyContainer.querySelector('#supportos-messages-list');
    if (!listEl) return;

    let html = `
      <div style="text-align: center; color: #94a3b8; font-size: 13px; margin: 12px 0;">
        Connected to ${inboxConfig.name || 'Support'}
      </div>
    `;

    messageList.forEach((msg) => {
      const isCustomer = msg.senderType === 'CUSTOMER';
      const roleClass = isCustomer ? 'customer' : msg.senderType === 'SYSTEM' ? 'system' : 'agent';
      const sender = isCustomer ? 'You' : msg.senderName || 'Support Agent';

      html += `
        <div class="supportos-bubble ${roleClass}">
          ${!isCustomer ? `<div class="supportos-sender-label">${escapeHtml(sender)}</div>` : ''}
          ${escapeHtml(msg.content)}
        </div>
      `;
    });

    listEl.innerHTML = html;
    listEl.scrollTop = listEl.scrollHeight;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function startPolling() {
    stopPolling();
    pollInterval = setInterval(fetchMessages, 3000);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  console.log('[SupportOS] Live chat widget initialized.');
})();
