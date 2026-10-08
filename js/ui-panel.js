const UIPanel = (() => {
  let panelEl, nameEl, metaEl, bodyEl, tabsEl, ttsBar;
  let closeBtn, thumbEl;
  let currentPerson = null;
  let currentTab = 'bio';
  let thumbRequestId = 0;
  let map_ref = null;

  function init(leafletMap) {
    map_ref = leafletMap || null;
    panelEl = document.getElementById('info-panel');
    nameEl = panelEl.querySelector('.panel-name');
    metaEl = panelEl.querySelector('.panel-meta');
    bodyEl = panelEl.querySelector('.panel-body');
    tabsEl = panelEl.querySelector('.panel-tabs');
    ttsBar = panelEl.querySelector('.tts-bar');
    closeBtn = panelEl.querySelector('.panel-close');
    thumbEl = document.getElementById('panel-thumb');

    closeBtn.addEventListener('click', close);

    panelEl.querySelector('.panel-drag-handle').addEventListener('click', () => {
      if (panelEl.classList.contains('minimized')) {
        panelEl.classList.remove('minimized');
        panelEl.classList.add('open');
      } else if (panelEl.classList.contains('open')) {
        panelEl.classList.remove('open');
        panelEl.classList.add('minimized');
      }
    });

    setupTabs();
    setupTTSBar();
  }

  function setupTabs() {
    tabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.panel-tab');
      if (!btn) return;
      switchTab(btn.dataset.tab);
    });
  }

  function switchTab(tabName) {
    currentTab = tabName;
    tabsEl.querySelectorAll('.panel-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    bodyEl.querySelectorAll('.tab-content').forEach(c => {
      c.classList.toggle('active', c.dataset.tab === tabName);
    });
  }

  function setupTTSBar() {
    const playBtn = ttsBar.querySelector('.tts-play');
    const stopBtn = ttsBar.querySelector('.tts-stop');
    const speedBtn = ttsBar.querySelector('.tts-speed');

    playBtn.addEventListener('click', () => {
      if (!currentPerson) return;
      const text = getReadableText();
      TTSEngine.togglePlayPause(text, currentPerson.name);
    });

    stopBtn.addEventListener('click', () => {
      TTSEngine.stop();
    });

    speedBtn.addEventListener('click', () => {
      const speeds = [0.75, 1.0, 1.25, 1.5];
      const current = parseFloat(speedBtn.textContent);
      const idx = speeds.indexOf(current);
      const next = speeds[(idx + 1) % speeds.length];
      speedBtn.textContent = next + 'x';
      TTSEngine.setRate(next);
    });
  }

  function getReadableText() {
    if (!currentPerson) return '';
    const parts = [currentPerson.name];
    if (currentPerson.title) parts.push(currentPerson.title);
    parts.push(currentPerson.summary || '');
    parts.push(currentPerson.bio || '');
    if (currentPerson.stories) {
      for (const story of currentPerson.stories) {
        parts.push(story.title + '. ' + story.content);
      }
    }
    return parts.join('. ');
  }

  function show(person) {
    currentPerson = person;
    renderHeader(person);
    loadThumbnail(person);
    renderBody(person);
    switchTab('bio');
    panelEl.classList.remove('minimized');
    panelEl.classList.add('open');
  }

  async function loadThumbnail(person) {
    const reqId = ++thumbRequestId;
    thumbEl.classList.remove('visible');
    thumbEl.innerHTML = '';

    if (!person.wikiSlug) return;

    if (person._wiki) {
      if (person._wiki.thumbnail) showThumb(person._wiki.thumbnail, reqId);
      return;
    }

    const wiki = await DataManager.fetchWikiSummary(person.wikiSlug);
    if (!wiki) return;
    person._wiki = wiki;
    if (wiki.thumbnail && reqId === thumbRequestId) {
      showThumb(wiki.thumbnail, reqId);
    }
  }

  function showThumb(url, reqId) {
    if (reqId !== thumbRequestId) return;
    const img = new Image();
    img.alt = currentPerson?.name || '';
    img.onload = () => {
      if (reqId !== thumbRequestId) return;
      thumbEl.innerHTML = '';
      thumbEl.appendChild(img);
      thumbEl.classList.add('visible');
    };
    img.src = url;
  }

  function close() {
    panelEl.classList.remove('open', 'minimized');
    TTSEngine.stop();
    currentPerson = null;
  }

  function renderHeader(person) {
    nameEl.textContent = person.name;

    const tags = [];
    if (person.born || person.died) {
      tags.push(`${person.born || '?'} – ${person.died || '?'}`);
    }
    if (person.era) tags.push(person.era);
    if (person.title) tags.push(person.title);

    metaEl.innerHTML = tags
      .map(t => `<span class="panel-meta-tag">${escHtml(t)}</span>`)
      .join('');
  }

  function renderBody(person) {
    bodyEl.innerHTML = `
      <div class="tab-content active" data-tab="bio">
        <div class="bio-summary">${escHtml(person.summary || '')}</div>
        <div class="bio-text">${escHtml(person.bio || '').replace(/\n/g, '<br>')}</div>
        ${person.wikiSlug ? `
          <a class="wiki-link" href="https://vi.wikipedia.org/wiki/${encodeURIComponent(person.wikiSlug)}" target="_blank" rel="noopener">
            📖 Đọc thêm trên Wikipedia
          </a>
        ` : ''}
      </div>
      <div class="tab-content" data-tab="stories">
        ${renderStories(person.stories || [])}
      </div>
      <div class="tab-content" data-tab="street">
        <div class="street-note">${escHtml(person.streetNote || 'Chưa có thông tin về con phố.').replace(/\n/g, '<br>')}</div>
      </div>
      <div class="tab-content" data-tab="explore">
        <button class="spot-add-btn" id="spot-add-btn">+ Thêm địa điểm</button>
        <div id="spot-form-container"></div>
        <div id="spot-feed" class="spot-feed"><div class="loading-spinner" style="margin:20px auto"></div></div>
      </div>
    `;
    loadSpotFeed(person);
  }

  async function loadSpotFeed(person) {
    const feedEl = bodyEl.querySelector('#spot-feed');
    if (!feedEl) return;
    const spots = await Spots.loadForPerson(person.id);
    const user = await getLoggedInUser();
    Spots.renderFeed(spots, feedEl, user);
    setupSpotActions(feedEl, person);
    setupSpotAddButton(person);
  }

  function setupSpotActions(feedEl, person) {
    feedEl.addEventListener('click', async (e) => {
      const likeBtn = e.target.closest('.spot-like-btn');
      if (likeBtn) {
        const spotId = likeBtn.dataset.spotId;
        try {
          const result = await Spots.toggleLike(spotId);
          likeBtn.querySelector('span').textContent = result.likes;
        } catch { /* ignore */ }
        return;
      }
      const delBtn = e.target.closest('.spot-delete-btn');
      if (delBtn) {
        const spotId = delBtn.dataset.spotId;
        try {
          await Spots.deleteSpot(spotId);
          delBtn.closest('.spot-card').remove();
        } catch { /* ignore */ }
      }
    });
  }

  function setupSpotAddButton(person) {
    const addBtn = bodyEl.querySelector('#spot-add-btn');
    const formContainer = bodyEl.querySelector('#spot-form-container');
    if (!addBtn || !formContainer) return;

    addBtn.addEventListener('click', async () => {
      const user = await getLoggedInUser();
      if (!user) {
        window.location.href = '/login.html';
        return;
      }
      if (formContainer.innerHTML) {
        formContainer.innerHTML = '';
        return;
      }
      const cats = Spots.getCategoryIcons();
      formContainer.innerHTML = `
        <div class="spot-form">
          <select id="spot-category" class="spot-form-select">
            ${Object.entries(cats).map(([k, v]) => `<option value="${k}">${v.emoji} ${escHtml(v.label)}</option>`).join('')}
          </select>
          <input type="text" id="spot-title" class="spot-form-input" placeholder="Tiêu đề (vd: Phở Thìn)" maxlength="100" />
          <textarea id="spot-content" class="spot-form-textarea" placeholder="Mô tả ngắn..." rows="2" maxlength="500"></textarea>
          <input type="url" id="spot-image" class="spot-form-input" placeholder="Link ảnh (tùy chọn)" />
          <button id="spot-submit" class="spot-form-submit">Đăng</button>
        </div>
      `;
      formContainer.querySelector('#spot-submit').addEventListener('click', async () => {
        const title = formContainer.querySelector('#spot-title').value.trim();
        if (!title) return;
        const center = map_ref ? map_ref.getCenter() : { lat: 0, lng: 0 };
        try {
          await Spots.createSpot({
            street_name: person.name,
            person_id: person.id,
            lat: center.lat,
            lng: center.lng,
            category: formContainer.querySelector('#spot-category').value,
            title,
            content: formContainer.querySelector('#spot-content').value.trim() || null,
            image_url: formContainer.querySelector('#spot-image').value.trim() || null,
          });
          formContainer.innerHTML = '';
          loadSpotFeed(person);
        } catch { /* ignore */ }
      });
    });
  }

  async function getLoggedInUser() {
    try {
      const resp = await fetch('/api/auth/me');
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.success ? data.user : null;
    } catch { return null; }
  }

  function renderStories(stories) {
    if (!stories.length) {
      return '<div class="empty-state"><div class="empty-state-text">Chưa có câu chuyện nào.</div></div>';
    }
    return stories.map((story, i) => `
      <div class="story-card">
        <div class="story-title">${escHtml(story.title)}</div>
        <div class="story-content">${escHtml(story.content).replace(/\n/g, '<br>')}</div>
        <button class="story-tts-btn" data-story-index="${i}">
          🔊 Nghe câu chuyện
        </button>
      </div>
    `).join('');
  }

  function updateTTSState(state, label) {
    const labelEl = ttsBar.querySelector('.tts-label');
    const playBtn = ttsBar.querySelector('.tts-play');

    if (state === 'speaking') {
      labelEl.textContent = `Đang đọc: ${label || currentPerson?.name || ''}`;
      labelEl.classList.add('speaking');
      playBtn.textContent = '⏸';
    } else if (state === 'paused') {
      labelEl.textContent = 'Tạm dừng';
      labelEl.classList.remove('speaking');
      playBtn.textContent = '▶';
    } else {
      labelEl.textContent = 'Nhấn ▶ để nghe';
      labelEl.classList.remove('speaking');
      playBtn.textContent = '▶';
    }
  }

  function isOpen() {
    return panelEl.classList.contains('open') || panelEl.classList.contains('minimized');
  }

  function getCurrent() {
    return currentPerson;
  }

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { init, show, close, updateTTSState, isOpen, getCurrent };
})();
