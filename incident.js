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
  } else if (locationText) {
    locationText.textContent = "Location is not available yet.";
  }
}

function renderAudio(data) {
  const card = findCardByHeading("Audio Evidence");
  if (!card) return;

  const paragraph = card.querySelector("p");
  const oldAction = card.querySelector("button, a, audio");
  const audioUrl = firstUsefulValue(data.audioUrl, data.audio?.url);

  if (!audioUrl) {
    if (paragraph) paragraph.textContent = "Audio evidence is not available yet.";
    return;
  }

  if (paragraph) paragraph.textContent = "Secure emergency audio is available below.";

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "metadata";
  audio.src = audioUrl;
  audio.style.width = "100%";
  audio.setAttribute("aria-label", "Emergency audio evidence");

  if (oldAction) oldAction.replaceWith(audio);
  else card.appendChild(audio);
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

function renderDeviceStatus(data) {
  const batteryPercent = firstUsefulValue(
    data.batteryPercent,
    data.deviceStatus?.batteryPercent
  );
  const gps = firstUsefulValue(data.deviceStatus?.gps);
  const speedKmh = firstUsefulValue(data.speedKmh, data.deviceStatus?.speedKmh);

  const parts = [];

  if (batteryPercent !== undefined) {
    parts.push(`Battery: ${Math.round(Number(batteryPercent))}%`);
  }

  if (gps) {
    parts.push(`GPS: ${gps}`);
  }

  if (speedKmh !== undefined) {
    parts.push(`Speed: ${Number(speedKmh).toFixed(0)} km/h`);
  }

  setText(
    "deviceStatus",
    parts.length ? parts.join(" • ") : "Device status is not available yet."
  );
}

function renderTimeline(data) {
  const items = document.querySelectorAll(".timeline-item");

  if (items[0]) {
    const description = items[0].querySelector("span");

    if (description) {
      description.textContent = `${formatTimestamp(
        firstUsefulValue(data.createdAt, data.startedAt, data.timeText)
      )} — ${data.triggerLabel || "Emergency alert"}`;
    }
  }

  if (items[1]) {
    const description = items[1].querySelector("span");
    const uploaded =
      data.storageStatus === "photos_upload_done" ||
      data.audioStatus === "audio_upload_done";

    if (description) {
      description.textContent = uploaded
        ? "Available evidence has been securely uploaded."
        : "Evidence upload is still in progress.";
    }

    items[1].classList.toggle("active", uploaded);
  }
}

function renderIncident(data, incidentId) {
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

  renderLocation(data);
  renderAudio(data);
  renderCamera(data, incidentId);
  renderDeviceStatus(data);
  renderTimeline(data);
}

function showError(message) {
  setText("incidentStatus", message);
  setText("incidentTime", "Unavailable");
}

initializeGalleryControls();

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
