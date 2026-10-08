const TourGuide = (() => {
  let map = null;
  let tours = [];
  let activeTour = null;
  let currentStopIndex = -1;
  let tourLayer = null;
  let onStopChange = null;
  let onTourEnd = null;
  const PROXIMITY_M = 100;

  async function init(leafletMap, callbacks) {
    map = leafletMap;
    tourLayer = L.layerGroup().addTo(map);
    onStopChange = callbacks.onStopChange || null;
    onTourEnd = callbacks.onTourEnd || null;
    try {
      const resp = await fetch('/data/tours.json');
      if (resp.ok) tours = await resp.json();
    } catch { /* tours stay empty */ }
  }

  function getTours() {
    return tours;
  }

  function start(tourId) {
    activeTour = tours.find(t => t.id === tourId);
    if (!activeTour) return false;
    currentStopIndex = -1;
    drawRoute();
    goToStop(0);
    return true;
  }

  function drawRoute() {
    tourLayer.clearLayers();
    if (!activeTour) return;

    const coords = activeTour.stops.map(s => [s.lat, s.lng]);
    tourLayer.addLayer(L.polyline(coords, {
      color: '#f0c850',
      weight: 3,
      opacity: 0.6,
      dashArray: '8 6'
    }));

    activeTour.stops.forEach((s, i) => {
      const icon = L.divIcon({
        className: '',
        html: '<div style="'
          + 'width:28px;height:28px;'
          + 'background:#8b1a1a;'
          + 'color:#f0c850;'
          + 'border:2px solid #f0c850;'
          + 'border-radius:50%;'
          + 'display:flex;align-items:center;justify-content:center;'
          + 'font-size:13px;font-weight:700;'
          + 'box-shadow:0 2px 8px rgba(0,0,0,0.3);'
          + 'font-family:Be Vietnam Pro,system-ui,sans-serif;'
          + '">' + (i + 1) + '</div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      const marker = L.marker([s.lat, s.lng], { icon }).addTo(tourLayer);
      marker.on('click', () => goToStop(i));
    });
  }

  function goToStop(index) {
    if (!activeTour || index < 0 || index >= activeTour.stops.length) return;
    currentStopIndex = index;
    const stop = activeTour.stops[index];
    map.setView([stop.lat, stop.lng], 16, { animate: true });
    updateActiveMarker(index);
    if (onStopChange) {
      onStopChange(stop.personId, index, activeTour.stops.length);
    }
  }

  function updateActiveMarker(activeIdx) {
    const layers = tourLayer.getLayers();
    layers.forEach(layer => {
      if (!(layer instanceof L.Marker)) return;
      const el = layer.getElement();
      if (!el) return;
      const inner = el.querySelector('div');
      if (!inner) return;
      const num = parseInt(inner.textContent, 10);
      if (isNaN(num)) return;
      if (num === activeIdx + 1) {
        inner.style.background = '#f0c850';
        inner.style.color = '#8b1a1a';
        inner.style.transform = 'scale(1.25)';
      } else {
        inner.style.background = '#8b1a1a';
        inner.style.color = '#f0c850';
        inner.style.transform = 'scale(1)';
      }
    });
  }

  function nextStop() {
    if (!activeTour) return;
    if (currentStopIndex < activeTour.stops.length - 1) {
      goToStop(currentStopIndex + 1);
    } else {
      stop();
    }
  }

  function prevStop() {
    if (!activeTour) return;
    if (currentStopIndex > 0) {
      goToStop(currentStopIndex - 1);
    }
  }

  function checkProximity(lat, lng) {
    if (!activeTour) return;
    for (let i = 0; i < activeTour.stops.length; i++) {
      if (i === currentStopIndex) continue;
      const s = activeTour.stops[i];
      const dist = StreetHighlight.haversine([lat, lng], [s.lat, s.lng]);
      if (dist <= PROXIMITY_M) {
        goToStop(i);
        return;
      }
    }
  }

  function stop() {
    activeTour = null;
    currentStopIndex = -1;
    tourLayer.clearLayers();
    if (onTourEnd) onTourEnd();
  }

  function isActive() {
    return activeTour !== null;
  }

  function getProgress() {
    if (!activeTour) return null;
    return {
      current: currentStopIndex,
      total: activeTour.stops.length,
      tourName: activeTour.name
    };
  }

  return { init, getTours, start, goToStop, nextStop, prevStop, checkProximity, stop, isActive, getProgress };
})();
