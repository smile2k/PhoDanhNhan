(() => {
  let allData = [];
  let editingId = null;
  let currentUser = null;

  async function init() {
    const user = await Auth.checkSession();
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      window.location.href = '/login.html';
      return;
    }
    currentUser = user;
    const roleLabel = user.role === 'superadmin' ? 'superadmin' : 'admin';
    document.getElementById('user-info').textContent = user.username + ' (' + roleLabel + ')';

    if (user.role === 'superadmin') {
      document.getElementById('tab-users').style.display = '';
    }

    setupTabs();
    await loadData();
    setupEvents();

    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'users' && user.role === 'superadmin') {
      switchTab('users');
    }
  }

  function setupTabs() {
    document.querySelectorAll('.admin-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
  }

  function switchTab(tabName) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    const activeTab = document.querySelector('.admin-tab[data-tab="' + tabName + '"]');
    if (activeTab) activeTab.classList.add('active');

    document.getElementById('panel-danh-nhan').style.display = tabName === 'danh-nhan' ? '' : 'none';
    document.getElementById('panel-users').style.display = tabName === 'users' ? '' : 'none';

    const url = new URL(window.location);
    if (tabName === 'danh-nhan') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', tabName);
    }
    history.replaceState(null, '', url);

    if (tabName === 'users') {
      loadUsers();
    }
  }

  async function loadUsers() {
    const resp = await fetch('/api/users');
    const result = await resp.json();
    if (!result.success) return;
    renderUsers(result.users);
  }

  function renderUsers(users) {
    const tbody = document.getElementById('users-table-body');
    document.getElementById('users-count-badge').textContent = users.length + ' tài khoản';

    tbody.innerHTML = users.map(u => {
      const badgeClass = u.role;
      const roleLabel = u.role === 'superadmin' ? 'Superadmin' : u.role === 'admin' ? 'Admin' : 'User';
      const isSuperadmin = u.role === 'superadmin';

      let actions = '';
      if (!isSuperadmin) {
        const options = ['user', 'admin']
          .map(r => '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + (r === 'admin' ? 'Admin' : 'User') + '</option>')
          .join('');
        actions = '<select class="role-select" data-user-id="' + u.id + '">' + options + '</select>'
          + ' <button class="btn-danger" data-delete-user="' + u.id + '" data-username="' + esc(u.username) + '">Xóa</button>';
      }

      return '<tr>'
        + '<td>' + u.id + '</td>'
        + '<td class="name-cell">' + esc(u.username) + '</td>'
        + '<td><span class="role-badge ' + badgeClass + '">' + roleLabel + '</span></td>'
        + '<td class="era-cell">' + esc(u.created_at || '') + '</td>'
        + '<td class="actions-cell">' + actions + '</td>'
        + '</tr>';
    }).join('');

    tbody.querySelectorAll('.role-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const userId = parseInt(sel.dataset.userId, 10);
        const role = sel.value;
        const resp = await fetch('/api/users/set-role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, role }),
        });
        const result = await resp.json();
        if (result.success) {
          await loadUsers();
        } else {
          sel.value = sel.dataset.prevRole || 'user';
        }
      });
    });

    tbody.querySelectorAll('[data-delete-user]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = parseInt(btn.dataset.deleteUser, 10);
        const username = btn.dataset.username;
        if (!confirm('Xóa tài khoản "' + username + '"?')) return;
        const resp = await fetch('/api/users/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const result = await resp.json();
        if (result.success) {
          await loadUsers();
        }
      });
    });
  }

  async function loadData() {
    const resp = await fetch('/api/danh-nhan');
    allData = await resp.json();
    renderTable(allData);
  }

  function renderTable(data) {
    const tbody = document.getElementById('table-body');
    document.getElementById('count-badge').textContent = data.length + ' danh nhân';

    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:#8a7a6a">Không tìm thấy</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(p => `
      <tr>
        <td class="name-cell">${esc(p.name)}</td>
        <td>${esc(p.realName || '')}</td>
        <td class="era-cell">${esc(p.era || '')}</td>
        <td class="era-cell">${esc(p.title || '')}</td>
        <td class="era-cell">${esc(p.born || '?')} — ${esc(p.died || '?')}</td>
        <td class="actions-cell">
          <button class="btn-edit" data-id="${esc(p.id)}">Sửa</button>
          <button class="btn-danger" data-id="${esc(p.id)}" data-name="${esc(p.name)}">Xóa</button>
        </td>
      </tr>
    `).join('');
  }

  function setupEvents() {
    document.getElementById('admin-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) {
        renderTable(allData);
        return;
      }
      const filtered = allData.filter(p => {
        const hay = [p.name, p.realName, p.era, p.title, p.id, ...(p.aliases || [])].join(' ').toLowerCase();
        return hay.includes(q);
      });
      renderTable(filtered);
    });

    document.getElementById('btn-add').addEventListener('click', () => openModal(null));

    document.getElementById('table-body').addEventListener('click', (e) => {
      const editBtn = e.target.closest('.btn-edit');
      if (editBtn) {
        const person = allData.find(p => p.id === editBtn.dataset.id);
        if (person) openModal(person);
        return;
      }
      const delBtn = e.target.closest('.btn-danger');
      if (delBtn) {
        openConfirm(delBtn.dataset.id, delBtn.dataset.name);
      }
    });

    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', saveEntry);

    document.getElementById('confirm-cancel').addEventListener('click', closeConfirm);
    document.getElementById('confirm-delete').addEventListener('click', doDelete);

    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    document.getElementById('confirm-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeConfirm();
    });

    document.getElementById('btn-add-user').addEventListener('click', openUserModal);
    document.getElementById('user-modal-close').addEventListener('click', closeUserModal);
    document.getElementById('user-modal-cancel').addEventListener('click', closeUserModal);
    document.getElementById('user-modal-save').addEventListener('click', saveUser);
    document.getElementById('user-modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeUserModal();
    });
  }

  function openUserModal() {
    document.getElementById('fu-username').value = '';
    document.getElementById('fu-password').value = '';
    document.getElementById('fu-role').value = 'user';
    document.getElementById('user-modal-error').hidden = true;
    document.getElementById('user-modal-success').hidden = true;
    document.getElementById('user-modal-overlay').hidden = false;
    document.getElementById('fu-username').focus();
  }

  function closeUserModal() {
    document.getElementById('user-modal-overlay').hidden = true;
  }

  async function saveUser() {
    const errEl = document.getElementById('user-modal-error');
    const sucEl = document.getElementById('user-modal-success');
    errEl.hidden = true;
    sucEl.hidden = true;

    const username = document.getElementById('fu-username').value.trim();
    const password = document.getElementById('fu-password').value;
    const role = document.getElementById('fu-role').value;

    if (!username || !password) {
      errEl.textContent = 'Vui lòng nhập đầy đủ';
      errEl.hidden = false;
      return;
    }

    const saveBtn = document.getElementById('user-modal-save');
    saveBtn.disabled = true;

    try {
      const resp = await fetch('/api/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role }),
      });
      const result = await resp.json();
      if (result.success) {
        sucEl.textContent = 'Tạo tài khoản "' + username + '" thành công!';
        sucEl.hidden = false;
        await loadUsers();
        setTimeout(() => closeUserModal(), 1000);
      } else {
        errEl.textContent = result.error || 'Tạo tài khoản thất bại';
        errEl.hidden = false;
      }
    } catch {
      errEl.textContent = 'Lỗi kết nối server';
      errEl.hidden = false;
    }

    saveBtn.disabled = false;
  }

  function openModal(person) {
    editingId = person ? person.id : null;
    document.getElementById('modal-title').textContent = person ? 'Sửa danh nhân' : 'Thêm danh nhân';
    document.getElementById('modal-error').hidden = true;

    const idInput = document.getElementById('f-id');
    idInput.value = person ? person.id : '';
    idInput.disabled = !!person;

    document.getElementById('f-name').value = person ? person.name : '';
    document.getElementById('f-realName').value = person ? (person.realName || '') : '';
    document.getElementById('f-era').value = person ? (person.era || '') : '';
    document.getElementById('f-born').value = person ? (person.born || '') : '';
    document.getElementById('f-died').value = person ? (person.died || '') : '';
    document.getElementById('f-title').value = person ? (person.title || '') : '';
    document.getElementById('f-summary').value = person ? (person.summary || '') : '';
    document.getElementById('f-bio').value = person ? (person.bio || '') : '';
    document.getElementById('f-streetNote').value = person ? (person.streetNote || '') : '';
    document.getElementById('f-wikiSlug').value = person ? (person.wikiSlug || '') : '';
    document.getElementById('f-aliases').value = person ? (person.aliases || []).join(', ') : '';

    document.getElementById('modal-overlay').hidden = false;
    document.getElementById('f-name').focus();
  }

  function closeModal() {
    document.getElementById('modal-overlay').hidden = true;
    editingId = null;
  }

  async function saveEntry() {
    const errorEl = document.getElementById('modal-error');
    errorEl.hidden = true;

    const id = document.getElementById('f-id').value.trim();
    const name = document.getElementById('f-name').value.trim();

    if (!id || !name) {
      errorEl.textContent = 'ID và Tên là bắt buộc';
      errorEl.hidden = false;
      return;
    }

    const aliasesRaw = document.getElementById('f-aliases').value.trim();
    const aliases = aliasesRaw ? aliasesRaw.split(',').map(a => a.trim()).filter(Boolean) : [];

    const entry = {
      id,
      name,
      realName: document.getElementById('f-realName').value.trim(),
      era: document.getElementById('f-era').value.trim(),
      born: document.getElementById('f-born').value.trim(),
      died: document.getElementById('f-died').value.trim(),
      title: document.getElementById('f-title').value.trim(),
      summary: document.getElementById('f-summary').value.trim(),
      bio: document.getElementById('f-bio').value.trim(),
      streetNote: document.getElementById('f-streetNote').value.trim(),
      wikiSlug: document.getElementById('f-wikiSlug').value.trim(),
      aliases,
      stories: [],
    };

    const saveBtn = document.getElementById('modal-save');
    saveBtn.disabled = true;

    try {
      let resp;
      if (editingId) {
        const existing = allData.find(p => p.id === editingId);
        if (existing && existing.stories) {
          entry.stories = existing.stories;
        }
        resp = await fetch('/api/danh-nhan/' + encodeURIComponent(editingId), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        });
      } else {
        resp = await fetch('/api/danh-nhan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        });
      }

      const result = await resp.json();
      if (result.success) {
        closeModal();
        await loadData();
      } else {
        errorEl.textContent = result.error || 'Lỗi khi lưu';
        errorEl.hidden = false;
      }
    } catch {
      errorEl.textContent = 'Lỗi kết nối server';
      errorEl.hidden = false;
    }

    saveBtn.disabled = false;
  }

  let deleteTargetId = null;

  function openConfirm(id, name) {
    deleteTargetId = id;
    document.getElementById('confirm-name').textContent = name;
    document.getElementById('confirm-overlay').hidden = false;
  }

  function closeConfirm() {
    document.getElementById('confirm-overlay').hidden = true;
    deleteTargetId = null;
  }

  async function doDelete() {
    if (!deleteTargetId) return;
    const delBtn = document.getElementById('confirm-delete');
    delBtn.disabled = true;

    try {
      const resp = await fetch('/api/danh-nhan/' + encodeURIComponent(deleteTargetId), {
        method: 'DELETE',
      });
      const result = await resp.json();
      if (result.success) {
        closeConfirm();
        await loadData();
      }
    } catch {
      // ignore
    }

    delBtn.disabled = false;
  }

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
