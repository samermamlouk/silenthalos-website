import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getFirestore,
  doc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
const GOOGLE_MAPS_API_KEY = "AIzaSyCP-RoMmPgxEOVdRDQGRUBuQEGga9j2CuM";
const firebaseConfig = {
  apiKey: "AIzaSyDFC1K702rTy76nVdVbNj8f2vcd7XEi9UM",
  authDomain: "silenthalos-dcfe1.firebaseapp.com",
  projectId: "silenthalos-dcfe1",
  storageBucket: "silenthalos-dcfe1.firebasestorage.app",
  messagingSenderId: "848829824176",
  appId: "1:848829824176:web:a7aa40b91dc042a8e18f75"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

let googleMapsPromise = null;
let incidentMap = null;
let incidentMarker = null;
let incidentAccuracyCircle = null;
let incidentPulseOverlay = null;
let incidentTrail = null;
let incidentTrailPoints = [];
let lastMapPosition = null;
let markerAnimationFrame = null;
let lastLocationUpdatedAt = null;
let liveClockTimer = null;
let currentIncidentData = null;

let galleryImages = [];
let currentGalleryIndex = 0;
let scale = 1;
let translateX = 0;
let translateY = 0;
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOriginX = 0;
let dragOriginY = 0;
let touchStartX = 0;
let initialPinchDistance = 0;
let initialPinchScale = 1;

function getIncidentId() {
  const params = new URLSearchParams(window.location.search);
  const queryId = params.get("id") || params.get("incident");
  if (queryId) return queryId.trim();

  const pathParts = window.location.pathname
    .split("/")
    .map((part) => decodeURIComponent(part.trim()))
    .filter(Boolean);

  const index = pathParts.findIndex((part) => part.toLowerCase() === "incident");
  return index >= 0 && pathParts[index + 1] ? pathParts[index + 1] : "";
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function firstUsefulValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function formatTimestamp(value) {
  if (!value) return "Unknown";

  try {
    const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown";

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "medium"
    }).format(date);
  } catch (_) {
    return "Unknown";
  }
}

function findCardByHeading(headingText) {
  return [...document.querySelectorAll(".incident-card")].find((card) => {
    const heading = card.querySelector("h2, h3");
    return heading?.textContent.trim() === headingText;
  });
}

function setActionEnabled(element, href) {
  if (!element) return;

  element.classList.remove("disabled");
  element.removeAttribute("aria-disabled");
  element.href = href;
  element.target = "_blank";
  element.rel = "noopener noreferrer";
}

function loadGoogleMaps() {
  if (window.google?.maps) return Promise.resolve(window.google.maps);

  if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === "PASTE_YOUR_KEY_HERE") {
    return Promise.reject(new Error("Google Maps API key is missing."));
  }

  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const callbackName = "__silentHalosGoogleMapsReady";

    window[callbackName] = () => {
      delete window[callbackName];
      resolve(window.google.maps);
    };

    const script = document.createElement("script");
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        GOOGLE_MAPS_API_KEY
      )}&callback=${callbackName}&v=weekly`;
    script.async = true;
    script.defer = true;

    script.onerror = () => {
      delete window[callbackName];
      googleMapsPromise = null;
      reject(new Error("Google Maps could not be loaded."));
    };

    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

function createSilentHalosMarkerIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="76" viewBox="0 0 64 76">
      <defs>
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000814" flood-opacity="0.65"/>
        </filter>
        <linearGradient id="pin" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#62d7ff"/>
          <stop offset="1" stop-color="#006eff"/>
        </linearGradient>
      </defs>
      <g filter="url(#shadow)">
        <path d="M32 2C15.4 2 2 15.4 2 32c0 22.5 30 42 30 42s30-19.5 30-42C62 15.4 48.6 2 32 2z" fill="url(#pin)"/>
        <circle cx="32" cy="31" r="19" fill="#071629" stroke="#a8ebff" stroke-width="2"/>
        <text x="32" y="37" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#ffffff">Sh</text>
      </g>
    </svg>`;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(52, 62),
    anchor: new google.maps.Point(26, 60)
  };
}

function createPulseOverlay(maps, position) {
  class PulseOverlay extends maps.OverlayView {
    constructor(map, point) {
      super();
      this.position = point;
      this.element = null;
      this.setMap(map);
    }

    onAdd() {
      this.element = document.createElement("div");
      this.element.className = "silenthalos-map-pulse";
      this.getPanes().overlayMouseTarget.appendChild(this.element);
    }

    draw() {
      if (!this.element) return;
      const projection = this.getProjection();
      const pixel = projection.fromLatLngToDivPixel(this.position);
      this.element.style.left = `${pixel.x}px`;
      this.element.style.top = `${pixel.y}px`;
    }

    setPosition(point) {
      this.position = point;
      this.draw();
    }

    onRemove() {
      this.element?.remove();
      this.element = null;
    }
  }

  return new PulseOverlay(incidentMap, position);
}

function getAccuracyMeters(data) {
  const value = firstUsefulValue(
    data.accuracyMeters,
    data.locationAccuracy,
    data.location?.accuracyMeters,
    data.location?.accuracy
  );

  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function toDateSafe(value) {
  if (!value) return null;

  try {
    const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch (_) {
    return null;
  }
}

function formatRelativeTime(value) {
  const date = toDateSafe(value);
  if (!date) return "Waiting for update";

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));

  if (seconds < 5) return "Updated now";
  if (seconds < 60) return `Updated ${seconds} sec ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  return `Updated ${hours} hr ago`;
}

function updateLiveLocationMeta(data) {
  const accuracy = getAccuracyMeters(data);
  const speed = Number(firstUsefulValue(data.speedKmh, data.deviceStatus?.speedKmh));
  const updatedAt = firstUsefulValue(
    data.location?.updatedAt,
    data.lastUpdatedAt,
    data.updatedAt,
    data.createdAt
  );

  lastLocationUpdatedAt = updatedAt;

  setText(
    "mapAccuracy",
    accuracy ? `Accuracy ±${Math.round(accuracy)} m` : "GPS accuracy unavailable"
  );

  setText(
    "mapSpeed",
    Number.isFinite(speed) ? `Speed ${Math.round(speed)} km/h` : "Speed unavailable"
  );

  setText("mapLastUpdate", formatRelativeTime(updatedAt));
  updateLiveTrackingState(data);

  if (!liveClockTimer) {
    liveClockTimer = window.setInterval(() => {
      setText("mapLastUpdate", formatRelativeTime(lastLocationUpdatedAt));
      if (currentIncidentData) updateLiveTrackingState(currentIncidentData);
    }, 1000);
  }
}

function animateMarkerTo(maps, targetPosition) {
  if (!incidentMarker) return;

  const current = incidentMarker.getPosition();
  if (!current) {
    incidentMarker.setPosition(targetPosition);
    incidentPulseOverlay?.setPosition(targetPosition);
    return;
  }

  if (markerAnimationFrame) {
    cancelAnimationFrame(markerAnimationFrame);
  }

  const startLat = current.lat();
  const startLng = current.lng();
  const endLat = targetPosition.lat();
  const endLng = targetPosition.lng();
  const startedAt = performance.now();
  const duration = 900;

  const step = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);

    const position = new maps.LatLng(
      startLat + (endLat - startLat) * eased,
      startLng + (endLng - startLng) * eased
    );

    incidentMarker.setPosition(position);
    incidentPulseOverlay?.setPosition(position);

    if (progress < 1) {
      markerAnimationFrame = requestAnimationFrame(step);
    } else {
      markerAnimationFrame = null;
    }
  };

  markerAnimationFrame = requestAnimationFrame(step);
}

function appendTrailPoint(maps, position) {
  const lastPoint = incidentTrailPoints.at(-1);

  if (
    lastPoint &&
    Math.abs(lastPoint.lat() - position.lat()) < 0.000005 &&
    Math.abs(lastPoint.lng() - position.lng()) < 0.000005
  ) {
    return;
  }

  incidentTrailPoints.push(position);

  if (incidentTrailPoints.length > 100) {
    incidentTrailPoints.shift();
  }

  if (!incidentTrail) {
    incidentTrail = new maps.Polyline({
      path: incidentTrailPoints,
      geodesic: true,
      strokeColor: "#4fc3f7",
      strokeOpacity: 0.92,
      strokeWeight: 5,
      map: incidentMap
    });
  } else {
    incidentTrail.setPath(incidentTrailPoints);
  }
}

async function renderEmbeddedMap(latitude, longitude, accuracyMeters = null) {
  const mapElement = document.getElementById("incidentMap");
  if (!mapElement) return;

  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    mapElement.classList.add("unavailable");
    mapElement.textContent = "Interactive map is not available yet.";
    return;
  }

  mapElement.classList.remove("unavailable");
  mapElement.textContent = "Loading interactive map...";

  try {
    const maps = await loadGoogleMaps();
    const position = new maps.LatLng(lat, lng);
    const mapStyles = [
      { elementType: "geometry", stylers: [{ color: "#07111f" }] },
      { elementType: "labels.text.stroke", stylers: [{ color: "#07111f" }] },
      { elementType: "labels.text.fill", stylers: [{ color: "#8ea9c1" }] },
      { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d7e9f7" }] },
      { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#72b7d4" }] },
      { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#0a2a2a" }] },
      { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#72c7b1" }] },
      { featureType: "road", elementType: "geometry", stylers: [{ color: "#182d42" }] },
      { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0d1b2a" }] },
      { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#b6c8d7" }] },
      { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#214866" }] },
      { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#102b40" }] },
      { featureType: "transit", elementType: "geometry", stylers: [{ color: "#12283a" }] },
      { featureType: "water", elementType: "geometry", stylers: [{ color: "#031b2b" }] },
      { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4da3c7" }] }
    ];

    if (!incidentMap) {
      incidentMap = new maps.Map(mapElement, {
        center: position,
        zoom: 18,
        minZoom: 3,
        maxZoom: 21,
        mapTypeId: maps.MapTypeId.ROADMAP,
        mapTypeControl: true,
        mapTypeControlOptions: {
          style: maps.MapTypeControlStyle.HORIZONTAL_BAR,
          position: maps.ControlPosition.TOP_LEFT,
          mapTypeIds: [maps.MapTypeId.ROADMAP, maps.MapTypeId.SATELLITE]
        },
        zoomControl: true,
        streetViewControl: true,
        fullscreenControl: true,
        clickableIcons: true,
        gestureHandling: "cooperative",
        styles: mapStyles
      });

      incidentMarker = new maps.Marker({
        position,
        map: incidentMap,
        title: "SilentHalos emergency location",
        icon: createSilentHalosMarkerIcon(),
        animation: maps.Animation.DROP,
        optimized: false
      });

      incidentPulseOverlay = createPulseOverlay(maps, position);
      appendTrailPoint(maps, position);
    } else {
      const moved =
        !lastMapPosition ||
        Math.abs(lastMapPosition.lat - lat) > 0.00001 ||
        Math.abs(lastMapPosition.lng - lng) > 0.00001;

      if (moved) {
        animateMarkerTo(maps, position);
        appendTrailPoint(maps, position);
        incidentMap.panTo(position);
      }
    }

    if (accuracyMeters) {
      if (!incidentAccuracyCircle) {
        incidentAccuracyCircle = new maps.Circle({
          strokeColor: "#4fc3f7",
          strokeOpacity: 0.9,
          strokeWeight: 2,
          fillColor: "#4fc3f7",
          fillOpacity: 0.16,
          map: incidentMap,
          center: position,
          radius: accuracyMeters
        });
      } else {
        incidentAccuracyCircle.setCenter(position);
        incidentAccuracyCircle.setRadius(accuracyMeters);
        incidentAccuracyCircle.setMap(incidentMap);
      }

      const bounds = incidentAccuracyCircle.getBounds();
      if (bounds && !lastMapPosition) {
        incidentMap.fitBounds(bounds, 56);
      }
    } else if (incidentAccuracyCircle) {
      incidentAccuracyCircle.setMap(null);
    }

    lastMapPosition = { lat, lng };
  } catch (error) {
    console.error("SilentHalos Google Maps loading failed:", error);
    mapElement.classList.add("unavailable");
    mapElement.textContent =
      "Interactive map could not be loaded. Use Open Map instead.";
  }
}

function renderLocation(data) {
  const latitude = firstUsefulValue(data.latitude, data.location?.latitude);
  const longitude = firstUsefulValue(data.longitude, data.location?.longitude);
  const locationLink = firstUsefulValue(
    data.locationLink,
    data.location?.link,
    latitude !== undefined && longitude !== undefined
      ? `https://maps.google.com/?q=${latitude},${longitude}`
      : ""
  );

  const locationText = document.getElementById("locationText");
  const locationButton = document.getElementById("locationButton");

  if (locationLink) {
    if (locationText) {
      locationText.textContent =
        latitude !== undefined && longitude !== undefined
          ? `Location: ${latitude}, ${longitude}`
          : "Emergency location is available.";
    }

    setActionEnabled(locationButton, locationLink);

    if (latitude !== undefined && longitude !== undefined) {
      updateLiveLocationMeta(data);
      renderEmbeddedMap(latitude, longitude, getAccuracyMeters(data));
    }
  } else {
    if (locationText) {
      locationText.textContent = "Location is not available yet.";
    }

    const mapElement = document.getElementById("incidentMap");
    if (mapElement) {
      mapElement.classList.add("unavailable");
      mapElement.textContent = "Interactive map is not available yet.";
    }
  }
}


function getIncidentUpdateDate(data) {
  return toDateSafe(
    firstUsefulValue(
      data.location?.updatedAt,
      data.lastUpdatedAt,
      data.updatedAt,
      data.audio?.updatedAt,
      data.createdAt
    )
  );
}

function updateLiveTrackingState(data) {
  const badge = document.getElementById("mapLiveBadge");
  const label = document.getElementById("mapLiveLabel");
  if (!badge || !label) return;

  const updateDate = getIncidentUpdateDate(data);
  const ageSeconds = updateDate
    ? Math.max(0, Math.floor((Date.now() - updateDate.getTime()) / 1000))
    : Number.POSITIVE_INFINITY;

  badge.classList.remove("live", "stale", "offline");

  if (ageSeconds <= 90) {
    badge.classList.add("live");
    label.textContent = "LIVE TRACKING";
  } else if (ageSeconds <= 600) {
    badge.classList.add("stale");
    label.textContent = "LAST KNOWN LOCATION";
  } else {
    badge.classList.add("offline");
    label.textContent = "TRACKING PAUSED";
  }
}

function formatDuration(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function drawFallbackWaveform(canvas) {
  if (!canvas) return;

  const context = canvas.getContext("2d");
  const width = canvas.clientWidth || 560;
  const height = canvas.clientHeight || 78;
  const ratio = window.devicePixelRatio || 1;

  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgba(125, 211, 252, 0.34)";

  const bars = 72;
  const gap = 3;
  const barWidth = Math.max(2, (width - gap * (bars - 1)) / bars);

  for (let index = 0; index < bars; index += 1) {
    const wave =
      0.3 +
      Math.abs(Math.sin(index * 0.39)) * 0.42 +
      Math.abs(Math.cos(index * 0.17)) * 0.2;
    const barHeight = Math.max(5, wave * height * 0.72);
    const x = index * (barWidth + gap);
    const y = (height - barHeight) / 2;
    context.beginPath();
    context.roundRect(x, y, barWidth, barHeight, 3);
    context.fill();
  }
}

async function drawRealWaveform(canvas, audioUrl) {
  drawFallbackWaveform(canvas);

  try {
    const response = await fetch(audioUrl, { mode: "cors" });
    if (!response.ok) throw new Error(`Audio fetch failed: ${response.status}`);

    const arrayBuffer = await response.arrayBuffer();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    const audioContext = new AudioContextClass();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const channel = audioBuffer.getChannelData(0);

    const context = canvas.getContext("2d");
    const width = canvas.clientWidth || 560;
    const height = canvas.clientHeight || 78;
    const ratio = window.devicePixelRatio || 1;

    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const bars = 84;
    const gap = 3;
    const barWidth = Math.max(2, (width - gap * (bars - 1)) / bars);
    const samplesPerBar = Math.max(1, Math.floor(channel.length / bars));
    const peaks = [];

    for (let bar = 0; bar < bars; bar += 1) {
      let peak = 0;
      const start = bar * samplesPerBar;
      const end = Math.min(channel.length, start + samplesPerBar);

      for (let index = start; index < end; index += 1) {
        peak = Math.max(peak, Math.abs(channel[index]));
      }

      peaks.push(peak);
    }

    const maximum = Math.max(...peaks, 0.001);
    context.fillStyle = "rgba(125, 211, 252, 0.58)";

    peaks.forEach((peak, index) => {
      const normalized = peak / maximum;
      const barHeight = Math.max(5, normalized * height * 0.8);
      const x = index * (barWidth + gap);
      const y = (height - barHeight) / 2;
      context.beginPath();
      context.roundRect(x, y, barWidth, barHeight, 3);
      context.fill();
    });

    await audioContext.close();
  } catch (error) {
    console.warn("SilentHalos waveform fallback:", error);
  }
}

function createPremiumAudioPlayer(audioUrl) {
  const wrapper = document.createElement("div");
  wrapper.className = "premium-audio-player";

  const header = document.createElement("div");
  header.className = "premium-audio-header";

  const titleGroup = document.createElement("div");
  titleGroup.className = "premium-audio-title-group";

  const icon = document.createElement("span");
  icon.className = "premium-audio-icon";
  icon.textContent = "🎤";

  const titles = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = "Emergency Recording";
  const subtitle = document.createElement("span");
  subtitle.textContent = "Secure emergency evidence";
  titles.append(title, subtitle);

  titleGroup.append(icon, titles);

  const durationLabel = document.createElement("span");
  durationLabel.className = "premium-audio-duration";
  durationLabel.textContent = "0:00";

  header.append(titleGroup, durationLabel);

  const waveform = document.createElement("div");
  waveform.className = "premium-waveform-seek";
  waveform.tabIndex = 0;
  waveform.setAttribute("role", "slider");
  waveform.setAttribute("aria-label", "Emergency recording position");
  waveform.setAttribute("aria-valuemin", "0");
  waveform.setAttribute("aria-valuemax", "100");
  waveform.setAttribute("aria-valuenow", "0");

  const baseCanvas = document.createElement("canvas");
  baseCanvas.className = "premium-audio-waveform waveform-base";

  const activeLayer = document.createElement("div");
  activeLayer.className = "waveform-active-layer";

  const activeCanvas = document.createElement("canvas");
  activeCanvas.className = "premium-audio-waveform waveform-active";

  const playhead = document.createElement("span");
  playhead.className = "waveform-playhead";

  activeLayer.appendChild(activeCanvas);
  waveform.append(baseCanvas, activeLayer, playhead);

  const controls = document.createElement("div");
  controls.className = "premium-audio-controls";

  const playButton = document.createElement("button");
  playButton.type = "button";
  playButton.className = "premium-audio-play";
  playButton.setAttribute("aria-label", "Play emergency recording");
  playButton.textContent = "▶";

  const timeLabel = document.createElement("span");
  timeLabel.className = "premium-audio-time";
  timeLabel.textContent = "0:00";

  const remainingLabel = document.createElement("span");
  remainingLabel.className = "premium-audio-remaining";
  remainingLabel.textContent = "-0:00";

  const audio = document.createElement("audio");
  audio.preload = "metadata";
  audio.src = audioUrl;

  const setVisualProgress = (ratio) => {
    const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
    const percentage = safeRatio * 100;

    activeLayer.style.width = `${percentage}%`;
    playhead.style.left = `${percentage}%`;
    playhead.classList.toggle("at-start", safeRatio === 0);
    playhead.classList.toggle("at-end", safeRatio === 1);

    waveform.setAttribute("aria-valuenow", String(Math.round(percentage)));
  };

  const seekToRatio = (ratio) => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;

    const safeRatio = Math.max(0, Math.min(1, ratio));
    audio.currentTime = safeRatio * audio.duration;
    setVisualProgress(safeRatio);
  };

  const seekFromPointer = (event) => {
    const rect = waveform.getBoundingClientRect();
    if (!rect.width) return;

    seekToRatio((event.clientX - rect.left) / rect.width);
  };

  let seeking = false;

  waveform.addEventListener("pointerdown", (event) => {
    seeking = true;
    waveform.setPointerCapture?.(event.pointerId);
    seekFromPointer(event);
  });

  waveform.addEventListener("pointermove", (event) => {
    if (seeking) seekFromPointer(event);
  });

  const stopSeeking = (event) => {
    if (!seeking) return;
    seeking = false;
    waveform.releasePointerCapture?.(event.pointerId);
  };

  waveform.addEventListener("pointerup", stopSeeking);
  waveform.addEventListener("pointercancel", stopSeeking);

  waveform.addEventListener("keydown", (event) => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;

    const step = event.shiftKey ? 10 : 5;

    if (event.key === "ArrowRight") {
      event.preventDefault();
      audio.currentTime = Math.min(audio.duration, audio.currentTime + step);
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      audio.currentTime = Math.max(0, audio.currentTime - step);
    }

    if (event.key === "Home") {
      event.preventDefault();
      audio.currentTime = 0;
    }

    if (event.key === "End") {
      event.preventDefault();
      audio.currentTime = audio.duration;
    }
  });

  playButton.addEventListener("click", async () => {
    if (audio.paused) {
      try {
        await audio.play();
      } catch (error) {
        console.error("SilentHalos audio playback failed:", error);
      }
    } else {
      audio.pause();
    }
  });

  audio.addEventListener("play", () => {
    playButton.textContent = "❚❚";
    playButton.setAttribute("aria-label", "Pause emergency recording");
    wrapper.classList.add("playing");
  });

  audio.addEventListener("pause", () => {
    playButton.textContent = "▶";
    playButton.setAttribute("aria-label", "Play emergency recording");
    wrapper.classList.remove("playing");
  });

  audio.addEventListener("loadedmetadata", () => {
    durationLabel.textContent = formatDuration(audio.duration);
    remainingLabel.textContent = `-${formatDuration(audio.duration)}`;
    setVisualProgress(0);
  });

  audio.addEventListener("timeupdate", () => {
    timeLabel.textContent = formatDuration(audio.currentTime);

    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      const ratio = audio.currentTime / audio.duration;
      setVisualProgress(ratio);
      remainingLabel.textContent = `-${formatDuration(
        Math.max(0, audio.duration - audio.currentTime)
      )}`;
    }
  });

  audio.addEventListener("ended", () => {
    audio.currentTime = 0;
    timeLabel.textContent = "0:00";
    remainingLabel.textContent = `-${formatDuration(audio.duration)}`;
    setVisualProgress(0);
  });

  controls.append(playButton, timeLabel, remainingLabel);
  wrapper.append(header, waveform, controls, audio);

  requestAnimationFrame(async () => {
    await Promise.all([
      drawRealWaveform(baseCanvas, audioUrl),
      drawRealWaveform(activeCanvas, audioUrl)
    ]);
    setVisualProgress(0);
  });

  setVisualProgress(0);
  return wrapper;
}

function normalizeAudioRecordings(data) {
  const candidates = [
    data.audioRecordings,
    data.audioClips,
    data.recordings,
    data.audio?.recordings,
    data.audio?.clips,
    data.audioUpdates
  ];

  const source = candidates.find((value) => Array.isArray(value)) || [];
  const recordings = source
    .map((item, index) => {
      if (typeof item === "string") {
        return {
          url: item,
          createdAt: null,
          sequence: index + 1,
          durationSeconds: null
        };
      }

      if (!item || typeof item !== "object") return null;

      const url = firstUsefulValue(
        item.url,
        item.audioUrl,
        item.downloadUrl,
        item.storageUrl,
        item.fileUrl
      );

      if (!url) return null;

      return {
        url,
        createdAt: firstUsefulValue(
          item.createdAt,
          item.recordedAt,
          item.uploadedAt,
          item.updatedAt,
          item.timestamp
        ),
        sequence: Number(firstUsefulValue(item.sequence, item.index, index + 1)),
        durationSeconds: Number(
          firstUsefulValue(item.durationSeconds, item.duration, item.lengthSeconds)
        )
      };
    })
    .filter(Boolean);

  const legacyUrl = firstUsefulValue(
    data.audioUrl,
    data.audio?.url,
    data.audio?.downloadUrl
  );

  if (legacyUrl && !recordings.some((item) => item.url === legacyUrl)) {
    recordings.push({
      url: legacyUrl,
      createdAt: firstUsefulValue(
        data.audio?.updatedAt,
        data.audioUploadedAt,
        data.createdAt
      ),
      sequence: recordings.length + 1,
      durationSeconds: Number(
        firstUsefulValue(data.audio?.durationSeconds, data.audioDurationSeconds)
      )
    });
  }

  return recordings.sort((left, right) => {
    const leftDate = toDateSafe(left.createdAt)?.getTime() || 0;
    const rightDate = toDateSafe(right.createdAt)?.getTime() || 0;
    if (leftDate !== rightDate) return rightDate - leftDate;
    return (right.sequence || 0) - (left.sequence || 0);
  });
}

function renderAudio(data) {
  const list = document.getElementById("audioUpdatesList");
  const summary = document.getElementById("audioUpdatesSummary");
  if (!list) return;

  const recordings = normalizeAudioRecordings(data);
  list.replaceChildren();

  if (!recordings.length) {
    if (summary) {
      summary.textContent = "No emergency recording has arrived yet. This page updates automatically.";
    }

    const empty = document.createElement("div");
    empty.className = "audio-updates-empty";
    empty.textContent = "Waiting for the first secure audio update...";
    list.appendChild(empty);
    return;
  }

  if (summary) {
    summary.textContent = `${recordings.length} secure emergency recording${recordings.length === 1 ? "" : "s"} available. New recordings appear automatically.`;
  }

  recordings.forEach((recording, index) => {
    const item = document.createElement("section");
    item.className = "audio-update-item";

    const meta = document.createElement("div");
    meta.className = "audio-update-meta";

    const title = document.createElement("strong");
    title.textContent = `Emergency Recording ${recordings.length - index}`;

    const details = document.createElement("span");
    const duration = Number.isFinite(recording.durationSeconds) && recording.durationSeconds > 0
      ? `${Math.round(recording.durationSeconds)} sec`
      : "Secure audio";
    const time = recording.createdAt ? formatTimestamp(recording.createdAt) : "Time pending";
    details.textContent = `${time} • ${duration}`;

    meta.append(title, details);
    item.append(meta, createPremiumAudioPlayer(recording.url));
    list.appendChild(item);
  });
}

async function resolvePhotoUrl(dataUrl, incidentId, filename) {
  if (dataUrl) return dataUrl;

  try {
    return await getDownloadURL(
      ref(storage, `incidents/${incidentId}/photos/${filename}`)
    );
  } catch (error) {
    if (error?.code !== "storage/object-not-found") {
      console.warn(`SilentHalos could not load ${filename}:`, error);
    }
    return "";
  }
}

function applyTransform() {
  const image = document.getElementById("galleryModalImage");
  if (!image) return;

  image.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  image.classList.toggle("zoomed", scale > 1);
}

function resetZoom() {
  scale = 1;
  translateX = 0;
  translateY = 0;
  applyTransform();
}

function setScale(nextScale, anchorX = 0, anchorY = 0) {
  const clamped = Math.min(5, Math.max(1, nextScale));

  if (clamped === 1) {
    resetZoom();
    return;
  }

  if (scale !== clamped) {
    const ratio = clamped / scale;
    translateX = anchorX - (anchorX - translateX) * ratio;
    translateY = anchorY - (anchorY - translateY) * ratio;
    scale = clamped;
    applyTransform();
  }
}

function openGallery(index) {
  if (!galleryImages.length) return;

  currentGalleryIndex = index;
  resetZoom();

  const modal = document.getElementById("galleryModal");
  const image = document.getElementById("galleryModalImage");
  const counter = document.getElementById("galleryCounter");

  image.src = galleryImages[index].url;
  image.alt = galleryImages[index].label;
  counter.textContent = `${index + 1} / ${galleryImages.length}`;

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeGallery() {
  const modal = document.getElementById("galleryModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  resetZoom();
}

function moveGallery(direction) {
  if (!galleryImages.length) return;

  const nextIndex =
    (currentGalleryIndex + direction + galleryImages.length) % galleryImages.length;

  openGallery(nextIndex);
}

function getDistance(touchA, touchB) {
  const dx = touchA.clientX - touchB.clientX;
  const dy = touchA.clientY - touchB.clientY;
  return Math.hypot(dx, dy);
}

function initializeGalleryControls() {
  const modal = document.getElementById("galleryModal");
  const modalContent = document.getElementById("galleryModalContent");
  const image = document.getElementById("galleryModalImage");

  document.getElementById("galleryClose")?.addEventListener("click", closeGallery);
  document.getElementById("galleryReset")?.addEventListener("click", resetZoom);
  document.getElementById("galleryPrev")?.addEventListener("click", () => moveGallery(-1));
  document.getElementById("galleryNext")?.addEventListener("click", () => moveGallery(1));

  modal?.addEventListener("click", (event) => {
    if (event.target.id === "galleryModal") closeGallery();
  });

  image?.addEventListener("dblclick", (event) => {
    event.preventDefault();

    const rect = image.getBoundingClientRect();
    const anchorX = event.clientX - rect.left - rect.width / 2;
    const anchorY = event.clientY - rect.top - rect.height / 2;

    if (scale > 1) resetZoom();
    else setScale(2.5, anchorX, anchorY);
  });

  modalContent?.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();

      const rect = modalContent.getBoundingClientRect();
      const anchorX = event.clientX - rect.left - rect.width / 2;
      const anchorY = event.clientY - rect.top - rect.height / 2;
      const factor = event.deltaY < 0 ? 1.18 : 0.84;

      setScale(scale * factor, anchorX, anchorY);
    },
    { passive: false }
  );

  image?.addEventListener("pointerdown", (event) => {
    if (scale <= 1) return;

    dragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragOriginX = translateX;
    dragOriginY = translateY;

    image.setPointerCapture(event.pointerId);
    image.classList.add("dragging");
  });

  image?.addEventListener("pointermove", (event) => {
    if (!dragging) return;

    translateX = dragOriginX + (event.clientX - dragStartX);
    translateY = dragOriginY + (event.clientY - dragStartY);
    applyTransform();
  });

  const stopDragging = () => {
    dragging = false;
    image?.classList.remove("dragging");
  };

  image?.addEventListener("pointerup", stopDragging);
  image?.addEventListener("pointercancel", stopDragging);

  image?.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length === 1) {
        touchStartX = event.touches[0].screenX;
      }

      if (event.touches.length === 2) {
        initialPinchDistance = getDistance(event.touches[0], event.touches[1]);
        initialPinchScale = scale;
      }
    },
    { passive: true }
  );

  image?.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length !== 2 || initialPinchDistance <= 0) return;

      const currentDistance = getDistance(event.touches[0], event.touches[1]);
      const pinchRatio = currentDistance / initialPinchDistance;
      setScale(initialPinchScale * pinchRatio);
    },
    { passive: true }
  );

  image?.addEventListener(
    "touchend",
    (event) => {
      initialPinchDistance = 0;

      if (scale > 1 || !event.changedTouches.length) return;

      const distance = event.changedTouches[0].screenX - touchStartX;
      if (Math.abs(distance) >= 45) {
        moveGallery(distance > 0 ? -1 : 1);
      }
    },
    { passive: true }
  );

  document.addEventListener("keydown", (event) => {
    if (!modal?.classList.contains("open")) return;

    if (event.key === "Escape") closeGallery();
    if (event.key === "ArrowLeft") moveGallery(-1);
    if (event.key === "ArrowRight") moveGallery(1);
    if (event.key === "0") resetZoom();
    if (event.key === "+") setScale(scale * 1.25);
    if (event.key === "-") setScale(scale * 0.8);
  });
}

async function renderCamera(data, incidentId) {
  const card = findCardByHeading("Camera Evidence");
  const gallery = document.getElementById("cameraGallery");
  if (!card || !gallery) return;

  const paragraph = card.querySelector("p");
  const oldAction = card.querySelector("button, a");

  const [frontPhotoUrl, backPhotoUrl] = await Promise.all([
    resolvePhotoUrl(firstUsefulValue(data.frontPhotoUrl), incidentId, "front.jpg"),
    resolvePhotoUrl(firstUsefulValue(data.backPhotoUrl), incidentId, "back.jpg")
  ]);

  galleryImages = [];

  if (frontPhotoUrl) {
    galleryImages.push({
      url: frontPhotoUrl,
      label: "Front emergency photo"
    });
  }

  if (backPhotoUrl) {
    galleryImages.push({
      url: backPhotoUrl,
      label: "Rear emergency photo"
    });
  }

  gallery.replaceChildren();

  if (!galleryImages.length) {
    if (paragraph) paragraph.textContent = "Camera evidence is not available yet.";
    return;
  }

  if (paragraph) {
    paragraph.textContent =
      galleryImages.length === 2
        ? "Front and rear emergency photos are available."
        : "Emergency camera evidence is available.";
  }

  if (oldAction) oldAction.remove();

  const grid = document.createElement("div");
  grid.className = "camera-gallery-grid";

  galleryImages.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "camera-gallery-item";
    button.setAttribute("aria-label", `Open ${item.label}`);

    const image = document.createElement("img");
    image.src = item.url;
    image.alt = item.label;
    image.loading = "lazy";

    const label = document.createElement("span");
    label.className = "camera-gallery-label";
    label.textContent = item.label.replace(" emergency photo", "");

    button.append(image, label);
    button.addEventListener("click", () => openGallery(index));
    grid.appendChild(button);
  });

  gallery.appendChild(grid);
}


function calculateIncidentSeverity(data) {
  const explicit = String(
    firstUsefulValue(
      data.severity,
      data.severityLevel,
      data.riskLevel,
      data.priority
    ) || ""
  ).toLowerCase();

  if (["critical", "high", "medium", "low"].includes(explicit)) {
    return explicit;
  }

  const trigger = String(
    firstUsefulValue(data.triggerLabel, data.triggerType, data.type) || ""
  ).toLowerCase();

  const speed = Number(
    firstUsefulValue(data.speedKmh, data.deviceStatus?.speedKmh, 0)
  );

  const battery = Number(
    firstUsefulValue(data.batteryPercent, data.deviceStatus?.batteryPercent, 100)
  );

  if (
    trigger.includes("accident") ||
    trigger.includes("crash") ||
    trigger.includes("collision") ||
    speed >= 80
  ) {
    return "critical";
  }

  if (
    trigger.includes("shake") ||
    trigger.includes("sos") ||
    trigger.includes("emergency") ||
    speed >= 35
  ) {
    return "high";
  }

  if (battery <= 15) {
    return "medium";
  }

  return "high";
}

function renderSeverity(data) {
  const level = calculateIncidentSeverity(data);
  const badge = document.getElementById("severityBadge");
  const label = document.getElementById("severityLabel");
  const description = document.getElementById("severityDescription");

  if (!badge || !label || !description) return;

  badge.className = `severity-badge ${level}`;
  label.textContent = level.toUpperCase();

  const descriptions = {
    critical: "Immediate attention recommended.",
    high: "Urgent incident requiring prompt review.",
    medium: "Important incident requiring review.",
    low: "Incident information available for review."
  };

  description.textContent = descriptions[level];
}

function getDeviceTelemetry(data) {
  const battery = Number(
    firstUsefulValue(data.batteryPercent, data.deviceStatus?.batteryPercent)
  );

  const speed = Number(
    firstUsefulValue(data.speedKmh, data.deviceStatus?.speedKmh)
  );

  const gps = String(
    firstUsefulValue(data.deviceStatus?.gps, data.gpsStatus, "unknown")
  );

  const accuracy = getAccuracyMeters(data);

  const heading = Number(
    firstUsefulValue(
      data.heading,
      data.headingDegrees,
      data.deviceStatus?.heading
    )
  );

  const network = String(
    firstUsefulValue(
      data.networkType,
      data.connectionType,
      data.deviceStatus?.network,
      "unknown"
    )
  );

  return {
    battery: Number.isFinite(battery) ? Math.round(battery) : null,
    speed: Number.isFinite(speed) ? Math.round(speed) : null,
    gps,
    accuracy: accuracy ? Math.round(accuracy) : null,
    heading: Number.isFinite(heading) ? Math.round(heading) : null,
    network
  };
}

function compassDirection(degrees) {
  if (!Number.isFinite(degrees)) return "Unavailable";

  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
}

function renderTelemetry(data) {
  const telemetry = getDeviceTelemetry(data);

  setText(
    "telemetryBattery",
    telemetry.battery !== null ? `${telemetry.battery}%` : "Unavailable"
  );

  setText(
    "telemetrySpeed",
    telemetry.speed !== null ? `${telemetry.speed} km/h` : "Unavailable"
  );

  setText(
    "telemetryGps",
    telemetry.gps && telemetry.gps !== "unknown"
      ? telemetry.gps
      : "Unavailable"
  );

  setText(
    "telemetryAccuracy",
    telemetry.accuracy !== null ? `±${telemetry.accuracy} m` : "Unavailable"
  );

  setText(
    "telemetryHeading",
    telemetry.heading !== null
      ? `${telemetry.heading}° ${compassDirection(telemetry.heading)}`
      : "Unavailable"
  );

  setText(
    "telemetryNetwork",
    telemetry.network && telemetry.network !== "unknown"
      ? telemetry.network
      : "Unavailable"
  );

  const batteryBar = document.getElementById("batteryLevelFill");
  if (batteryBar) {
    const percentage = telemetry.battery ?? 0;
    batteryBar.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
    batteryBar.className =
      percentage <= 15
        ? "battery-level-fill critical"
        : percentage <= 35
          ? "battery-level-fill warning"
          : "battery-level-fill";
  }
}

function renderDeviceStatus(data) {
  const telemetry = getDeviceTelemetry(data);
  const parts = [];

  if (telemetry.battery !== null) {
    parts.push(`Battery: ${telemetry.battery}%`);
  }

  if (telemetry.gps && telemetry.gps !== "unknown") {
    parts.push(`GPS: ${telemetry.gps}`);
  }

  if (telemetry.speed !== null) {
    parts.push(`Speed: ${telemetry.speed} km/h`);
  }

  setText(
    "deviceStatus",
    parts.length ? parts.join(" • ") : "Device status is not available yet."
  );

  renderTelemetry(data);
}

function getTimelineEvents(data) {
  const events = [];
  const createdAt = firstUsefulValue(data.createdAt, data.startedAt, data.timeText);

  events.push({
    title: "Emergency triggered",
    description: data.triggerLabel || "Emergency alert",
    timestamp: createdAt,
    state: "critical"
  });

  const smsSentAt = firstUsefulValue(data.smsSentAt, data.sms?.sentAt, data.messageSentAt);
  if (smsSentAt || data.smsSent === true || data.messageSent === true || data.smsStatus === "sent") {
    events.push({
      title: "Emergency message sent",
      description: "Trusted contacts were notified.",
      timestamp: smsSentAt || createdAt,
      state: "complete"
    });
  }

  const latitude = firstUsefulValue(data.latitude, data.location?.latitude, data.lat);
  const longitude = firstUsefulValue(data.longitude, data.location?.longitude, data.lng);
  const locationUpdatedAt = firstUsefulValue(
    data.location?.updatedAt,
    data.lastLocationAt,
    data.lastUpdatedAt,
    data.updatedAt
  );

  if (latitude !== undefined && longitude !== undefined) {
    events.push({
      title: "Location received",
      description: "Live emergency coordinates are available.",
      timestamp: locationUpdatedAt || createdAt,
      state: "complete"
    });
  }

  const audioRecordings = normalizeAudioRecordings(data);

  audioRecordings
    .slice()
    .reverse()
    .forEach((recording, index) => {
      events.push({
        title: `Audio update ${index + 1} uploaded`,
        description: "A secure emergency recording is ready for review.",
        timestamp: recording.createdAt || createdAt,
        state: "complete"
      });
    });

  if (latitude !== undefined && longitude !== undefined) {
    events.push({
      title: "Live tracking active",
      description: "This page updates automatically when new data arrives.",
      timestamp: locationUpdatedAt || createdAt,
      state: "live"
    });
  }

  return events;
}

function renderTimeline(data) {
  const container = document.getElementById("incidentTimelineList");
  if (!container) return;

  container.replaceChildren();

  getTimelineEvents(data).forEach((event) => {
    const item = document.createElement("article");
    item.className = `premium-timeline-item ${event.state}`;

    const marker = document.createElement("span");
    marker.className = "premium-timeline-marker";

    const content = document.createElement("div");
    content.className = "premium-timeline-content";

    const heading = document.createElement("strong");
    heading.textContent = event.title;

    const description = document.createElement("span");
    description.textContent = event.description;

    const time = document.createElement("time");
    time.textContent = formatTimestamp(event.timestamp);

    content.append(heading, description);
    item.append(marker, content, time);
    container.appendChild(item);
  });
}

function renderIncident(data, incidentId) {
  currentIncidentData = data;
  setText("incidentId", data.incidentId || incidentId);

  setText(
    "incidentStatus",
    String(firstUsefulValue(data.publicStatus, data.status, "unknown"))
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  );

  setText(
    "incidentTime",
    formatTimestamp(
      firstUsefulValue(
        data.createdAt,
        data.startedAt,
        data.timeText,
        data.startedText
      )
    )
  );

  renderSeverity(data);
  renderLocation(data);
  renderAudio(data);
  renderDeviceStatus(data);
  renderTimeline(data);
}

function showError(message) {
  setText("incidentStatus", message);
  setText("incidentTime", "Unavailable");
}

const incidentId = getIncidentId();
setText("incidentId", incidentId || "Missing");

if (!incidentId) {
  showError("No Incident ID Provided");
} else {
  onSnapshot(
    doc(db, "incidents", incidentId),
    (snapshot) => {
      if (!snapshot.exists()) {
        showError("Incident Not Found");
        return;
      }

      renderIncident(snapshot.data(), incidentId);
    },
    (error) => {
      console.error("SilentHalos incident loading failed:", error);
      showError("Secure Access Failed");
    }
  );
}
