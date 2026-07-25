// ============================================================================
// Geofence — confirmación automática de visita por GPS.
// Monitorea la posición del IBP y, si entra en el radio definido de la
// coordenada de un cliente pendiente, dispara onCerca(clienteId).
// El botón manual (en ibp.html) sigue disponible como respaldo si el GPS
// falla o la coordenada está mal cargada.
// ============================================================================

const RADIO_METROS = 100;

function _distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function iniciarGeofence({ onCerca, getPendientes, onEstado }) {
  if (!("geolocation" in navigator)) {
    onEstado("Este dispositivo no soporta geolocalización. Usa el botón manual.");
    return;
  }

  navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      onEstado(`Ubicación activa (±${Math.round(pos.coords.accuracy)}m).`);

      const pendientes = getPendientes();
      for (const cliente of pendientes) {
        const d = _distanciaMetros(latitude, longitude, cliente.lat, cliente.lng);
        if (d <= RADIO_METROS) {
          onCerca(cliente.id);
        }
      }
    },
    (err) => {
      onEstado("No se pudo obtener ubicación (" + err.message + "). Usa el botón manual.");
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
  );
}

window.BimboGeo = { iniciarGeofence };
