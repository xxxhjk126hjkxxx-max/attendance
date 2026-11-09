/* ==========================================================================
   Reports, administrator management, audit log and settings views.
   ========================================================================== */
(function () {
  'use strict';
  const A = window.App;
  const { el, $, $$, icon, i18n, api, state, toast, modal, confirmDialog, escapeHtml, formatNumber, formatPercent, formatDate, formatTime, todayIso, isoDaysAgo, statusBadge, emptyState, skeletonRows, errorState, pagination, initials } = A;
  const t = (key, vars) => i18n.t(key, vars);
  const { pageHead, button, card } = window.ViewHelpers;
  const Views = {};

  // ============================================================ REPORTS
  const reportFilters = { from: isoDaysAgo(29), to: todayIso(), courseId: '', studentId: '', status: '' };

  Views.reports = async function reportsView(target) {
    if (!window.Can('reports.view')) return Views.accessDenied(target);
    const exportButtons = window.Can('reports.export') ? [
      button(t('reports.exportPdf'), { iconName: 'file', onClick: () => download('pdf') }),
      button(t('reports.exportXlsx'), { variant: 'btn-primary', iconName: 'download', onClick: () => download('xlsx') })
    ] : [];
    target.replaceChildren(pageHead({
      eyebrow: t('nav.reports'), title: t('reports.title'), subtitle: t('reports.subtitle'), actions: exportButtons
    }));

    const filtersCard = el('section', { class: 'card', style: 'margin-bottom:18px' });
    filtersCard.innerHTML = `<div class="card-body">
      <div class="filters-bar">
        <div class="form-field" style="flex:1 1 150px"><label>${escapeHtml(t('common.from'))}</label>
          <input class="field" type="date" id="r-from" value="${reportFilters.from}"></div>
        <div class="form-field" style="flex:1 1 150px"><label>${escapeHtml(t('common.to'))}</label>
          <input class="field" type="date" id="r-to" value="${reportFilters.to}"></div>
        <div class="form-field" style="flex:1 1 200px"><label>${escapeHtml(t('common.course'))}</label>
          <select class="field" id="r-course"><option value="">${escapeHtml(t('common.all'))}</option></select></div>
        <div class="form-field" style="flex:1 1 180px"><label>${escapeHtml(t('common.student'))}</label>
          <select class="field" id="r-student"><option value="">${escapeHtml(t('common.all'))}</option></select></div>
        <div class="form-field" style="flex:0 1 150px"><label>${escapeHtml(t('common.status'))}</label>
          <select class="field" id="r-status"><option value="">${escapeHtml(t('common.all'))}</option>
          ${['present', 'late', 'excused', 'absent'].map(s => `<option value="${s}">${escapeHtml(t(`common.${s}`))}</option>`).join('')}</select></div>
        <div class="form-field" style="flex:0 0 auto"><label>&nbsp;</label>
          <button class="btn" id="r-apply">${icon('filter')}<span>${escapeHtml(t('common.apply'))}</span></button></div>
      </div>
    </div>`;
    target.appendChild(filtersCard);

    const summaryGrid = el('div', { class: 'stat-grid', id: 'r-stats' });
    target.appendChild(summaryGrid);
    const chartsRow = el('div', { class: 'two-col section-gap', id: 'r-charts' });
    target.appendChild(chartsRow);
    const tables = el('div', { class: 'stack section-gap', id: 'r-tables' });
    target.appendChild(tables);

    const courseSelect = $('#r-course', filtersCard);
    const studentSelect = $('#r-student', filtersCard);
    try {
      const options = await api.get('/api/reports/options');
      courseSelect.innerHTML = `<option value="">${escapeHtml(t('common.all'))}</option>` +
        options.courses.map(c => `<option value="${c.id}">${escapeHtml(c.code)} — ${escapeHtml(c.nameEn)}</option>`).join('');
      studentSelect.innerHTML = `<option value="">${escapeHtml(t('common.all'))}</option>` +
        options.students.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(s.id)})</option>`).join('');
    } catch (error) { toast(error.message, { type: 'error' }); }

    function query() {
      const params = new URLSearchParams({ from: reportFilters.from, to: reportFilters.to });
      if (reportFilters.courseId) params.set('courseId', reportFilters.courseId);
      if (reportFilters.studentId) params.set('studentId', reportFilters.studentId);
      if (reportFilters.status) params.set('status', reportFilters.status);
      return params;
    }

    function download(format) {
      const params = query();
      params.set('lang', i18n.lang);
      api.download(`/api/reports/export/${format}?${params}`, `attendance-report-${reportFilters.from}-${reportFilters.to}.${format}`)
        .catch(error => toast(error.message, { type: 'error' }));
    }

    async function load() {
      summaryGrid.innerHTML = Array.from({ length: 4 }, () => '<div class="skeleton sk-card"></div>').join('');
      try {
        const data = await api.get(`/api/reports/summary?${query()}`);
        const s = data.summary;
        summaryGrid.innerHTML = [
          ['common.present', s.present, '#258269', 'checkCircle'],
          ['common.absent', s.absent, '#B84545', 'x'],
          ['common.late', s.late, '#B8860B', 'clock'],
          ['common.attendanceRate', formatPercent(s.attendanceRate), '#C5A15B', 'activity']
        ].map(([label, value, accent, iconName]) => `
          <article class="stat" style="--accent:${accent}">
            <div class="stat-top"><span class="stat-label">${escapeHtml(t(label))}</span><span class="stat-icon">${icon(iconName)}</span></div>
            <div class="stat-value">${typeof value === 'number' ? formatNumber(value) : escapeHtml(String(value))}</div>
            <div class="stat-foot">${escapeHtml(t('common.lectures'))}: ${formatNumber(s.lectures)} · ${escapeHtml(t('common.enrolled'))}: ${formatNumber(s.roster)}</div>
          </article>`).join('');

        chartsRow.replaceChildren(
          card({
            title: t('reports.byDay'),
            body: data.byDay.length
              ? A.barChart(data.byDay.slice(0, 14).reverse().map(row => ({
                label: String(row.date).slice(5), value: row.marked,
                color: '#315B83', title: `${row.date}: ${row.marked}`
              })), { height: 220, ariaLabel: t('reports.byDay') })
              : emptyState({ title: t('reports.empty'), desc: t('reports.emptyDesc'), iconName: 'chart' })
          }),
          card({
            title: t('reports.summary'),
            body: A.donutChart([
              { label: t('common.present'), value: s.present, color: '#258269' },
              { label: t('common.late'), value: s.late, color: '#C5A15B' },
              { label: t('common.excused'), value: s.excused, color: '#315B83' },
              { label: t('common.absent'), value: s.absent, color: '#B84545' }
            ], { centerValue: formatNumber(s.marked), centerLabel: t('common.status'), size: 160, stroke: 20 })
          })
        );

        tables.replaceChildren(
          reportTable(t('reports.byCourse'), [
            [t('common.course'), row => escapeHtml(row.nameEn)],
            [t('common.present'), row => formatNumber(row.present)],
            [t('common.absent'), row => formatNumber(row.absent)],
            [t('common.attendanceRate'), row => formatPercent(row.attendanceRate)]
          ], data.byCourse),
          reportTable(t('reports.byStudent'), [
            [t('common.student'), row => `${escapeHtml(row.studentName)}<span class="sub mono">${escapeHtml(row.studentId)}</span>`],
            [t('common.present'), row => formatNumber(row.present)],
            [t('common.absent'), row => formatNumber(row.absent)],
            [t('common.attendanceRate'), row => formatPercent(row.attendanceRate)]
          ], data.byStudent.slice(0, 50))
        );
      } catch (error) {
        summaryGrid.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="card-body">${errorState(error.message)}</div></div>`;
        chartsRow.replaceChildren();
        tables.replaceChildren();
      }
    }

    function reportTable(title, columns, rows) {
      return card({
        title, padded: false,
        body: rows.length
          ? `<div class="table-wrap" style="max-height:380px;overflow:auto"><table class="data"><thead><tr>
              ${columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead>
              <tbody>${rows.map(row => `<tr>${columns.map(([, render]) => `<td>${render(row)}</td>`).join('')}</tr>`).join('')}</tbody>
            </table></div>`
          : emptyState({ title: t('reports.empty'), desc: t('reports.emptyDesc'), iconName: 'chart' })
      });
    }

    $('#r-apply', filtersCard).addEventListener('click', () => {
      reportFilters.from = $('#r-from', filtersCard).value;
      reportFilters.to = $('#r-to', filtersCard).value;
      reportFilters.courseId = courseSelect.value;
      reportFilters.studentId = studentSelect.value;
      reportFilters.status = $('#r-status', filtersCard).value;
      load();
    });
    load();
  };

  // ============================================================ USERS
  Views.users = async function usersView(target) {
    if (!window.Can('users.manage')) return Views.accessDenied(target);
    target.replaceChildren(pageHead({
      eyebrow: t('nav.users'), title: t('users.title'), subtitle: t('users.subtitle'),
      actions: [button(t('users.add'), { variant: 'btn-primary', iconName: 'plus', onClick: () => userForm(null, load) })]
    }));
    const body = el('div', {});
    target.appendChild(body);

    async function load() {
      body.innerHTML = `<div class="card"><div class="card-body">${skeletonRows(5)}</div></div>`;
      try {
        const data = await api.get('/api/users');
        if (!data.items.length) {
          body.innerHTML = `<div class="card"><div class="card-body">${emptyState({ title: t('empty.title'), desc: '', iconName: 'shield' })}</div></div>`;
          return;
        }
        const panel = el('section', { class: 'card' });
        panel.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
          <th>${escapeHtml(t('users.username'))}</th><th>${escapeHtml(t('users.role'))}</th>
          <th>${escapeHtml(t('common.status'))}</th><th>${escapeHtml(t('users.lastLogin'))}</th>
          <th style="text-align:end">${escapeHtml(t('common.actions'))}</th></tr></thead>
          <tbody>${data.items.map(user => `<tr>
            <td><div class="cell-user"><span class="avatar">${escapeHtml(initials(user.fullName))}</span>
              <div><b>${escapeHtml(user.fullName)}</b><span class="sub">@${escapeHtml(user.username)}${user.email ? ` · ${escapeHtml(user.email)}` : ''}</span></div></div></td>
            <td><span class="badge ${user.role === 'super_admin' ? 'gold' : user.role === 'admin' ? 'navy' : 'excused'}">${escapeHtml(t(`users.role.${user.role}`))}</span>
              ${user.mustChangePassword ? `<span class="sub" style="color:var(--amber)">${escapeHtml(t('users.mustChange'))}</span>` : ''}</td>
            <td><span class="badge ${user.status === 'active' ? 'present' : 'absent'}">${escapeHtml(t(`users.status.${user.status}`))}</span></td>
            <td class="text-muted">${user.lastLoginAt ? formatDate(user.lastLoginAt, { withTime: true }) : escapeHtml(t('common.never'))}</td>
            <td class="actions-cell">
              <button class="btn btn-sm" data-edit="${user.id}" aria-label="${escapeHtml(t('common.edit'))}">${icon('edit')}</button>
              <button class="btn btn-sm btn-danger" data-del="${user.id}" data-name="${escapeHtml(user.fullName)}" aria-label="${escapeHtml(t('common.delete'))}">${icon('trash')}</button>
            </td></tr>`).join('')}</tbody></table></div>`;
        body.replaceChildren(panel);
        $$('[data-edit]', panel).forEach(node => node.addEventListener('click', () => {
          const user = data.items.find(item => String(item.id) === node.dataset.edit);
          userForm(user, load);
        }));
        $$('[data-del]', panel).forEach(node => node.addEventListener('click', async () => {
          const ok = await confirmDialog({ title: t('users.deleteTitle'), text: t('users.deleteText', { name: node.dataset.name }), confirmLabel: t('common.delete') });
          if (!ok) return;
          try {
            await api.del(`/api/users/${node.dataset.del}`);
            toast(t('users.deleted'), { type: 'success' });
            load();
          } catch (error) { toast(error.message, { type: 'error' }); }
        }));
      } catch (error) {
        body.innerHTML = `<div class="card"><div class="card-body">${errorState(error.message)}</div></div>`;
      }
    }
    load();
  };

  function userForm(user, onDone) {
    const form = el('form', { class: 'form-grid', novalidate: true });
    form.innerHTML = `
      <div class="form-field" data-field="username"><label>${escapeHtml(t('users.username'))} <span class="req">*</span></label>
        <input class="field" name="username" value="${escapeHtml(user?.username || '')}" ${user ? 'readonly' : 'required'} maxlength="40" autocapitalize="none"><span class="error"></span></div>
      <div class="form-field" data-field="fullName"><label>${escapeHtml(t('users.fullName'))} <span class="req">*</span></label>
        <input class="field" name="fullName" value="${escapeHtml(user?.fullName || '')}" required maxlength="120"><span class="error"></span></div>
      <div class="form-field" data-field="email"><label>${escapeHtml(t('common.email'))}</label>
        <input class="field" name="email" type="email" value="${escapeHtml(user?.email || '')}" maxlength="160"><span class="error"></span></div>
      <div class="form-field" data-field="role"><label>${escapeHtml(t('users.role'))}</label>
        <select class="field" name="role">${['super_admin', 'admin', 'instructor'].map(role => `<option value="${role}" ${user?.role === role ? 'selected' : ''}>${escapeHtml(t(`users.role.${role}`))}</option>`).join('')}</select>
        <span class="error"></span></div>
      ${user ? `<div class="form-field" data-field="status"><label>${escapeHtml(t('common.status'))}</label>
        <select class="field" name="status"><option value="active" ${user.status === 'active' ? 'selected' : ''}>${escapeHtml(t('users.status.active'))}</option>
        <option value="disabled" ${user.status === 'disabled' ? 'selected' : ''}>${escapeHtml(t('users.status.disabled'))}</option></select></div>` : ''}
      <div class="form-field span-2" data-field="password"><label>${escapeHtml(t('users.password'))}${user ? ' — ' + escapeHtml(t('users.resetPassword')) : ' *'}</label>
        <input class="field" name="password" type="password" autocomplete="new-password" ${user ? '' : 'required'} minlength="12">
        <span class="hint">${escapeHtml(t('users.passwordHint'))}</span><span class="error"></span></div>`;
    const submit = el('button', { class: 'btn btn-primary', type: 'button', text: user ? t('common.save') : t('users.add') });
    const ref = modal({
      title: user ? t('users.edit') : t('users.add'), body: form, size: 'wide',
      footer: [el('button', { class: 'btn', type: 'button', text: t('common.cancel'), 'data-close-modal': '' }), submit]
    });
    submit.addEventListener('click', async () => {
      A.busy(submit, true);
      const data = A.formData(form);
      try {
        if (user) {
          if (!data.password) delete data.password;
          await api.put(`/api/users/${user.id}`, data);
          toast(t('users.updated'), { type: 'success' });
        } else {
          await api.post('/api/users', data);
          toast(t('users.created'), { type: 'success' });
        }
        ref.close();
        onDone && onDone();
      } catch (error) {
        if (error.fields) A.fieldErrors(form, error.fields);
        toast(error.message, { type: 'error' });
      } finally { A.busy(submit, false); }
    });
  }

  // ============================================================ AUDIT
  const auditState = { page: 1, action: '', search: '' };

  Views.audit = async function auditView(target) {
    if (!window.Can('audit.view')) return Views.accessDenied(target);
    target.replaceChildren(pageHead({ eyebrow: t('nav.audit'), title: t('audit.title'), subtitle: t('audit.subtitle') }));
    const panel = el('section', { class: 'card' });
    panel.innerHTML = `
      <div class="table-toolbar">
        <label class="field-icon search-field">${icon('search')}
          <input class="field" id="a-search" type="search" placeholder="${escapeHtml(t('common.searchPlaceholder'))}" style="width:100%"></label>
        <input class="field" id="a-action" placeholder="${escapeHtml(t('audit.action'))}" style="max-width:200px">
        <button class="btn btn-sm" id="a-reset">${escapeHtml(t('common.reset'))}</button>
      </div>
      <div id="a-body">${skeletonRows(8)}</div>`;
    target.appendChild(panel);
    const body = $('#a-body', panel);

    async function load() {
      try {
        const data = await api.get(`/api/audit-logs?page=${auditState.page}&pageSize=30&search=${encodeURIComponent(auditState.search)}&action=${encodeURIComponent(auditState.action)}`);
        if (!data.items.length) {
          body.innerHTML = `<div class="card-body">${emptyState({ title: t('audit.empty'), desc: '', iconName: 'history' })}</div>`;
          return;
        }
        const wrap = el('div');
        wrap.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
          <th>${escapeHtml(t('audit.action'))}</th><th>${escapeHtml(t('audit.actor'))}</th>
          <th>${escapeHtml(t('audit.entity'))}</th><th>${escapeHtml(t('audit.details'))}</th><th>${escapeHtml(t('audit.when'))}</th>
        </tr></thead><tbody>${data.items.map(item => `<tr>
          <td><span class="badge navy">${escapeHtml(item.action)}</span></td>
          <td>${escapeHtml(item.actor)}<span class="sub">${escapeHtml(item.ip || '')}</span></td>
          <td>${escapeHtml(item.entityType)}<span class="sub">${escapeHtml(item.entityId || '')}</span></td>
          <td class="text-muted" style="max-width:420px"><span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:ltr;text-align:start">${escapeHtml(item.details || '—')}</span></td>
          <td class="text-muted mono">${formatDate(item.createdAt, { withTime: true })}</td>
        </tr>`).join('')}</tbody></table></div>`;
        body.replaceChildren(wrap);
        body.appendChild(pagination({ page: data.page, totalPages: data.totalPages, total: data.total, pageSize: data.pageSize }, page => {
          auditState.page = page;
          load();
        }));
      } catch (error) {
        body.innerHTML = `<div class="card-body">${errorState(error.message)}</div>`;
      }
    }

    $('#a-search', panel).addEventListener('input', A.debounce(e => { auditState.search = e.target.value.trim(); auditState.page = 1; load(); }, 350));
    $('#a-action', panel).addEventListener('input', A.debounce(e => { auditState.action = e.target.value.trim(); auditState.page = 1; load(); }, 350));
    $('#a-reset', panel).addEventListener('click', () => {
      auditState.search = ''; auditState.action = ''; auditState.page = 1;
      $('#a-search', panel).value = ''; $('#a-action', panel).value = '';
      load();
    });
    load();
  };

  // ============================================================ SETTINGS
  Views.settings = async function settingsView(target) {
    if (!window.Can('settings.manage')) return Views.accessDenied(target);
    target.replaceChildren(pageHead({ eyebrow: t('nav.settings'), title: t('settings.title'), subtitle: t('settings.subtitle') }));
    const grid = el('div', { class: 'two-col' });
    target.appendChild(grid);

    const formCard = card({
      title: t('settings.title'),
      body: `<form class="form-grid" id="settings-form">
        <div class="form-field"><label>${escapeHtml(t('settings.academicYear'))}</label>
          <input class="field" name="academic_year" placeholder="2025 / 2026" maxlength="20"></div>
        <div class="form-field"><label>${escapeHtml(t('settings.semester'))}</label>
          <select class="field" name="semester"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></div>
        <div class="form-field"><label>${escapeHtml(t('settings.grace'))}</label>
          <input class="field" name="late_grace_minutes" type="number" min="0" max="120"></div>
        <div class="form-field"><label>${escapeHtml(t('settings.alert'))}</label>
          <input class="field" name="absence_alert_threshold" type="number" min="0" max="100"></div>
        <div class="span-2" style="display:flex;justify-content:flex-end"><button class="btn btn-primary" type="submit">${escapeHtml(t('common.save'))}</button></div>
      </form>`
    });
    grid.appendChild(formCard);

    const infoCard = card({
      title: t('settings.about'),
      body: `<div class="info-grid">
        <div class="info-item"><div class="label">${escapeHtml(t('settings.version'))}</div><div class="value">${escapeHtml(window.APP_VERSION || '—')}</div></div>
        <div class="info-item"><div class="label">${escapeHtml(t('settings.database'))}</div><div class="value">SQLite 3 (WAL)</div></div>
        <div class="info-item"><div class="label">${escapeHtml(t('settings.schema'))}</div><div class="value" id="schema-version">…</div></div>
        <div class="info-item"><div class="label">${escapeHtml(t('settings.environment'))}</div><div class="value" id="env-value">…</div></div>
      </div>
      <div class="divider"></div>
      <div class="form-field"><label>${escapeHtml(t('settings.backup'))}</label>
        <p class="hint" style="margin-bottom:8px">${escapeHtml(t('settings.backupHint'))}</p>
        <button class="btn" id="backup-btn">${icon('download')}<span>${escapeHtml(t('settings.backup'))}</span></button></div>`
    });
    grid.appendChild(infoCard);

    try {
      const [settings, health] = await Promise.all([api.get('/api/settings'), api.get('/api/system/health')]);
      const form = $('#settings-form', formCard);
      Object.entries(settings.settings || {}).forEach(([key, value]) => {
        const field = form.elements[key];
        if (field) field.value = value;
      });
      const schemaNode = $('#schema-version', infoCard);
      if (schemaNode) schemaNode.textContent = health.schemaVersion || '—';
      const envNode = $('#env-value', infoCard);
      if (envNode) envNode.textContent = health.status;
    } catch (error) { toast(error.message, { type: 'error' }); }

    $('#settings-form', formCard).addEventListener('submit', async event => {
      event.preventDefault();
      const submit = event.target.querySelector('button[type=submit]');
      A.busy(submit, true);
      try {
        await api.put('/api/settings', A.formData(event.target));
        toast(t('settings.saved'), { type: 'success' });
      } catch (error) { toast(error.message, { type: 'error' }); }
      finally { A.busy(submit, false); }
    });

    const backup = $('#backup-btn', infoCard);
    if (backup) backup.addEventListener('click', () => api.download('/api/system/backup', `attendance-backup-${todayIso()}.sqlite`).catch(error => toast(error.message, { type: 'error' })));
  };

  window.Views = Object.assign(window.Views || {}, Views);
})();
