(() => {
  const HANOI_CENTER = [21.0285, 105.8542];
  const DEFAULT_ZOOM = 15;

  let map;
  let userMarker = null;
  let accuracyCircle = null;
  let gpsMode = false;

  async function initApp() {
    initMap();
    await DataManager.init();
    UIPanel.init();
    TTSEngine.init(handleTTSState);
    StreetHighlight.init(map);
    StreetDetector.init({
      onStreetChange: handleStreetChange,
      onPositionUpdate: handlePositionUpdate,
      onError: showToast
    });
    setupSearch();
    setupMapClick();
    setupGPSButton();
    setupStoryTTS();
    const count = DataManager.getAll().length;
    document.getElementById('danh-nhan-count').textContent = `${count} danh nhân`;
    await setupAuth();
    showToast('Chạm vào bản đồ hoặc tìm tên phố để khám phá');
  }

  function initMap() {
    map = L.map('map', {
      center: HANOI_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: false
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    L.control.attribution({ position: 'bottomleft', prefix: false })
      .addAttribution('© <a href="https://openstreetmap.org">OSM</a>')
      .addTo(map);
  }

  function setupMapClick() {
    map.on('click', async (e) => {
      if (gpsMode) return;
      const { lat, lng } = e.latlng;

      StreetHighlight.clear();
      UIPanel.close();

      showToast('Đang tìm tên phố...');

      try {
        const streetName = await StreetDetector.detectStreetAt(lat, lng);
        if (!streetName) {
          showToast('Không tìm thấy tên phố tại vị trí này');
          return;
        }
        await handleStreetLookup(streetName);
      } catch {
        showToast('Lỗi khi tra cứu vị trí');
      }
    });
  }

  function setupSearch() {
    const input = document.getElementById('search-input');
    const suggestions = document.getElementById('search-suggestions');
    let debounceTimer;
    let nominatimTimer;

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      clearTimeout(nominatimTimer);

      debounceTimer = setTimeout(() => {
        const q = input.value.trim();
        if (q.length < 2) {
          suggestions.classList.remove('active');
          return;
        }
        const dbResults = DataManager.search(q);
        renderMixedSuggestions(dbResults, [], suggestions);

        nominatimTimer = setTimeout(() => searchStreets(q, suggestions, dbResults), 100);
      }, 200);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = input.value.trim();
        if (!q) return;
        suggestions.classList.remove('active');

        const results = DataManager.search(q);
        if (results.length > 0) {
          selectPerson(results[0]);
        } else {
          handleStreetLookup(q);
        }
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box')) {
        suggestions.classList.remove('active');
      }
    });
  }

  async function searchStreets(query, container, dbResults) {
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=json'
        + '&q=' + encodeURIComponent(query + ', Hà Nội')
        + '&countrycodes=vn'
        + '&limit=6'
        + '&addressdetails=1'
        + '&accept-language=vi';
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'PhoDanhNhanHanoi/1.0' }
      });
      if (!resp.ok) return;
      const data = await resp.json();

      const streets = data
        .filter(r => r.type === 'residential' || r.type === 'primary'
          || r.type === 'secondary' || r.type === 'tertiary'
          || r.type === 'street' || r.class === 'highway'
          || r.type === 'pedestrian' || r.type === 'trunk')
        .map(r => ({
          name: r.address?.road || r.display_name.split(',')[0],
          district: r.address?.suburb || r.address?.city_district || r.address?.quarter || '',
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
          fullName: r.display_name
        }));

      const seen = new Set();
      const unique = streets.filter(s => {
        const key = s.name + '|' + s.district;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      renderMixedSuggestions(dbResults, unique, container);
    } catch {
      // keep showing db results only
    }
  }

  function renderMixedSuggestions(dbResults, streetResults, container) {
    if (!dbResults.length && !streetResults.length) {
      container.classList.remove('active');
      return;
    }

    let html = '';

    if (dbResults.length > 0) {
      html += '<div class="suggestion-group-label">Danh nhân</div>';
      html += dbResults.slice(0, 5).map(p =>
        '<div class="search-suggestion" data-type="person" data-id="' + p.id + '">'
        + '<div class="name"><span class="suggestion-icon">🏛</span> ' + escHtml(p.name) + '</div>'
        + '<div class="era">' + escHtml(p.era || '') + ' · ' + escHtml(p.title || '') + '</div>'
        + '</div>'
      ).join('');
    }

    if (streetResults.length > 0) {
      html += '<div class="suggestion-group-label">Tên đường</div>';
      html += streetResults.slice(0, 5).map((s, i) =>
        '<div class="search-suggestion" data-type="street" data-street-index="' + i + '">'
        + '<div class="name"><span class="suggestion-icon">🗺</span> ' + escHtml(s.name) + '</div>'
        + '<div class="era">' + escHtml(s.district) + '</div>'
        + '</div>'
      ).join('');
    }

    container.innerHTML = html;
    container.classList.add('active');

    container.querySelectorAll('[data-type="person"]').forEach(el => {
      el.addEventListener('click', () => {
        const person = DataManager.getById(el.dataset.id);
        if (person) selectPerson(person);
        container.classList.remove('active');
        document.getElementById('search-input').value = '';
      });
    });

    container.querySelectorAll('[data-type="street"]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.streetIndex, 10);
        const street = streetResults[idx];
        if (street) selectStreet(street);
        container.classList.remove('active');
        document.getElementById('search-input').value = '';
      });
    });
  }

  async function selectStreet(street) {
    showToast('Đang tìm ' + street.name + '...');

    map.setView([street.lat, street.lng], 16, { animate: true });

    const person = DataManager.matchStreetName(street.name);
    if (person) {
      UIPanel.show(person);
    }

    const found = await StreetHighlight.highlight(street.name);
    if (found) {
      showToast('📍 ' + street.name + (street.district ? ' — ' + street.district : ''));
    } else {
      showToast(street.name + (street.district ? ' — ' + street.district : ''));
    }
  }

  async function selectPerson(person) {
    UIPanel.show(person);
    showToast('Đang tìm phố ' + person.name + '...');
    const found = await StreetHighlight.highlight(person.name);
    if (found) {
      showToast('📍 Đã highlight phố ' + person.name);
    } else {
      showToast('Không tìm thấy đường trên bản đồ');
    }
  }

  async function handleStreetLookup(streetName) {
    const person = DataManager.matchStreetName(streetName);
    if (person) {
      UIPanel.show(person);
      showToast('Đang tìm phố ' + person.name + '...');
      const found = await StreetHighlight.highlight(person.name);
      if (found) {
        showToast('📍 Đã highlight phố ' + person.name);
      }
    } else {
      showToast(`"${streetName}" — chưa có thông tin danh nhân`);
    }
  }

  function handleStreetChange(streetName, lat, lng) {
    const person = DataManager.matchStreetName(streetName);
    if (person) {
      UIPanel.show(person);
      StreetHighlight.highlight(person.name);
      if (gpsMode) {
        TTSEngine.speak(
          person.name + '. ' + person.summary,
          person.name
        );
      }
      showToast('📍 ' + streetName);
    }
  }

  function handlePositionUpdate(lat, lng, accuracy) {
    if (!userMarker) {
      const icon = L.divIcon({
        className: 'user-location-marker',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });
      userMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map);
      accuracyCircle = L.circle([lat, lng], {
        radius: accuracy,
        className: 'user-location-accuracy',
        interactive: false
      }).addTo(map);
    } else {
      userMarker.setLatLng([lat, lng]);
      accuracyCircle.setLatLng([lat, lng]).setRadius(accuracy);
    }

    if (gpsMode) {
      map.panTo([lat, lng], { animate: true });
    }
  }

  function setupGPSButton() {
    const btn = document.getElementById('gps-btn');
    btn.addEventListener('click', () => {
      gpsMode = !gpsMode;
      btn.classList.toggle('active', gpsMode);

      if (gpsMode) {
        StreetDetector.startTracking();
        showToast('GPS đang bật — di chuyển để khám phá');
      } else {
        StreetDetector.stopTracking();
        TTSEngine.stop();
        if (userMarker) {
          map.removeLayer(userMarker);
          map.removeLayer(accuracyCircle);
          userMarker = null;
          accuracyCircle = null;
        }
        showToast('GPS đã tắt');
      }
    });
  }

  function setupStoryTTS() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.story-tts-btn');
      if (!btn) return;
      const person = UIPanel.getCurrent();
      if (!person || !person.stories) return;
      const idx = parseInt(btn.dataset.storyIndex, 10);
      const story = person.stories[idx];
      if (story) {
        TTSEngine.speak(story.title + '. ' + story.content, story.title);
      }
    });
  }

  function handleTTSState(state, label) {
    UIPanel.updateTTSState(state, label);
  }

  async function setupAuth() {
    const user = await Auth.checkSession();
    const btnLogin = document.getElementById('btn-login');
    const btnUser = document.getElementById('btn-user');
    const dropdown = document.getElementById('user-dropdown');
    const dropdownName = document.getElementById('dropdown-name');
    const dropdownRole = document.getElementById('dropdown-role');
    const dropdownAdmin = document.getElementById('dropdown-admin');
    const dropdownUsers = document.getElementById('dropdown-users');
    const dropdownPassword = document.getElementById('dropdown-password');
    const dropdownLogout = document.getElementById('dropdown-logout');

    if (user) {
      btnLogin.style.display = 'none';
      btnUser.style.display = '';
      dropdownName.textContent = user.username;
      const roleLabels = { superadmin: 'Superadmin', admin: 'Admin', user: 'Thành viên' };
      dropdownRole.textContent = roleLabels[user.role] || user.role;

      if (user.role === 'admin' || user.role === 'superadmin') {
        dropdownAdmin.style.display = '';
      }
      if (user.role === 'superadmin') {
        dropdownUsers.style.display = '';
      }

      btnUser.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
      });

      document.addEventListener('click', (e) => {
        if (!e.target.closest('.user-menu')) {
          dropdown.classList.remove('open');
        }
      });

      dropdownPassword.addEventListener('click', () => {
        dropdown.classList.remove('open');
        showChangePasswordDialog();
      });

      dropdownLogout.addEventListener('click', async () => {
        dropdown.classList.remove('open');
        await Auth.logout();
        window.location.reload();
      });
    }
  }

  function showChangePasswordDialog() {
    const existing = document.getElementById('password-dialog-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'password-dialog-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px';

    overlay.innerHTML = `
      <div style="background:#2a1a14;border:1px solid rgba(240,200,80,0.2);border-radius:16px;padding:28px;width:100%;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.5)">
        <h3 style="color:#f0c850;font-size:16px;font-weight:700;margin:0 0 20px;font-family:var(--font-body)">Đổi mật khẩu</h3>
        <div id="pw-error" style="display:none;background:rgba(220,50,50,0.2);border:1px solid rgba(220,50,50,0.4);color:#ffaaaa;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:14px"></div>
        <div id="pw-success" style="display:none;background:rgba(50,180,50,0.2);border:1px solid rgba(50,180,50,0.4);color:#aaffaa;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:14px"></div>
        <label style="display:block;font-size:13px;color:#f0c850;margin-bottom:4px;font-family:var(--font-body)">Mật khẩu cũ</label>
        <input type="password" id="pw-old" style="width:100%;padding:10px 12px;border:1px solid rgba(240,200,80,0.25);border-radius:8px;background:rgba(0,0,0,0.2);color:#f5efe6;font-size:14px;margin-bottom:14px;outline:none;font-family:var(--font-body);box-sizing:border-box" />
        <label style="display:block;font-size:13px;color:#f0c850;margin-bottom:4px;font-family:var(--font-body)">Mật khẩu mới</label>
        <input type="password" id="pw-new" style="width:100%;padding:10px 12px;border:1px solid rgba(240,200,80,0.25);border-radius:8px;background:rgba(0,0,0,0.2);color:#f5efe6;font-size:14px;margin-bottom:14px;outline:none;font-family:var(--font-body);box-sizing:border-box" />
        <label style="display:block;font-size:13px;color:#f0c850;margin-bottom:4px;font-family:var(--font-body)">Nhập lại mật khẩu mới</label>
        <input type="password" id="pw-new2" style="width:100%;padding:10px 12px;border:1px solid rgba(240,200,80,0.25);border-radius:8px;background:rgba(0,0,0,0.2);color:#f5efe6;font-size:14px;margin-bottom:18px;outline:none;font-family:var(--font-body);box-sizing:border-box" />
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button id="pw-cancel" style="padding:9px 18px;border:1px solid rgba(240,200,80,0.2);border-radius:8px;background:transparent;color:rgba(240,200,80,0.7);cursor:pointer;font-family:var(--font-body);font-size:13px">Hủy</button>
          <button id="pw-save" style="padding:9px 18px;border:none;border-radius:8px;background:linear-gradient(135deg,#f0c850,#d4a840);color:#8b1a1a;font-weight:700;cursor:pointer;font-family:var(--font-body);font-size:13px">Lưu</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('pw-cancel').addEventListener('click', () => overlay.remove());

    document.getElementById('pw-save').addEventListener('click', async () => {
      const errEl = document.getElementById('pw-error');
      const sucEl = document.getElementById('pw-success');
      errEl.style.display = 'none';
      sucEl.style.display = 'none';

      const oldPw = document.getElementById('pw-old').value;
      const newPw = document.getElementById('pw-new').value;
      const newPw2 = document.getElementById('pw-new2').value;

      if (!oldPw || !newPw) {
        errEl.textContent = 'Vui lòng nhập đầy đủ';
        errEl.style.display = 'block';
        return;
      }
      if (newPw !== newPw2) {
        errEl.textContent = 'Mật khẩu mới không khớp';
        errEl.style.display = 'block';
        return;
      }
      if (newPw.length < 6) {
        errEl.textContent = 'Mật khẩu mới phải ít nhất 6 ký tự';
        errEl.style.display = 'block';
        return;
      }

      try {
        const resp = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }),
        });
        const result = await resp.json();
        if (result.success) {
          sucEl.textContent = 'Đổi mật khẩu thành công!';
          sucEl.style.display = 'block';
          setTimeout(() => overlay.remove(), 1200);
        } else {
          errEl.textContent = result.error || 'Đổi mật khẩu thất bại';
          errEl.style.display = 'block';
        }
      } catch {
        errEl.textContent = 'Lỗi kết nối server';
        errEl.style.display = 'block';
      }
    });

    document.getElementById('pw-old').focus();
  }

  let toastTimer;
  function showToast(msg) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();
