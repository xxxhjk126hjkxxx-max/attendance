/* ==========================================================================
   Course management + lecture scheduling views.
   ========================================================================== */
(function () {
  'use strict';
  const A = window.App;
  const { el, $, $$, icon, i18n, api, toast, modal, confirmDialog, escapeHtml, formatNumber, formatPercent, formatDate, formatTime, todayIso, statusBadge, emptyState, skeletonRows, errorState, initials } = A;
  const t = (key, vars) => i18n.t(key, vars);
  const { pageHead, button, card } = window.ViewHelpers;
  const Views = {};

  // ============================================================ COURSES
  Views.courses = async function coursesView(target, params) {
    if (!window.Can('courses.view')) return Views.accessDenied(target);
    const includeArchivedBox = el('label', { class: 'checkbox' });
    includeArchivedBox.innerHTML = `<input type="checkbox" id="c-archived"> <span>${escapeHtml(t('courses.includeArchived'))}</span>`;
    target.replaceChildren(pageHead({
      eyebrow: t('nav.courses'), title: t('courses.title'), subtitle: t('courses.subtitle'),
      actions: [
        includeArchivedBox,
        window.Can('courses.manage') ? button(t('courses.add'), { variant: 'btn-primary', iconName: 'plus', onClick: () => courseForm() }) : null
      ].filter(Boolean)
    }));

    const panel = el('section', { class: 'card' });
    panel.innerHTML = `
      <div class="table-toolbar">
        <label class="field-icon search-field">${icon('search')}
          <input class="field" id="c-search" type="search" placeholder="${escapeHtml(t('common.searchPlaceholder'))}" style="width:100%"></label>
      </div>
      <div id="c-body">${skeletonRows(6)}</div>`;
    target.appendChild(panel);
    const body = $('#c-body', panel);

    async function load() {
      try {
        const includeArchived = $('#c-archived').checked;
        const data = await api.get(`/api/courses?search=${encodeURIComponent($('#c-search', panel).value.trim())}&includeArchived=${includeArchived}`);
        render(data.items);
      } catch (error) {
        body.innerHTML = `<div class="card-body">${errorState(error.message)}</div>`;
      }
    }

    function render(items) {
      if (!items.length) {
        body.innerHTML = `<div class="card-body">${emptyState({
          title: t('courses.empty'), desc: t('courses.emptyDesc'), iconName: 'book',
          action: window.Can('courses.manage') ? `<button class="btn btn-primary btn-sm" id="c-empty-add">${escapeHtml(t('courses.add'))}</button>` : ''
        })}</div>`;
        const add = $('#c-empty-add', body);
        if (add) add.addEventListener('click', () => courseForm());
        return;
      }
      const wrap = el('div');
      wrap.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr>
          <th>${escapeHtml(t('courses.code'))}</th>
          <th>${escapeHtml(t('common.course'))}</th>
          <th>${escapeHtml(t('courses.department'))}</th>
          <th>${escapeHtml(t('courses.instructor'))}</th>
          <th>${escapeHtml(t('courses.students'))}</th>
          <th>${escapeHtml(t('common.lectures'))}</th>
          <th style="text-align:end">${escapeHtml(t('common.actions'))}</th>
        </tr></thead>
        <tbody>${items.map(course => `<tr>
          <td><b class="mono">${escapeHtml(course.code)}</b>${course.archivedAt ? `<span class="badge gold" style="margin-inline-start:6px">${escapeHtml(t('courses.archived'))}</span>` : ''}</td>
          <td>${escapeHtml(i18n.lang === 'ar' && course.nameAr ? course.nameAr : course.nameEn)}<span class="sub">${escapeHtml(i18n.lang === 'ar' ? course.nameEn : (course.nameAr || ''))}</span></td>
          <td>${escapeHtml(course.department || '—')}<span class="sub">${escapeHtml(course.academicLevel || '')}</span></td>
          <td>${escapeHtml(course.instructorName || '—')}</td>
          <td class="mono">${formatNumber(course.studentCount)}</td>
          <td class="mono">${formatNumber(course.lectureCount)}</td>
          <td class="actions-cell">
            <button class="btn btn-sm" data-view="${course.id}">${icon('eye')}<span class="hide-sm">${escapeHtml(t('courses.students'))}</span></button>
            ${window.Can('courses.manage') ? `
              <button class="btn btn-sm" data-enroll="${course.id}" aria-label="${escapeHtml(t('courses.enroll'))}" title="${escapeHtml(t('courses.enroll'))}">${icon('user')}</button>
              <button class="btn btn-sm" data-edit="${course.id}" aria-label="${escapeHtml(t('common.edit'))}">${icon('edit')}</button>
              ${course.archivedAt
                ? `<button class="btn btn-sm" data-restore="${course.id}" aria-label="${escapeHtml(t('courses.restore'))}">${icon('refresh')}</button>`
                : `<button class="btn btn-sm" data-archive="${course.id}" aria-label="${escapeHtml(t('courses.archive'))}">${icon('archive')}</button>`}
              <button class="btn btn-sm btn-danger" data-del="${course.id}" aria-label="${escapeHtml(t('common.delete'))}">${icon('trash')}</button>` : ''}
          </td></tr>`).join('')}</tbody></table></div>`;
      body.replaceChildren(wrap);
      $$('[data-view]', wrap).forEach(n => n.addEventListener('click', () => courseDetail(n.dataset.view, load)));
      $$('[data-enroll]', wrap).forEach(n => n.addEventListener('click', () => enrollModal(n.dataset.enroll, load)));
      $$('[data-edit]', wrap).forEach(n => n.addEventListener('click', () => courseForm(n.dataset.edit, load)));
      $$('[data-archive]', wrap).forEach(n => n.addEventListener('click', async () => {
        try { await api.post(`/api/courses/${n.dataset.archive}/archive`, {}); toast(t('courses.archivedToast'), { type: 'success' }); load(); }
        catch (error) { toast(error.message, { type: 'error' }); }
      }));
      $$('[data-restore]', wrap).forEach(n => n.addEventListener('click', async () => {
        try { await api.post(`/api/courses/${n.dataset.restore}/restore`, {}); toast(t('courses.updated'), { type: 'success' }); load(); }
        catch (error) { toast(error.message, { type: 'error' }); }
      }));
      $$('[data-del]', wrap).forEach(n => n.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: t('courses.deleteTitle'), text: t('courses.deleteText'), confirmLabel: t('common.delete') });
        if (!ok) return;
        try {
          const result = await api.del(`/api/courses/${n.dataset.del}`);
          toast(result.archived ? t('courses.archivedToast') : t('courses.deletedToast'), { type: 'success' });
          load();
        } catch (error) { toast(error.message, { type: 'error' }); }
      }));
    }

    $('#c-search', panel).addEventListener('input', A.debounce(load, 320));
    $('#c-archived').addEventListener('change', load);
    load();
    if (params.get('action') === 'new' && window.Can('courses.manage')) courseForm();
  };

  async function courseForm(id, onDone) {
    let course = {};
    let users = [];
    try {
      if (window.Can('users.manage')) users = (await api.get('/api/users')).items;
    } catch { users = []; }
    if (id) course = await api.get(`/api/courses/${id}`).catch(() => ({}));
    const form = el('form', { class: 'form-grid', novalidate: true });
    form.innerHTML = `
      <div class="form-field" data-field="code"><label>${escapeHtml(t('courses.code'))} <span class="req">*</span></label>
        <input class="field" name="code" value="${escapeHtml(course.code || '')}" required maxlength="24" placeholder="CS101" style="text-transform:uppercase"><span class="error"></span></div>
      <div class="form-field" data-field="creditHours"><label>${escapeHtml(t('courses.credits'))}</label>
        <input class="field" name="creditHours" type="number" min="1" max="20" value="${escapeHtml(course.creditHours || 3)}"><span class="error"></span></div>
      <div class="form-field span-2" data-field="nameEn"><label>${escapeHtml(t('courses.nameEn'))} <span class="req">*</span></label>
        <input class="field" name="nameEn" value="${escapeHtml(course.nameEn || '')}" required maxlength="120"><span class="error"></span></div>
      <div class="form-field span-2" data-field="nameAr"><label>${escapeHtml(t('courses.nameAr'))}</label>
        <input class="field" name="nameAr" value="${escapeHtml(course.nameAr || '')}" maxlength="120" dir="rtl"><span class="error"></span></div>
      <div class="form-field" data-field="department"><label>${escapeHtml(t('courses.department'))}</label>
        <input class="field" name="department" value="${escapeHtml(course.department || '')}" maxlength="120"><span class="error"></span></div>
      <div class="form-field" data-field="academicLevel"><label>${escapeHtml(t('courses.level'))}</label>
        <input class="field" name="academicLevel" value="${escapeHtml(course.academicLevel || '')}" maxlength="60"><span class="error"></span></div>
      <div class="form-field span-2" data-field="instructorId"><label>${escapeHtml(t('courses.instructor'))}</label>
        <select class="field" name="instructorId"><option value="">—</option>
          ${users.map(u => `<option value="${u.id}" ${String(course.instructorId) === String(u.id) ? 'selected' : ''}>${escapeHtml(u.fullName)} (${escapeHtml(t(`users.role.${u.role}`))})</option>`).join('')}
        </select><span class="error"></span></div>`;
    const submit = el('button', { class: 'btn btn-primary', type: 'button', text: id ? t('common.save') : t('courses.add') });
    const ref = modal({
      title: id ? t('courses.edit') : t('courses.add'), body: form, size: 'wide',
      footer: [el('button', { class: 'btn', type: 'button', text: t('common.cancel'), 'data-close-modal': '' }), submit]
    });
    submit.addEventListener('click', async () => {
      A.busy(submit, true);
      const data = A.formData(form);
      if (!data.instructorId) data.instructorId = null;
      data.creditHours = Number(data.creditHours || 3);
      try {
        if (id) await api.put(`/api/courses/${id}`, data);
        else await api.post('/api/courses', data);
        toast(id ? t('courses.updated') : t('courses.created'), { type: 'success' });
        ref.close();
        if (onDone) onDone(); else if (window.location.hash.startsWith('#/courses')) window.location.reload();
      } catch (error) {
        if (error.fields) A.fieldErrors(form, error.fields);
        toast(error.message, { type: 'error' });
      } finally { A.busy(submit, false); }
    });
  }

  async function courseDetail(id, onDone) {
    const body = el('div', { html: `<div class="loading-panel"><span class="spinner"></span></div>` });
    modal({ title: t('courses.title'), body, size: 'wide' });
    try {
      const course = await api.get(`/api/courses/${id}`);
      body.innerHTML = `
        <div class="flex items-center gap-12" style="margin-bottom:16px;flex-wrap:wrap">
          <div class="grow"><h3 style="font-size:17px">${escapeHtml(course.code)} — ${escapeHtml(i18n.lang === 'ar' && course.nameAr ? course.nameAr : course.nameEn)}</h3>
          <p class="text-muted" style="font-size:12px">${escapeHtml(course.department || '')} · ${escapeHtml(course.academicLevel || '')} · ${escapeHtml(course.instructorName || '—')}</p></div>
          <span class="badge navy">${formatNumber(course.students.length)} ${escapeHtml(t('courses.students').toLowerCase())}</span>
        </div>
        <div class="tabs" role="tablist">
          <button class="tab active" data-tab="students">${escapeHtml(t('courses.students'))}</button>
          <button class="tab" data-tab="lectures">${escapeHtml(t('common.lectures'))}</button>
        </div>
        <div id="cd-students" style="margin-top:12px"></div>
        <div id="cd-lectures" class="hidden" style="margin-top:12px"></div>`;
      const studentsTab = $('#cd-students', body);
      const lecturesTab = $('#cd-lectures', body);
      studentsTab.innerHTML = course.students.length
        ? `<div class="table-wrap" style="max-height:340px;overflow:auto"><table class="data"><thead><tr>
            <th>${escapeHtml(t('common.student'))}</th><th>${escapeHtml(t('common.studentId'))}</th><th>${escapeHtml(t('common.level'))}</th><th></th></tr></thead>
            <tbody>${course.students.map(s => `<tr>
              <td><div class="cell-user"><span class="avatar">${escapeHtml(initials(s.name))}</span><b>${escapeHtml(s.name)}</b></div></td>
              <td class="mono">${escapeHtml(s.id)}</td><td>${escapeHtml(s.level || '')}</td>
              <td class="actions-cell">${window.Can('courses.manage') ? `<button class="btn btn-sm btn-danger" data-unenroll="${escapeHtml(s.id)}">${icon('x')}</button>` : ''}</td>
            </tr>`).join('')}</tbody></table></div>`
        : emptyState({ title: t('courses.empty'), desc: t('courses.enrollHint'), iconName: 'users' });
      lecturesTab.innerHTML = course.lectures.length
        ? `<div class="table-wrap" style="max-height:340px;overflow:auto"><table class="data"><thead><tr>
            <th>${escapeHtml(t('common.lectures'))}</th><th>${escapeHtml(t('common.date'))}</th><th>${escapeHtml(t('common.time'))}</th><th>${escapeHtml(t('common.status'))}</th></tr></thead>
            <tbody>${course.lectures.map(l => `<tr>
              <td>${escapeHtml(l.title)}</td><td class="mono">${formatDate(l.lectureDate)}</td>
              <td class="mono">${formatTime(l.startTime)}</td><td>${l.marked ? `<span class="badge present">${formatNumber(l.marked)}</span>` : `<span class="badge unmarked">${escapeHtml(t('common.unmarked'))}</span>`}</td>
            </tr>`).join('')}</tbody></table></div>`
        : emptyState({ title: t('lectures.empty'), desc: t('lectures.emptyDesc'), iconName: 'calendar' });
      $$('.tab', body).forEach(tab => tab.addEventListener('click', () => {
        $$('.tab', body).forEach(x => x.classList.toggle('active', x === tab));
        studentsTab.classList.toggle('hidden', tab.dataset.tab !== 'students');
        lecturesTab.classList.toggle('hidden', tab.dataset.tab !== 'lectures');
      }));
      $$('[data-unenroll]', studentsTab).forEach(node => node.addEventListener('click', async () => {
        try {
          await api.del(`/api/courses/${id}/enrollments/${encodeURIComponent(node.dataset.unenroll)}`);
          toast(t('common.save'), { type: 'success' });
          if (onDone) onDone();
          courseDetail(id, onDone);
        } catch (error) { toast(error.message, { type: 'error' }); }
      }));
    } catch (error) {
      body.innerHTML = errorState(error.message);
    }
  }

  async function enrollModal(courseId, onDone) {
    const body = el('div', { html: `<div class="loading-panel"><span class="spinner"></span></div>` });
    const ref = modal({ title: t('courses.enroll'), body, size: 'wide' });
    try {
      const [course, all] = await Promise.all([
        api.get(`/api/courses/${courseId}`),
        api.get('/api/students?pageSize=100&status=active')
      ]);
      const enrolled = new Set(course.students.map(s => s.id));
      body.innerHTML = `
        <p class="text-muted" style="font-size:12.5px;margin-bottom:10px">${escapeHtml(t('courses.enrollTitle', { course: course.nameEn }))}</p>
        <label class="field-icon" style="display:flex;margin-bottom:10px">${icon('search')}
          <input class="field" id="en-search" type="search" placeholder="${escapeHtml(t('common.search'))}" style="width:100%"></label>
        <div class="mark-grid" id="en-list"></div>`;
      const list = $('#en-list', body);
      function paint(term) {
        const items = all.items.filter(s => !enrolled.has(s.id) &&
          (!term || s.name.toLowerCase().includes(term) || String(s.id).toLowerCase().includes(term)));
        list.innerHTML = items.length
          ? items.map(s => `<label class="mark-row" style="cursor:pointer">
              <input type="checkbox" value="${escapeHtml(s.id)}" style="width:16px;height:16px;accent-color:#142B45">
              <span class="avatar-sm">${escapeHtml(initials(s.name))}</span>
              <div class="name"><b>${escapeHtml(s.name)}</b><small>${escapeHtml(s.id)} · ${escapeHtml(s.level || '')}</small></div>
            </label>`).join('')
          : emptyState({ title: t('empty.search'), desc: '', iconName: 'users' });
      }
      paint('');
      $('#en-search', body).addEventListener('input', A.debounce(e => paint(e.target.value.trim().toLowerCase()), 200));
      const submit = el('button', {
        class: 'btn btn-primary', type: 'button', text: t('common.save'),
        onclick: async () => {
          const ids = $$('input[type=checkbox]:checked', list).map(n => n.value);
          if (!ids.length) return toast(t('courses.enrollHint'), { type: 'warn' });
          A.busy(submit, true);
          try {
            const result = await api.post(`/api/courses/${courseId}/enrollments`, { studentIds: ids });
            toast(t('courses.enrolled', { n: result.enrolled }), { type: 'success' });
            ref.close();
            if (onDone) onDone();
          } catch (error) { toast(error.message, { type: 'error' }); }
          finally { A.busy(submit, false); }
        }
      });
      ref.footer.replaceChildren(
        el('button', { class: 'btn', type: 'button', text: t('common.cancel'), 'data-close-modal': '' }), submit
      );
    } catch (error) {
      body.innerHTML = errorState(error.message);
    }
  }

  // ============================================================ LECTURES
  const lectureFilters = { courseId: '', date: '', search: '', status: '' };

  Views.lectures = async function lecturesView(target, params) {
    if (!window.Can('lectures.view')) return Views.accessDenied(target);
    target.replaceChildren(pageHead({
      eyebrow: t('nav.lectures'), title: t('lectures.title'), subtitle: t('lectures.subtitle'),
      actions: [
        window.Can('lectures.manage') ? button(t('lectures.add'), { variant: 'btn-primary', iconName: 'plus', onClick: () => lectureForm() }) : null
      ].filter(Boolean)
    }));
    const panel = el('section', { class: 'card' });
    panel.innerHTML = `
      <div class="table-toolbar">
        <label class="field-icon search-field">${icon('search')}
          <input class="field" id="l-search" type="search" placeholder="${escapeHtml(t('common.searchPlaceholder'))}" style="width:100%"></label>
        <select class="field" id="l-course"><option value="">${escapeHtml(t('common.all'))} · ${escapeHtml(t('common.course'))}</option></select>
        <input class="field" id="l-date" type="date" aria-label="${escapeHtml(t('common.date'))}">
        <select class="field" id="l-status">
          <option value="">${escapeHtml(t('common.all'))} · ${escapeHtml(t('common.status'))}</option>
          ${['scheduled', 'in_progress', 'completed', 'cancelled'].map(s => `<option value="${s}">${escapeHtml(t(`lectures.status.${s}`))}</option>`).join('')}
        </select>
        <button class="btn btn-sm" id="l-reset">${escapeHtml(t('common.reset'))}</button>
      </div>
      <div id="l-body">${skeletonRows(6)}</div>`;
    target.appendChild(panel);
    const body = $('#l-body', panel);

    try {
      const courses = (await api.get('/api/courses')).items;
      $('#l-course', panel).innerHTML = `<option value="">${escapeHtml(t('common.all'))} · ${escapeHtml(t('common.course'))}</option>` +
        courses.map(c => `<option value="${c.id}">${escapeHtml(c.code)} — ${escapeHtml(c.nameEn)}</option>`).join('');
    } catch { /* course filter is optional */ }

    async function load() {
      try {
        const query = new URLSearchParams({ search: lectureFilters.search, date: lectureFilters.date, status: lectureFilters.status });
        if (lectureFilters.courseId) query.set('courseId', lectureFilters.courseId);
        const data = await api.get(`/api/lectures?${query}`);
        render(data.items);
      } catch (error) {
        body.innerHTML = `<div class="card-body">${errorState(error.message)}</div>`;
      }
    }

    function render(items) {
      if (!items.length) {
        body.innerHTML = `<div class="card-body">${emptyState({ title: t('lectures.empty'), desc: t('lectures.emptyDesc'), iconName: 'calendar' })}</div>`;
        return;
      }
      const wrap = el('div');
      wrap.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr>
          <th>${escapeHtml(t('common.lectures'))}</th><th>${escapeHtml(t('common.course'))}</th>
          <th>${escapeHtml(t('common.date'))}</th><th>${escapeHtml(t('common.time'))}</th>
          <th>${escapeHtml(t('common.enrolled'))}</th><th>${escapeHtml(t('common.status'))}</th>
          <th style="text-align:end">${escapeHtml(t('common.actions'))}</th>
        </tr></thead><tbody>${items.map(l => `<tr>
          <td><b>${escapeHtml(l.title)}</b><span class="sub">${escapeHtml(l.instructorName || '—')}${l.room ? ` · ${escapeHtml(l.room)}` : ''}</span></td>
          <td>${escapeHtml(l.course)}<span class="sub">${escapeHtml(l.courseCode || '')}</span></td>
          <td class="mono">${formatDate(l.lectureDate)}</td>
          <td class="mono">${formatTime(l.startTime)}–${formatTime(l.endTime)}</td>
          <td class="mono">${formatNumber(l.markedCount)} / ${formatNumber(l.enrolledCount)}</td>
          <td><span class="badge ${l.status === 'completed' ? 'present' : l.status === 'cancelled' ? 'absent' : l.status === 'in_progress' ? 'late' : 'navy'}">${escapeHtml(t(`lectures.status.${l.status}`))}</span></td>
          <td class="actions-cell">
            <button class="btn btn-sm" data-open="${l.id}">${icon('clipboard')}<span class="hide-sm">${escapeHtml(t('lectures.roster'))}</span></button>
            ${window.Can('lectures.manage') ? `
              <button class="btn btn-sm" data-edit="${l.id}" aria-label="${escapeHtml(t('common.edit'))}">${icon('edit')}</button>
              ${l.status !== 'cancelled' ? `<button class="btn btn-sm" data-cancel="${l.id}" aria-label="${escapeHtml(t('lectures.cancel'))}">${icon('x')}</button>` : ''}
              <button class="btn btn-sm btn-danger" data-del="${l.id}" aria-label="${escapeHtml(t('common.delete'))}">${icon('trash')}</button>` : ''}
          </td></tr>`).join('')}</tbody></table></div>`;
      body.replaceChildren(wrap);
      $$('[data-open]', wrap).forEach(n => n.addEventListener('click', () => lectureDetail(n.dataset.open, load)));
      $$('[data-edit]', wrap).forEach(n => n.addEventListener('click', () => lectureForm(n.dataset.edit, load)));
      $$('[data-cancel]', wrap).forEach(n => n.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: t('lectures.cancel'), text: t('lectures.deleteText'), confirmLabel: t('lectures.cancel') });
        if (!ok) return;
        try { await api.post(`/api/lectures/${n.dataset.cancel}/status`, { status: 'cancelled' }); toast(t('lectures.cancelledToast'), { type: 'success' }); load(); }
        catch (error) { toast(error.message, { type: 'error' }); }
      }));
      $$('[data-del]', wrap).forEach(n => n.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: t('lectures.deleteTitle'), text: t('lectures.deleteText'), confirmLabel: t('common.delete') });
        if (!ok) return;
        try { await api.del(`/api/lectures/${n.dataset.del}`); toast(t('common.delete'), { type: 'success' }); load(); }
        catch (error) { toast(error.message, { type: 'error' }); }
      }));
    }

    $('#l-search', panel).addEventListener('input', A.debounce(e => { lectureFilters.search = e.target.value.trim(); load(); }, 320));
    $('#l-course', panel).addEventListener('change', e => { lectureFilters.courseId = e.target.value; load(); });
    $('#l-date', panel).addEventListener('change', e => { lectureFilters.date = e.target.value; load(); });
    $('#l-status', panel).addEventListener('change', e => { lectureFilters.status = e.target.value; load(); });
    $('#l-reset', panel).addEventListener('click', () => {
      Object.assign(lectureFilters, { courseId: '', date: '', search: '', status: '' });
      $('#l-search', panel).value = ''; $('#l-date', panel).value = ''; $('#l-status', panel).value = ''; $('#l-course', panel).value = '';
      load();
    });
    load();
    if (params.get('action') === 'new' && window.Can('lectures.manage')) lectureForm();
    if (params.get('lectureId')) lectureDetail(params.get('lectureId'), load);
  };

  async function lectureForm(id, onDone) {
    let lecture = { lectureDate: todayIso(), startTime: '09:00', endTime: '10:30' };
    let courses = [];
    let users = [];
    try {
      courses = (await api.get('/api/courses')).items;
      if (window.Can('users.manage')) users = (await api.get('/api/users')).items;
      if (id) lecture = (await api.get(`/api/lectures/${id}`)).lecture;
    } catch (error) { toast(error.message, { type: 'error' }); return; }

    const form = el('form', { class: 'form-grid', novalidate: true });
    form.innerHTML = `
      <div class="form-field span-2" data-field="courseId"><label>${escapeHtml(t('common.course'))} <span class="req">*</span></label>
        <select class="field" name="courseId" required>${courses.map(c => `<option value="${c.id}" ${String(lecture.courseId) === String(c.id) ? 'selected' : ''}>${escapeHtml(c.code)} — ${escapeHtml(c.nameEn)}</option>`).join('')}</select>
        <span class="error"></span></div>
      <div class="form-field span-2" data-field="title"><label>${escapeHtml(t('lectures.lectureTitle'))} <span class="req">*</span></label>
        <input class="field" name="title" value="${escapeHtml(lecture.title || '')}" required maxlength="140"><span class="error"></span></div>
      <div class="form-field" data-field="lectureDate"><label>${escapeHtml(t('common.date'))} <span class="req">*</span></label>
        <input class="field" name="lectureDate" type="date" value="${escapeHtml(lecture.lectureDate || '')}" required><span class="error"></span></div>
      <div class="form-field" data-field="room"><label>${escapeHtml(t('lectures.room'))}</label>
        <input class="field" name="room" value="${escapeHtml(lecture.room || '')}" maxlength="60"><span class="error"></span></div>
      <div class="form-field" data-field="startTime"><label>${escapeHtml(t('lectures.start'))} <span class="req">*</span></label>
        <input class="field" name="startTime" type="time" value="${escapeHtml(lecture.startTime || '')}" required><span class="error"></span></div>
      <div class="form-field" data-field="endTime"><label>${escapeHtml(t('lectures.end'))} <span class="req">*</span></label>
        <input class="field" name="endTime" type="time" value="${escapeHtml(lecture.endTime || '')}" required><span class="error"></span></div>
      <div class="form-field" data-field="instructorId"><label>${escapeHtml(t('lectures.instructor'))}</label>
        <select class="field" name="instructorId"><option value="">—</option>${users.map(u => `<option value="${u.id}" ${String(lecture.instructorId) === String(u.id) ? 'selected' : ''}>${escapeHtml(u.fullName)} (${escapeHtml(t(`users.role.${u.role}`))})</option>`).join('')}</select>
        <span class="error"></span></div>
      <div class="form-field"><label>${escapeHtml(t('common.status'))}</label>
        <select class="field" name="status" disabled>${['scheduled', 'in_progress', 'completed', 'cancelled'].map(s => `<option ${lecture.status === s ? 'selected' : ''}>${escapeHtml(t(`lectures.status.${s}`))}</option>`).join('')}</select></div>
      <div class="form-field span-2"><div class="fieldset-title">${escapeHtml(t('lectures.opens'))} / ${escapeHtml(t('lectures.closes'))}</div>
        <div class="form-grid" style="gap:10px">
          <input class="field" name="attendanceOpensAt" type="datetime-local" value="${escapeHtml((lecture.attendanceOpensAt || '').replace(' ', 'T').slice(0, 16))}" aria-label="${escapeHtml(t('lectures.opens'))}">
          <input class="field" name="attendanceClosesAt" type="datetime-local" value="${escapeHtml((lecture.attendanceClosesAt || '').replace(' ', 'T').slice(0, 16))}" aria-label="${escapeHtml(t('lectures.closes'))}">
        </div>
        <span class="hint">${escapeHtml(i18n.lang === 'ar' ? 'اتركها فارغة لاستخدام وقت بداية ونهاية المحاضرة.' : 'Leave empty to use the lecture start and end times.')}</span>
      </div>`;
    const submit = el('button', { class: 'btn btn-primary', type: 'button', text: id ? t('common.save') : t('lectures.add') });
    const ref = modal({
      title: id ? t('lectures.edit') : t('lectures.add'), body: form, size: 'wide',
      footer: [el('button', { class: 'btn', type: 'button', text: t('common.cancel'), 'data-close-modal': '' }), submit]
    });
    submit.addEventListener('click', async () => {
      A.busy(submit, true);
      const data = A.formData(form);
      if (!data.instructorId) data.instructorId = null;
      if (!data.attendanceOpensAt) delete data.attendanceOpensAt;
      if (!data.attendanceClosesAt) delete data.attendanceClosesAt;
      delete data.status;
      try {
        if (id) await api.put(`/api/lectures/${id}`, data);
        else await api.post('/api/lectures', data);
        toast(id ? t('lectures.updated') : t('lectures.created'), { type: 'success' });
        ref.close();
        if (onDone) onDone(); else if (window.location.hash.startsWith('#/lectures')) window.location.reload();
      } catch (error) {
        if (error.fields) A.fieldErrors(form, error.fields);
        toast(error.message, { type: 'error' });
      } finally { A.busy(submit, false); }
    });
  }

  async function lectureDetail(id, onDone) {
    const body = el('div', { html: `<div class="loading-panel"><span class="spinner"></span></div>` });
    const ref = modal({ title: t('lectures.roster'), body, size: 'xwide' });
    try {
      const { lecture, roster, summary } = await api.get(`/api/lectures/${id}`);
      body.innerHTML = `
        <div class="flex items-center gap-12" style="flex-wrap:wrap;margin-bottom:14px">
          <div class="grow"><h3 style="font-size:16px">${escapeHtml(lecture.title)}</h3>
            <p class="text-muted" style="font-size:12px">${escapeHtml(lecture.course)} · ${formatDate(lecture.lectureDate)} · ${formatTime(lecture.startTime)}–${formatTime(lecture.endTime)}</p></div>
          <span class="badge navy">${escapeHtml(t(`lectures.status.${lecture.status}`))}</span>
        </div>
        <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
          <div class="stat" style="--accent:#258269;padding:11px"><div class="stat-label">${escapeHtml(t('common.present'))}</div><div class="stat-value" style="font-size:20px">${formatNumber(summary.present)}</div></div>
          <div class="stat" style="--accent:#B8860B;padding:11px"><div class="stat-label">${escapeHtml(t('common.late'))}</div><div class="stat-value" style="font-size:20px">${formatNumber(summary.late)}</div></div>
          <div class="stat" style="--accent:#B84545;padding:11px"><div class="stat-label">${escapeHtml(t('common.absent'))}</div><div class="stat-value" style="font-size:20px">${formatNumber(summary.absent)}</div></div>
          <div class="stat" style="--accent:#315B83;padding:11px"><div class="stat-label">${escapeHtml(t('common.attendanceRate'))}</div><div class="stat-value" style="font-size:20px">${formatPercent(summary.attendanceRate)}</div></div>
        </div>
        ${roster.length ? `<div class="table-wrap" style="max-height:380px;overflow:auto"><table class="data"><thead><tr>
          <th>${escapeHtml(t('common.student'))}</th><th>${escapeHtml(t('common.studentId'))}</th>
          <th>${escapeHtml(t('common.status'))}</th><th>${escapeHtml(t('common.recordedAt'))}</th></tr></thead>
          <tbody>${roster.map(row => `<tr>
            <td><div class="cell-user"><span class="avatar">${escapeHtml(initials(row.name))}</span><b>${escapeHtml(row.name)}</b></div></td>
            <td class="mono">${escapeHtml(row.id)}</td>
            <td>${row.status ? statusBadge(row.status) : `<span class="badge unmarked">${escapeHtml(t('common.unmarked'))}</span>`}</td>
            <td class="text-muted">${row.markedAt ? formatDate(row.markedAt, { withTime: true }) : '—'}<span class="sub">${escapeHtml(row.source || '')}</span></td>
          </tr>`).join('')}</tbody></table></div>` : emptyState({ title: t('lectures.empty'), desc: t('common.enrolled') + ': 0', iconName: 'users' })}`;
      ref.footer.replaceChildren(
        el('button', { class: 'btn', type: 'button', text: t('common.close'), 'data-close-modal': '' }),
        window.Can('attendance.mark') ? el('button', {
          class: 'btn btn-primary', type: 'button', text: t('attendance.mark'),
          onclick: () => { ref.close(); Views.markAttendanceModal(id); }
        }) : null,
        window.Can('attendance.mark') ? el('button', {
          class: 'btn btn-gold', type: 'button', text: t('scanner.title'),
          onclick: () => { ref.close(); location.hash = `#/scanner?lectureId=${id}`; }
        }) : null
      );
    } catch (error) {
      body.innerHTML = errorState(error.message);
    }
  }

  window.Views = Object.assign(window.Views || {}, Views);
  window.ViewHelpers = Object.assign(window.ViewHelpers || {}, { courseForm, lectureForm, lectureDetail, courseDetail });
})();
