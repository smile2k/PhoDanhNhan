const StreetHighlight = (() => {
  let map = null;
  let highlightLayer = null;
  let hasResult = false;
  let requestId = 0;

  function init(leafletMap) {
    map = leafletMap;
    highlightLayer = L.layerGroup().addTo(map);
  }

  function clear() {
    if (highlightLayer) highlightLayer.clearLayers();
    hasResult = false;
    requestId++;
  }

  async function highlight(personName) {
    if (!personName || !map) return false;
    clear();

    const myId = requestId;

    const namesToTry = buildNameVariants(personName);

    for (const name of namesToTry) {
      if (requestId !== myId) return false;

      const ways = await queryOverpass(name);
      if (requestId !== myId) return false;

      const streets = ways.filter(w => w.tags && w.tags.highway);
      if (streets.length > 0) {
        drawStreets(streets, personName);
        return true;
      }
    }

    return false;
  }

  function buildNameVariants(name) {
    const stripped = name
      .replace(/^(Phố|Đường|Ngõ|Ngách)\s+/i, '')
      .trim();

    return [
      'Phố ' + stripped,
      'Đường ' + stripped,
      stripped
    ];
  }

  function drawStreets(ways, label) {
    const allCoords = [];
    const color = getComputedStyle(document.documentElement)
      .getPropertyValue('--highlight-street').trim() || '#d4563e';

    for (const way of ways) {
      if (!way.geometry || way.geometry.length < 2) continue;

      const coords = way.geometry.map(p => [p.lat, p.lon]);
      allCoords.push(...coords);

      highlightLayer.addLayer(L.polyline(coords, {
        color,
        weight: 12,
        opacity: 0.15,
        lineCap: 'round',
        lineJoin: 'round'
      }));

      highlightLayer.addLayer(L.polyline(coords, {
        color,
        weight: 4,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
      }));

      addArrows(coords, color);
    }

    hasResult = allCoords.length > 1;

    if (hasResult) {
      const bounds = L.latLngBounds(allCoords);
      const center = bounds.getCenter();

      addNameLabel(center, label, color);
      addEndpointMarkers(allCoords, color);

      map.fitBounds(bounds, { padding: [70, 70], maxZoom: 17 });
    }
  }

  function addArrows(coords, color) {
    const totalDist = polylineLength(coords);
    if (totalDist < 50) return;
    const step = Math.max(150, totalDist / 6);
    let accumulated = step;

    for (let i = 1; i < coords.length; i++) {
      const segLen = haversine(coords[i - 1], coords[i]);
      if (segLen < 1) continue;

      while (accumulated <= segLen) {
        const t = accumulated / segLen;
        const lat = coords[i - 1][0] + t * (coords[i][0] - coords[i - 1][0]);
        const lng = coords[i - 1][1] + t * (coords[i][1] - coords[i - 1][1]);
        const angle = bearing(coords[i - 1], coords[i]);

        const arrowIcon = L.divIcon({
          className: 'street-arrow',
          html: '<svg width="16" height="16" viewBox="0 0 16 16" style="transform:rotate(' + angle + 'deg)">'
            + '<path d="M8 1 L14 13 L8 9 L2 13 Z" fill="' + color + '" opacity="0.65"/>'
            + '</svg>',
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        });

        highlightLayer.addLayer(L.marker([lat, lng], {
          icon: arrowIcon,
          interactive: false
        }));

        accumulated += step;
      }
      accumulated -= segLen;
    }
  }

  function addNameLabel(center, label, color) {
    const labelIcon = L.divIcon({
      className: '',
      html: '<div style="'
        + 'background:' + color + ';'
        + 'color:#fff;'
        + 'padding:4px 12px;'
        + 'border-radius:16px;'
        + 'font-family:Be Vietnam Pro,system-ui,sans-serif;'
        + 'font-size:12px;'
        + 'font-weight:600;'
        + 'white-space:nowrap;'
        + 'box-shadow:0 2px 8px rgba(0,0,0,0.3);'
        + 'display:inline-flex;align-items:center;gap:5px;'
        + 'position:relative;left:-50%;'
        + '">📍 ' + escHtml(label) + '</div>',
      iconSize: [0, 0],
      iconAnchor: [0, 12]
    });

    highlightLayer.addLayer(
      L.marker(center, { icon: labelIcon, zIndexOffset: 500 })
    );
  }

  function addEndpointMarkers(allCoords, color) {
    if (allCoords.length < 2) return;

    const start = allCoords[0];
    const end = allCoords[allCoords.length - 1];

    const dot = (coord, letter) => {
      const icon = L.divIcon({
        className: '',
        html: '<div style="'
          + 'width:22px;height:22px;'
          + 'background:#fff;'
          + 'border:3px solid ' + color + ';'
          + 'border-radius:50%;'
          + 'display:flex;align-items:center;justify-content:center;'
          + 'font-size:10px;font-weight:700;color:' + color + ';'
          + 'box-shadow:0 1px 4px rgba(0,0,0,0.25);'
          + '">' + letter + '</div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });
      return L.marker(coord, { icon, interactive: false });
    };

    highlightLayer.addLayer(dot(start, 'A'));
    highlightLayer.addLayer(dot(end, 'B'));
  }

  function polylineLength(coords) {
    let total = 0;
    for (let i = 1; i < coords.length; i++) {
      total += haversine(coords[i - 1], coords[i]);
    }
    return total;
  }

  function haversine(a, b) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLng = toRad(b[1] - a[1]);
    const s = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  function bearing(a, b) {
    const toRad = d => d * Math.PI / 180;
    const toDeg = r => r * 180 / Math.PI;
    const dLng = toRad(b[1] - a[1]);
    const y = Math.sin(dLng) * Math.cos(toRad(b[0]));
    const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0]))
      - Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  async function queryOverpass(streetName) {
    const bbox = '20.95,105.7,21.1,105.95';
    const escaped = escapeOverpass(streetName);
    const query = '[out:json][timeout:15];way["name"="' + escaped + '"]["highway"]('+bbox+');out geom;';

    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter'
    ];

    for (const url of endpoints) {
      try {
        const formData = new URLSearchParams();
        formData.set('data', query);

        const resp = await fetch(url, {
          method: 'POST',
          body: formData
        });
        if (!resp.ok) continue;
        const text = await resp.text();
        if (!text.trim().startsWith('{')) continue;
        const data = JSON.parse(text);
        return data.elements || [];
      } catch {
        continue;
      }
    }
    return [];
  }

  function escapeOverpass(str) {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function hasHighlight() {
    return hasResult;
  }

  return { init, highlight, clear, hasHighlight, haversine };
})();
