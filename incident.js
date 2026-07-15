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

function getIncidentId() {
  const params = new URLSearchParams(window.location.search);
  const queryId = params.get("id") || params.get("incident");

  if (queryId) {
    return queryId.trim();
  }

  const pathParts = window.location.pathname
    .split("/")
    .map((part) => decodeURIComponent(part.trim()))
    .filter(Boolean);

  const incidentIndex = pathParts.findIndex(
    (part) => part.toLowerCase() === "incident"
  );

  if (incidentIndex >= 0 && pathParts[incidentIndex + 1]) {
    return pathParts[incidentIndex + 1];
  }

  return "";
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function firstUsefulValue(...values) {
  return values.find(
    (value) => value !== undefined && value !== null && value !== ""
  );
}

function formatTimestamp(value) {
  if (!value) {
    return "Unknown";
  }

  try {
    const date =
      typeof value.toDate === "function"
        ? value.toDate()
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "Unknown";
    }

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
  if (!element) {
    return;
  }

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
    if (locationButton) {
      locationButton.textContent = "Open Map";
    }
  } else {
    if (locationText) {
      locationText.textContent = "Location is not available yet.";
    }
    if (locationButton) {
      locationButton.classList.add("disabled");
      locationButton.removeAttribute("href");
    }
  }
}

function renderAudio(data) {
  const card = findCardByHeading("Audio Evidence");
  if (!card) {
    return;
  }

  const paragraph = card.querySelector("p");
  const oldAction = card.querySelector("button, a, audio");
  const audioUrl = firstUsefulValue(data.audioUrl, data.audio?.url);

  if (!audioUrl) {
    if (paragraph) {
      paragraph.textContent = "Audio evidence is not available yet.";
    }
    if (oldAction) {
      oldAction.textContent = "Waiting for Audio";
      oldAction.classList.add("disabled");
    }
    return;
  }

  if (paragraph) {
    paragraph.textContent = "Secure emergency audio is available below.";
  }

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "metadata";
  audio.src = audioUrl;
  audio.style.width = "100%";
  audio.setAttribute("aria-label", "Emergency audio evidence");

  if (oldAction) {
    oldAction.replaceWith(audio);
  } else {
    card.appendChild(audio);
  }
}

function createEvidenceImage(url, label) {
  const wrapper = document.createElement("div");
  wrapper.style.marginTop = "14px";

  const caption = document.createElement("strong");
  caption.textContent = label;
  caption.style.display = "block";
  caption.style.marginBottom = "8px";

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  const image = document.createElement("img");
  image.src = url;
  image.alt = label;
  image.loading = "lazy";
  image.style.display = "block";
  image.style.width = "100%";
  image.style.maxHeight = "420px";
  image.style.objectFit = "cover";
  image.style.borderRadius = "14px";

  link.appendChild(image);
  wrapper.append(caption, link);
  return wrapper;
}

async function resolvePhotoUrl(dataUrl, incidentId, filename) {
  if (dataUrl) {
    return dataUrl;
  }

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

async function renderCamera(data, incidentId) {
  const card = findCardByHeading("Camera Evidence");
  if (!card) {
    return;
  }

  const paragraph = card.querySelector("p");
  const oldAction = card.querySelector("button, a");

  const [frontPhotoUrl, backPhotoUrl] = await Promise.all([
    resolvePhotoUrl(firstUsefulValue(data.frontPhotoUrl), incidentId, "front.jpg"),
    resolvePhotoUrl(firstUsefulValue(data.backPhotoUrl), incidentId, "back.jpg")
  ]);

  let evidenceContainer = card.querySelector("[data-camera-evidence]");
  if (!evidenceContainer) {
    evidenceContainer = document.createElement("div");
    evidenceContainer.dataset.cameraEvidence = "true";
    card.appendChild(evidenceContainer);
  }
  evidenceContainer.replaceChildren();

  if (!frontPhotoUrl && !backPhotoUrl) {
    if (paragraph) {
      paragraph.textContent = "Camera evidence is not available yet.";
    }
    if (oldAction) {
      oldAction.textContent = "Waiting for Photo";
      oldAction.classList.add("disabled");
    }
    return;
  }

  if (paragraph) {
    paragraph.textContent =
      frontPhotoUrl && backPhotoUrl
        ? "Front and rear emergency photos are available."
        : data.cameraEvidence || "Emergency camera evidence is available.";
  }

  if (oldAction) {
    oldAction.remove();
  }

  if (frontPhotoUrl) {
    evidenceContainer.appendChild(
      createEvidenceImage(frontPhotoUrl, "Front emergency photo")
    );
  }

  if (backPhotoUrl) {
    evidenceContainer.appendChild(
      createEvidenceImage(backPhotoUrl, "Rear emergency photo")
    );
  }
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
    const title = items[0].querySelector("strong");
    const description = items[0].querySelector("span");
    if (title) title.textContent = "Alert created";
    if (description) {
      description.textContent = `${formatTimestamp(
        firstUsefulValue(data.createdAt, data.startedAt, data.timeText)
      )} — ${data.triggerLabel || "Emergency alert"}`;
    }
    items[0].classList.add("active");
  }

  if (items[1]) {
    const title = items[1].querySelector("strong");
    const description = items[1].querySelector("span");
    if (title) title.textContent = "Evidence upload";
    if (description) {
      description.textContent =
        data.storageStatus === "photos_upload_done" ||
        data.audioStatus === "audio_upload_done"
          ? "Available evidence has been securely uploaded."
          : "Evidence upload is still in progress.";
    }
    items[1].classList.toggle(
      "active",
      data.storageStatus === "photos_upload_done" ||
        data.audioStatus === "audio_upload_done"
    );
  }

  if (items[2]) {
    const title = items[2].querySelector("strong");
    const description = items[2].querySelector("span");
    if (title) title.textContent = "Trusted contact review";
    if (description) {
      description.textContent =
        "This page updates automatically when new incident evidence becomes available.";
    }
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

  const subtitle = document.querySelector(".incident-hero-panel .subtitle");
  if (subtitle) {
    subtitle.textContent =
      "This emergency page displays evidence securely synchronized by the SilentHalos safety app.";
  }

  renderLocation(data);
  renderAudio(data);
  renderCamera(data, incidentId);
  renderDeviceStatus(data);
  renderTimeline(data);
}

function showError(message) {
  setText("incidentStatus", message);
  setText("incidentTime", "Unavailable");

  const subtitle = document.querySelector(".incident-hero-panel .subtitle");
  if (subtitle) {
    subtitle.textContent =
      "The incident could not be loaded. Check the link or try again shortly.";
  }
}

const incidentId = getIncidentId();
setText("incidentId", incidentId || "Missing");

if (!incidentId) {
  showError("No Incident ID Provided");
} else {
  const incidentReference = doc(db, "incidents", incidentId);

  onSnapshot(
    incidentReference,
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
