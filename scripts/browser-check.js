'use strict';

/**
 * Browser-level smoke test using jsdom.
 *
 * This is not a substitute for a real browser, but it does execute the actual
 * application scripts, drive the login form, render every route and catch
 * JavaScript errors, unhandled rejections and failed network requests.
 *
 *   node scripts/browser-check.js
 */

const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = process.env.BASE_URL || 'http://localhost:3101';
const USERNAME = process.env.CHECK_USER || 'admin';
const PASSWORD = process.env.CHECK_PASSWORD || 'Str0ng-Dev-Passw0rd!';
const NEW_PASSWORD = process.env.CHECK_NEW_PASSWORD || 'Rotated-Check-Passw0rd!';

const IGNORE = [
  /Could not parse CSS/i,
  /Not implemented: HTMLCanvasElement/i,
  /Not implemented: window\.print/i,
  /Error: Not implemented/i
];

async function main() {
  const errors = [];
  const network = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => {
    if (IGNORE.some(re => re.test(String(error.message)))) return;
    errors.push(`jsdomError: ${error.message}\n${error.detail?.stack || ''}`);
  });
  virtualConsole.on('error', (...args) => errors.push(`console.error: ${args.join(' ')}`));

  const dom = await JSDOM.fromURL(`${BASE}/`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      // jsdom does not share its cookie jar with Node's fetch, so the harness
      // keeps its own jar and forwards cookies exactly like a browser would.
      const jar = new Map();
      const cookieHeader = () => Array.from(jar.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
      window.fetch = async (input, init) => {
        const url = new URL(String(input), BASE).toString();
        const headers = Object.assign({}, init && init.headers, jar.size ? { cookie: cookieHeader() } : {});
        const response = await fetch(url, Object.assign({}, init, { headers }));
        const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
        for (const cookie of setCookies) {
          const [pair] = cookie.split(';');
          const index = pair.indexOf('=');
          const name = pair.slice(0, index).trim();
          const value = pair.slice(index + 1).trim();
          if (!value || /max-age=0/i.test(cookie)) jar.delete(name);
          else jar.set(name, value);
        }
        if (jar.size) {
          window.document.cookie = Array.from(jar.entries())
            .filter(([name]) => name === 'attendance_csrf')
            .map(([name, value]) => `${name}=${value}; path=/`)
            .join('; ');
        }
        if (!response.ok) network.push(`${init?.method || 'GET'} ${url} → ${response.status}`);
        return response;
      };
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
      window.navigator.vibrate = () => true;
    }
  });

  const { window } = dom;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  await new Promise(resolve => window.addEventListener('load', resolve));
  await wait(600);

  const assert = (condition, message) => {
    if (!condition) {
      errors.push(`ASSERTION FAILED: ${message}`);
      return false;
    }
    return true;
  };

  const doc = window.document;
  assert(doc.querySelector('.auth-card'), 'login card should render for anonymous visitors');
  assert(doc.querySelector('#login-identifier'), 'login form has username field');
  assert(!doc.querySelector('.app'), 'app shell must be hidden before login');

  // Sign in through the real form. The first sign-in with the bootstrap
  // administrator forces a password change, which this script also exercises.
  async function submitLogin(password) {
    doc.querySelector('#login-identifier').value = USERNAME;
    doc.querySelector('#login-password').value = password;
    doc.querySelector('.auth-card button[type=submit]').click();
    await wait(1600);
  }

  await submitLogin(PASSWORD);
  const loginError = doc.querySelector('.auth-card .auth-alert');
  if (!doc.querySelector('.app') && !doc.querySelector('#password-form') && loginError && loginError.textContent.trim()) {
    // The password may already have been rotated by a previous run of this check.
    await submitLogin(NEW_PASSWORD);
  }
  if (doc.querySelector('#password-form')) {
    const changeForm = doc.querySelector('#dialog-root #password-form') || doc.querySelector('#password-form');
    changeForm.querySelector('[name=currentPassword]').value = PASSWORD;
    changeForm.querySelector('[name=newPassword]').value = NEW_PASSWORD;
    changeForm.querySelector('[name=confirmPassword]').value = NEW_PASSWORD;
    doc.querySelector('.modal-foot button[type=submit]')?.click();
    await wait(1500);
    assert(!doc.querySelector('.app'), 'forced password change signs the user out again');
    await submitLogin(NEW_PASSWORD);
  } else if (!doc.querySelector('.app')) {
    await submitLogin(NEW_PASSWORD);
  }

  assert(doc.querySelector('.app'), 'application shell renders after sign-in');
  assert(doc.querySelector('.sidebar .nav-item'), 'navigation renders');
  assert(doc.querySelector('.stat-grid .stat'), 'dashboard statistics render');
  assert(/[0-9]/.test(doc.querySelector('.stat-value')?.textContent || ''), 'dashboard statistics contain numeric values');
  assert(doc.querySelector('.chart-svg'), 'dashboard charts render');

  const routes = ['attendance', 'students', 'qr', 'courses', 'lectures', 'reports', 'users', 'audit', 'settings', 'scanner'];
  for (const route of routes) {
    window.location.hash = `#/${route}`;
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    await wait(700);
    const view = doc.querySelector('#view');
    assert(view && view.children.length > 0, `route ${route} renders content`);
    const viewText = view ? view.textContent : '';
    assert(viewText.length > 40, `route ${route} renders text content`);
    if (/Something went wrong/.test(viewText)) errors.push(`route ${route} shows the error panel: ${viewText.slice(0, 200)}`);
    if (doc.querySelector('.modal-backdrop')) {
      errors.push(`route ${route} left an unexpected modal open after navigation`);
    }
  }

  // Language toggle
  window.location.hash = '#/dashboard';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await wait(500);
  const langToggle = doc.querySelector('#lang-toggle');
  assert(langToggle, 'language toggle renders');
  if (langToggle) langToggle.click();
  await wait(500);
  assert(doc.documentElement.lang === 'en', 'language switch changes document language');
  assert(doc.documentElement.dir === 'ltr', 'language switch sets LTR direction');
  doc.querySelector('#lang-toggle')?.click();
  await wait(500);
  assert(doc.documentElement.dir === 'rtl', 'language switch returns to RTL');

  // Open a student modal through the search field and close it.
  window.location.hash = '#/students';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await wait(800);
  const profileButton = doc.querySelector('[data-profile]');
  assert(profileButton, 'student rows render with a profile action');
  if (profileButton) {
    profileButton.click();
    await wait(900);
    assert(doc.querySelector('.modal-backdrop'), 'student profile modal opens');
    doc.querySelector('.modal-close')?.click();
    await wait(300);
    assert(!doc.querySelector('.modal-backdrop'), 'modal closes');
  }

  window.close();

  const relevantNetwork = network.filter(line => !/favicon/.test(line));
  console.log(`\nRoutes checked: ${routes.length + 1}`);
  if (relevantNetwork.length) console.log(`Non-2xx requests:\n  ${relevantNetwork.join('\n  ')}`);
  if (errors.length) {
    console.error(`\n${errors.length} problem(s) found:\n- ${errors.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nNo JavaScript errors, failed assertions or unexpected modals. UI smoke test passed.');
  }
  void errors;
}

main().catch(error => {
  console.error('Browser check crashed:', error);
  process.exit(1);
});
