const StreetDetector = (() => {
  let watchId = null;
  let isTracking = false;
  let lastStreetName = null;
  let onStreetChange = null;
  let onPositionUpdate = null;
  let onError = null;

  function init(callbacks) {
    onStreetChange = callbacks.onStreetChange || null;
    onPositionUpdate = callbacks.onPositionUpdate || null;
    onError = callbacks.onError || null;
  }

  function startTracking() {
    if (isTracking) return;
    if (!navigator.geolocation) {
      if (onError) onError('Trình duyệt không hỗ trợ GPS');
      return;
    }

    isTracking = true;
    watchId = navigator.geolocation.watchPosition(
      handlePosition,
      handleError,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  function stopTracking() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    isTracking = false;
    lastStreetName = null;
  }

  function getTracking() {
    return isTracking;
  }

  async function handlePosition(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const accuracy = position.coords.accuracy;

    if (onPositionUpdate) {
      onPositionUpdate(lat, lng, accuracy);
    }

    try {
      const streetName = await reverseGeocode(lat, lng);
      if (streetName && streetName !== lastStreetName) {
        lastStreetName = streetName;
        if (onStreetChange) onStreetChange(streetName, lat, lng);
      }
    } catch {
      // silently ignore geocoding failures during tracking
    }
  }

  function handleError(err) {
    const messages = {
      1: 'Bạn chưa cho phép truy cập vị trí',
      2: 'Không thể xác định vị trí',
      3: 'Hết thời gian chờ GPS'
    };
    if (onError) onError(messages[err.code] || 'Lỗi GPS');
    stopTracking();
  }

  async function reverseGeocode(lat, lng) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1&accept-language=vi`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'PhoDanhNhanHanoi/1.0' }
    });
    if (!resp.ok) return null;
    const data = await resp.json();

    const road = data.address?.road
      || data.address?.pedestrian
      || data.address?.footway
      || null;

    return road;
  }

  async function detectStreetAt(lat, lng) {
    const streetName = await reverseGeocode(lat, lng);
    return streetName;
  }

  return { init, startTracking, stopTracking, getTracking, detectStreetAt, reverseGeocode };
})();
