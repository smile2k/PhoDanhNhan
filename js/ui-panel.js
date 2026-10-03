const UIPanel = (() => {
  let panelEl, nameEl, metaEl, bodyEl, tabsEl, ttsBar;
  let closeBtn;
  let currentPerson = null;
  let currentTab = 'bio';

  function init() {
    panelEl = document.getElementById('info-panel');
    nameEl = panelEl.querySelector('.panel-name');
    metaEl = panelEl.querySelector('.panel-meta');
    bodyEl = panelEl.querySelector('.panel-body');
    tabsEl = panelEl.querySelector('.panel-tabs');
    ttsBar = panelEl.querySelector('.tts-bar');
    closeBtn = panelEl.querySelector('.panel-close');

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
    renderBody(person);
    switchTab('bio');
    panelEl.classList.remove('minimized');
    panelEl.classList.add('open');
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
    `;
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
