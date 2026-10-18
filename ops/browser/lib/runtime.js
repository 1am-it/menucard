'use strict';

// Local runtime for the isolated #59 browser fixture: a bounded `next dev`
// process and a locally installed Edge/Chrome controlled through CDP. No
// production environment, identity or data is involved.

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { fetchJson, waitForHttp } = require('./cdp');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const BROWSER_CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findBrowser() {
  return BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
}

function killTree(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

async function startServer({ port, appUrl, outputDir }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const log = fs.createWriteStream(path.join(outputDir, 'next-dev.log'));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npm, ['run', 'dev', '--', '-p', String(port)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon-key-not-a-secret',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  await waitForHttp(`${appUrl}/internal/source-triage/batch`, 120000);
  return child;
}

async function startBrowser(browserPath) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'menucard-browser-'));
  const child = spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const webSocketUrl = await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`browser_debug_endpoint_timeout: ${stderr.slice(-400)}`)), 30000);
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`browser_exited: ${code}`));
    });
  });

  const httpBase = `http://${new URL(webSocketUrl).host}`;
  const target = await fetchJson(`${httpBase}/json/new?about:blank`, { method: 'PUT' });
  const version = await fetchJson(`${httpBase}/json/version`);
  return { child, userDataDir, httpBase, target, version };
}

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return { width: null, height: null };
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function evalJs(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
    throw new Error(`evaluate_failed: ${text || result.exceptionDetails.text}`);
  }
  return result.result.value;
}

async function waitFor(cdp, expression, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evalJs(cdp, expression)) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function navigate(cdp, url, readyExpression) {
  await cdp.send('Page.navigate', { url });
  const ready = await waitFor(cdp, `document.readyState !== 'loading' && (${readyExpression})`, 45000);
  if (!ready) {
    const text = await evalJs(cdp, 'document.body ? document.body.innerText.slice(0, 800) : ""');
    throw new Error(`page_not_ready: ${url}\n${text}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function screenshot(cdp, outputDir, name) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const buffer = Buffer.from(result.data, 'base64');
  fs.writeFileSync(path.join(outputDir, name), buffer);
  return { file: name, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), ...pngSize(buffer) };
}

async function pressKey(cdp, key, code, virtualKeyCode, text) {
  const base = { key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(text ? { text } : {}) });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function tabUntil(cdp, targetText, maxTabs = 60) {
  const seen = [];
  for (let i = 0; i < maxTabs; i += 1) {
    await pressKey(cdp, 'Tab', 'Tab', 9);
    const info = await evalJs(cdp, `(() => {
      const el = document.activeElement;
      if (!el) return null;
      return { tag: el.tagName, text: (el.innerText || '').trim().slice(0, 100), href: el.getAttribute('href'), expanded: el.getAttribute('aria-expanded') };
    })()`);
    if (info) {
      seen.push(info);
      if (info.text.includes(targetText)) return { info, tabs: i + 1, seen };
    }
  }
  return { info: null, tabs: maxTabs, seen };
}

module.exports = {
  REPO_ROOT,
  findBrowser,
  killTree,
  startServer,
  startBrowser,
  evalJs,
  waitFor,
  navigate,
  screenshot,
  pressKey,
  tabUntil,
};
