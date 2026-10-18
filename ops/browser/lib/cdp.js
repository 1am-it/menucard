'use strict';

// Minimal Chrome DevTools Protocol client for the isolated #59 browser check.
// It intentionally has no dependency: the repository has no Playwright package,
// and the check only needs navigation, DOM evaluation, keyboard input and
// screenshots against a locally installed Edge/Chrome.

class CdpClient {
  constructor(webSocketUrl) {
    this.url = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.closed = false;
    this.ws = new WebSocket(webSocketUrl);
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cdp_open_timeout')), 15000);
      this.ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(new Error(`cdp_open_error: ${event && event.message ? event.message : 'unknown'}`));
      });
    });
    this.ws.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
      } else if (message.method) {
        this.events.push(message);
      }
    });
    this.ws.addEventListener('close', () => {
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(new Error('cdp_closed'));
      this.pending.clear();
    });
  }

  async send(method, params = {}) {
    await this.ready;
    if (this.closed) throw new Error('cdp_closed');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`cdp_timeout: ${method}`));
      }, 30000);
    });
  }

  takeEvents(method) {
    const found = this.events.filter((event) => event.method === method);
    this.events = this.events.filter((event) => event.method !== method);
    return found;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // Already closed.
    }
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`http_${response.status}: ${url}`);
  return response.json();
}

async function waitForHttp(url, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok) return response;
      lastError = new Error(`http_${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`server_unreachable: ${lastError ? lastError.message : 'timeout'}`);
}

module.exports = { CdpClient, fetchJson, waitForHttp };
