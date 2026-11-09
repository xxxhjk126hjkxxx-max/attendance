/* ==========================================================================
   Application shell: authentication, layout, navigation and routing.
   ========================================================================== */
(function () {
  'use strict';
  const { el, $, $$, icon, i18n, api, state, setState, toast, modal, confirmDialog, escapeHtml, initials } = window.App;
  const root = document.getElementById('root');

  // ------------------------------------------------------------ navigation
  const NAV = [
    { group: 'nav.group.main', items: [
      { route: 'dashboard', icon: 'grid', label: 'nav.overview', permission: 'dashboard.view' },
      { route: 'attendance', icon: 'clipboard', label: 'nav.attendance', permission: 'attendance.view' },
      { route: 'scanner', icon: 'scan', label: 'nav.scanner', permission: 'attendance.mark' }
    ] },
    { group: 'nav.group.academic', items: [
      { route: 'students', icon: 'users', label: 'nav.students', permission: 'students.view' },
      { route: 'qr', icon: 'qr', label: 'nav.qr', permission: 'qr.view' },
      { route: 'courses', icon: 'book', label: 'nav.courses', permission: 'courses.view' },
      { route: 'lectures', icon: 'calendar', label: 'nav.lectures', permission: 'lectures.view' },
      { route: 'reports', icon: 'chart', label: 'nav.reports', permission: 'reports.view' }
    ] },
    { group: 'nav.group.admin', items: [
      { route: 'users', icon: 'shield', label: 'nav.users', permission: 'users.manage' },
      { route: 'audit', icon: 'history', label: 'nav.audit', permission: 'audit.view' },
      { route: 'settings', icon: 'settings', label: 'nav.settings', permission: 'settings.manage' }
    ] }
  ];

  function can(permission) {
    return Boolean(state.user && (state.user.permissions || []).includes(permission));
  }

  function routeFromHash() {
    const hash = location.hash.replace(/^#\/?/, '').split('?')[0];
    return hash || 'dashboard';
  }
  function hashOf(route) {
    return `#/${route}`;
  }
  function navigate(route, { replace = false } = {}) {
    if (replace) history.replaceState(null, '', hashOf(route));
    else location.hash = hashOf(route);
  }

  // ------------------------------------------------------------ auth flows
  function loginView({ notice } = {}) {
    const t = i18n.t;
    const form = el('form', { class: 'auth-card', novalidate: true, 'aria-labelledby': 'login-title' });
    const alertBox = el('div', { class: 'auth-alert' + (notice ? ' warn' : ''), role: 'alert', style: notice ? '' : 'display:none', text: notice || '' });
    form.innerHTML = `
      <div class="seal" aria-hidden="true">IUA</div>
      <h2 id="login-title">${escapeHtml(t('login.title'))}</h2>
      <p class="sub">${escapeHtml(t('login.subtitle'))}</p>
      <div class="auth-alert" role="alert" style="display:none"></div>
      <div class="form-field" data-field="identifier" style="margin-bottom:14px">
        <label for="login-identifier">${escapeHtml(t('login.identifier'))}</label>
        <input id="login-identifier" name="identifier" class="field" type="text" autocomplete="username" required
               autocapitalize="none" spellcheck="false" placeholder="admin">
        <span class="error"></span>
      </div>
      <div class="form-field" data-field="password" style="margin-bottom:8px">
        <label for="login-password">${escapeHtml(t('login.password'))}</label>
        <input id="login-password" name="password" class="field" type="password" autocomplete="current-password" required>
        <span class="error"></span>
      </div>
      <div class="auth-links">
        <button type="button" class="btn-ghost btn btn-sm" data-forgot>${escapeHtml(t('login.forgot'))}</button>
        <span></span>
      </div>
      <button class="btn btn-primary btn-lg btn-block" type="submit" style="margin-top:14px">${escapeHtml(t('login.submit'))}</button>
      <p class="auth-hint">${escapeHtml(t('login.demo'))}</p>
    `;
    const errorBox = form.querySelector('.auth-alert');
    const showError = message => { errorBox.textContent = message; errorBox.style.display = 'flex'; };

    form.querySelector('[data-forgot]').addEventListener('click', () => forgotPasswordFlow());

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = form.querySelector('button[type=submit]');
      const identifier = form.querySelector('[name=identifier]').value.trim();
      const passwordInput = form.querySelector('[name=password]');
      const password = passwordInput.value;
      errorBox.style.display = 'none';
      if (!identifier || !password) return showError(t('login.required'));
      submit.setAttribute('aria-busy', 'true');
      try {
        const result = await api.post('/api/auth/login', { identifier, password });
        setState({ user: result.user, csrf: result.csrfToken });
        // renderApp opens the forced password dialog when the account requires it.
        renderApp();
      } catch (error) {
        showError(error.status === 429 ? t('login.throttled') : (error.message || t('login.invalid')));
        passwordInput.value = '';
        passwordInput.focus();
      } finally {
        submit.removeAttribute('aria-busy');
      }
    });

    const aside = el('aside', { class: 'auth-aside' });
    aside.innerHTML = `
      <div class="auth-brand">
        <div class="seal" aria-hidden="true">IUA</div>
        <div>
          <b>${escapeHtml(i18n.lang === 'ar' ? 'جامعة أفريقيا العالمية' : 'International University of Africa')}</b>
          <small>${escapeHtml(t('app.tagline'))}</small>
        </div>
      </div>
      <div class="auth-hero">
        <h1>${escapeHtml(t('login.hero'))}</h1>
        <p>${escapeHtml(t('login.heroText'))}</p>
        <div class="auth-features">
          <div class="auth-feature"><span class="dot">✓</span><span>${escapeHtml(t('login.feature1'))}</span></div>
          <div class="auth-feature"><span class="dot">✓</span><span>${escapeHtml(t('login.feature2'))}</span></div>
          <div class="auth-feature"><span class="dot">✓</span><span>${escapeHtml(t('login.feature3'))}</span></div>
        </div>
      </div>
      <div class="auth-foot">${escapeHtml(t('footer.note'))} · ${new Date().getFullYear()}</div>
    `;

    const main = el('main', { class: 'auth-main' }, [form]);
    const wrapper = el('div', { class: 'auth' }, [aside, main]);
    const langButton = el('button', { class: 'lang-toggle', type: 'button', style: 'position:fixed;top:20px;inset-inline-end:24px;z-index:5' });
    langButton.innerHTML = `${icon('globe', 15)}<span>${i18n.lang === 'ar' ? 'English' : 'العربية'}</span>`;
    langButton.addEventListener('click', () => { i18n.setLang(i18n.lang === 'ar' ? 'en' : 'ar'); renderAuthScreens(); });
    wrapper.appendChild(langButton);
    return wrapper;
  }

  async function forgotPasswordFlow() {
    const t = i18n.t;
    const body = el('div', { class: 'form-grid cols-1' });
    body.innerHTML = `
      <p class="text-muted" style="font-size:12.5px">${escapeHtml(t('login.subtitle'))}</p>
      <div class="form-field"><label for="fp-id">${escapeHtml(t('login.identifier'))}</label>
        <input id="fp-id" class="field" name="identifier" autocomplete="username"></div>
    `;
    const ref = modal({
      title: t('login.forgot'), size: '',
      body,
      footer: [
        el('button', { class: 'btn', type: 'button', text: t('common.cancel'), 'data-close-modal': '' }),
        el('button', {
          class: 'btn btn-primary', type: 'button', text: t('common.confirm'),
          onclick: async event => {
            const button = event.currentTarget;
            button.setAttribute('aria-busy', 'true');
            try {
              const result = await api.post('/api/auth/forgot-password', { identifier: body.querySelector('#fp-id').value.trim() });
              ref.close();
              toast(result.message, { type: 'success' });
            } catch (error) {
              toast(error.message, { type: 'error' });
            } finally { button.removeAttribute('aria-busy'); }
          }
        })
      ]
    });
  }

  function passwordModal({ forced = false } = {}) {
    const t = i18n.t;
    const form = el('form', { class: 'form-grid cols-1', novalidate: true });
    form.innerHTML = `
      ${forced ? `<div class="auth-alert warn" style="margin-bottom:4px">${escapeHtml(t('password.requiredText'))}</div>` : ''}
      <div class="form-field" data-field="currentPassword"><label>${escapeHtml(t('password.current'))} <span class="req">*</span></label>
        <input class="field" type="password" name="currentPassword" autocomplete="current-password" required></div>
      <div class="form-field" data-field="newPassword"><label>${escapeHtml(t('password.new'))} <span class="req">*</span></label>
        <input class="field" type="password" name="newPassword" autocomplete="new-password" required minlength="12">
        <span class="hint">${escapeHtml(t('users.passwordHint'))}</span></div>
      <div class="form-field" data-field="confirmPassword"><label>${escapeHtml(t('password.confirm'))} <span class="req">*</span></label>
        <input class="field" type="password" name="confirmPassword" autocomplete="new-password" required></div>
    `;
    const ref = modal({
      title: t('password.title'), subtitle: forced ? t('password.requiredTitle') : t('password.sub'),
      body: form, closeOnBackdrop: !forced,
      footer: [
        forced ? null : el('button', { class: 'btn', type: 'button', text: t('common.cancel'), 'data-close-modal': '' }),
        el('button', { class: 'btn btn-primary', type: 'submit', text: t('password.submit'), form: 'password-form' })
      ].filter(Boolean),
      onClose: () => { if (forced) signOut(true); }
    });
    form.id = 'password-form';
    const footerButton = ref.footer.querySelector('button[type=submit]');
    footerButton.addEventListener('click', () => form.requestSubmit());
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const data = window.App.formData(form);
      if (data.newPassword !== data.confirmPassword) {
        return window.App.fieldErrors(form, { confirmPassword: t('password.mismatch') });
      }
      if (data.newPassword.length < 12) {
        return window.App.fieldErrors(form, { newPassword: t('password.weak') });
      }
      window.App.busy(footerButton, true);
      try {
        await api.post('/api/auth/change-password', { currentPassword: data.currentPassword, newPassword: data.newPassword });
        ref.close();
        toast(t('password.changed'), { type: 'success' });
        setTimeout(() => signOut(true), 400);
      } catch (error) {
        if (error.fields) window.App.fieldErrors(form, error.fields);
        else toast(error.message, { type: 'error' });
      } finally {
        window.App.busy(footerButton, false);
      }
    });
    return ref;
  }
  const openPasswordModal = passwordModal;

  async function signOut(skipNotice) {
    try { await api.post('/api/auth/logout', {}); } catch { /* session may already be gone */ }
    setState({ user: null, csrf: null });
    renderAuthScreens(skipNotice ? { notice: i18n.t('password.changed') } : {});
  }

  function forcedSessionHandler() {
    setState({ user: null, csrf: null });
    if (location.hash !== '#/login') {
      toast(i18n.t('error.session'), { type: 'warn' });
    }
    renderAuthScreens();
  }
  window.App.onUnauthorized.add(forcedSessionHandler);

  let lastAuthProps = {};
  function renderAuthScreens(props) {
    if (props) lastAuthProps = props;
    root.replaceChildren(loginView(lastAuthProps));
  }

  // ------------------------------------------------------------ layout
  function sidebar() {
    const t = i18n.t;
    const aside = el('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': t('app.name') });
    const head = el('div', { class: 'sidebar-head' });
    head.innerHTML = `
      <div class="seal" aria-hidden="true">IUA</div>
      <div class="sidebar-title">
        <b>${escapeHtml(i18n.lang === 'ar' ? 'جامعة أفريقيا العالمية' : 'International University of Africa')}</b>
        <small>${escapeHtml(t('app.tagline'))}</small>
      </div>
    `;
    const toggle = el('button', {
      class: 'sidebar-toggle', type: 'button', 'aria-label': 'Toggle sidebar', 'aria-expanded': 'true',
      html: icon(i18n.lang === 'ar' ? 'chevronRight' : 'chevronLeft')
    });
    aside.appendChild(head);
    aside.appendChild(toggle);

    const nav = el('nav', { class: 'nav', 'aria-label': t('app.dept') });
    NAV.forEach(group => {
      const items = group.items.filter(item => can(item.permission));
      if (!items.length) return;
      nav.appendChild(el('div', { class: 'sidebar-section', text: t(group.group) }));
      items.forEach(item => {
        const button = el('a', {
          class: 'nav-item' + (state.route === item.route ? ' active' : ''),
          href: hashOf(item.route),
          'data-route': item.route,
          'aria-current': state.route === item.route ? 'page' : null
        });
        button.innerHTML = `<span class="nav-icon">${icon(item.icon)}</span><span class="nav-label">${escapeHtml(t(item.label))}</span>`;
        button.addEventListener('click', () => { aside.classList.remove('open'); removeBackdrop(); });
        nav.appendChild(button);
      });
    });
    aside.appendChild(nav);

    const foot = el('div', { class: 'sidebar-foot' });
    const user = state.user || {};
    foot.innerHTML = `
      <div class="sidebar-user">
        <span class="avatar" aria-hidden="true">${escapeHtml(initials(user.fullName || user.username))}</span>
        <div class="meta">
          <b>${escapeHtml(user.fullName || user.username || '')}</b>
          <small>${escapeHtml((user.roleLabel && user.roleLabel[i18n.lang]) || user.role || '')}</small>
        </div>
      </div>
      <div class="sidebar-actions">
        <button class="icon-btn" type="button" data-action="password" aria-label="${escapeHtml(t('password.title'))}" title="${escapeHtml(t('password.title'))}">${icon('lock')}</button>
        <button class="icon-btn" type="button" data-action="logout" aria-label="${escapeHtml(t('logout'))}" title="${escapeHtml(t('logout'))}">${icon('logout')}</button>
      </div>
    `;
    foot.querySelector('[data-action=logout]').addEventListener('click', () => signOut());
    foot.querySelector('[data-action=password]').addEventListener('click', () => passwordModal());
    aside.appendChild(foot);
    return aside;
  }

  function removeBackdrop() {
    const existing = $('.backdrop');
    if (existing) existing.remove();
    document.body.classList.remove('no-scroll');
  }
  function backdrop(onClick) {
    removeBackdrop();
    const node = el('div', { class: 'backdrop' });
    node.addEventListener('click', onClick);
    document.body.appendChild(node);
    return node;
  }

  const TITLES = {
    dashboard: ['dash.eyebrow', 'dash.title'],
    attendance: ['nav.attendance', 'attendance.title'],
    scanner: ['nav.scanner', 'scanner.title'],
    students: ['nav.students', 'students.title'],
    qr: ['nav.qr', 'qr.title'],
    courses: ['nav.courses', 'courses.title'],
    lectures: ['nav.lectures', 'lectures.title'],
    reports: ['nav.reports', 'reports.title'],
    users: ['nav.users', 'users.title'],
    audit: ['nav.audit', 'audit.title'],
    settings: ['nav.settings', 'settings.title']
  };

  function topbar() {
    const t = i18n.t;
    const bar = el('header', { class: 'topbar' });
    const [eyebrow, title] = TITLES[state.route] || ['nav.group.main', 'app.name'];
    bar.innerHTML = `
      <button class="icon-btn light menu-btn" type="button" id="menu-btn" aria-label="${escapeHtml(t('nav.group.main'))}" aria-expanded="false">${icon('menu')}</button>
      <div class="breadcrumb">
        <span>${escapeHtml(t(eyebrow))}</span>
        <span class="sep">/</span>
        <b>${escapeHtml(t(title))}</b>
      </div>
      <div class="topbar-spacer"></div>
      <div class="topbar-tools">
        <label class="searchbox" for="global-search">
          ${icon('search')}
          <input id="global-search" type="search" placeholder="${escapeHtml(t('common.searchPlaceholder'))}" aria-label="${escapeHtml(t('common.search'))}">
        </label>
        <button class="lang-toggle" type="button" id="lang-toggle" aria-label="Switch language">
          ${icon('globe', 15)}<span>${i18n.lang === 'ar' ? 'English' : 'العربية'}</span>
        </button>
        <button class="icon-btn light" type="button" id="refresh-btn" aria-label="${escapeHtml(t('error.retry'))}" title="${escapeHtml(t('error.retry'))}">${icon('refresh')}</button>
      </div>
    `;
    bar.querySelector('#lang-toggle').addEventListener('click', () => {
      i18n.setLang(i18n.lang === 'ar' ? 'en' : 'ar');
      renderApp();
    });
    bar.querySelector('#refresh-btn').addEventListener('click', () => renderApp());
    bar.querySelector('#menu-btn').addEventListener('click', event => {
      const side = $('#sidebar');
      const isOpen = side.classList.toggle('open');
      event.currentTarget.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) backdrop(() => { side.classList.remove('open'); removeBackdrop(); });
      else removeBackdrop();
    });
    const globalSearch = bar.querySelector('#global-search');
    globalSearch.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      const term = globalSearch.value.trim();
      if (!term) return;
      location.hash = `#/students?search=${encodeURIComponent(term)}`;
    });
    return bar;
  }

  function renderApp() {
    if (!state.user) return renderAuthScreens();
    const shell = el('div', { class: 'app' });
    shell.appendChild(sidebar());
    const main = el('div', { class: 'main' });
    main.appendChild(topbar());
    const page = el('main', { class: 'page', id: 'view', tabindex: '-1' });
    main.appendChild(page);
    shell.appendChild(main);
    root.replaceChildren(shell);

    const view = (window.Views && window.Views[state.route]) || window.Views.notFound;
    view(page, new URLSearchParams(location.hash.split('?')[1] || ''));
    if (state.user.mustChangePassword) openPasswordModal({ forced: true });
  }

  // ------------------------------------------------------------ bootstrap
  async function boot() {
    try {
      const session = await api.get('/api/auth/session', { silentAuth: true });
      setState({ user: session.user, csrf: session.csrfToken });
      renderApp();
    } catch (error) {
      setState({ user: null });
      renderAuthScreens();
    }
  }

  window.addEventListener('hashchange', () => {
    const route = routeFromHash();
    state.route = route;
    if (!state.user) return renderAuthScreens();
    if (!window.Views || !window.Views[route]) {
      setState({});
      return renderApp();
    }
    renderApp();
    $('#view')?.focus?.();
  });

  document.addEventListener('languagechange', () => {
    if (state.user) renderApp();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      const side = $('#sidebar');
      if (side && side.classList.contains('open')) { side.classList.remove('open'); removeBackdrop(); }
    }
  });

  window.Navigate = navigate;
  window.SignOut = signOut;
  window.Can = can;

  state.route = routeFromHash();
  if (!window.Views) window.Views = {};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
