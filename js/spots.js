const Spots = (() => {
  let map = null;
  let spotLayer = null;
  let onSpotClick = null;

  const CATEGORY_ICONS = {
    food: { emoji: '🍜', label: 'Quán ăn' },
    cafe: { emoji: '☕', label: 'Cafe' },
    checkin: { emoji: '📸', label: 'Check-in' },
    tip: { emoji: '💡', label: 'Mẹo du lịch' }
  };

  function init(leafletMap, callbacks) {
    map = leafletMap;
    spotLayer = L.layerGroup().addTo(map);
    onSpotClick = callbacks.onSpotClick || null;
  }

  async function loadForStreet(streetName) {
    try {
      const resp = await fetch('/api/spots?street=' + encodeURIComponent(streetName));
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.spots || [];
    } catch { return []; }
  }

  async function loadForPerson(personId) {
    try {
      const resp = await fetch('/api/spots?person=' + encodeURIComponent(personId));
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.spots || [];
    } catch { return []; }
  }

  async function createSpot(spotData) {
    const resp = await fetch('/api/spots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(spotData)
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Lỗi tạo spot');
    return data.spot;
  }

  async function deleteSpot(spotId) {
    const resp = await fetch('/api/spots/' + spotId, { method: 'DELETE' });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Lỗi xóa spot');
  }

  async function toggleLike(spotId) {
    const resp = await fetch('/api/spots/' + spotId + '/like', { method: 'POST' });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Lỗi');
    return data;
  }

  function renderMarkers(spots) {
    spotLayer.clearLayers();
    for (const spot of spots) {
      if (!spot.lat || !spot.lng) continue;
      const cat = CATEGORY_ICONS[spot.category] || CATEGORY_ICONS.tip;
      const icon = L.divIcon({
        className: '',
        html: '<div class="spot-marker spot-marker-' + spot.category + '">' + cat.emoji + '</div>',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });
      const marker = L.marker([spot.lat, spot.lng], { icon }).addTo(spotLayer);
      marker.bindPopup(
        '<strong>' + escHtml(spot.title) + '</strong>'
        + '<br><span style="font-size:12px;color:#666">' + escHtml(spot.username || '') + '</span>'
      );
      if (onSpotClick) {
        marker.on('click', () => onSpotClick(spot));
      }
    }
  }

  function clearMarkers() {
    if (spotLayer) spotLayer.clearLayers();
  }

  function renderFeed(spots, container, currentUser) {
    if (!spots.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Chưa có bài viết nào cho phố này.</div></div>';
      return;
    }
    container.innerHTML = spots.map(s => {
      const cat = CATEGORY_ICONS[s.category] || CATEGORY_ICONS.tip;
      const timeAgo = formatTimeAgo(s.created_at);
      const canDelete = currentUser && (currentUser.id === s.user_id || currentUser.role === 'admin' || currentUser.role === 'superadmin');
      return `
        <div class="spot-card" data-spot-id="${s.id}">
          <div class="spot-card-header">
            <span class="spot-cat-badge">${cat.emoji} ${escHtml(cat.label)}</span>
            <span class="spot-card-time">${escHtml(s.username)} · ${timeAgo}</span>
          </div>
          <div class="spot-card-title">${escHtml(s.title)}</div>
          ${s.content ? '<div class="spot-card-content">' + escHtml(s.content) + '</div>' : ''}
          ${s.image_url ? '<img class="spot-card-img" src="' + escHtml(s.image_url) + '" alt="" loading="lazy">' : ''}
          <div class="spot-card-actions">
            <button class="spot-like-btn" data-spot-id="${s.id}">♥ <span>${s.likes || 0}</span></button>
            ${canDelete ? '<button class="spot-delete-btn" data-spot-id="' + s.id + '">🗑</button>' : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'Z');
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'vừa xong';
    if (diff < 3600) return Math.floor(diff / 60) + ' phút';
    if (diff < 86400) return Math.floor(diff / 3600) + ' giờ';
    if (diff < 604800) return Math.floor(diff / 86400) + ' ngày';
    return d.toLocaleDateString('vi-VN');
  }

  function getCategoryIcons() {
    return CATEGORY_ICONS;
  }

  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  return { init, loadForStreet, loadForPerson, createSpot, deleteSpot, toggleLike, renderMarkers, clearMarkers, renderFeed, getCategoryIcons };
})();
