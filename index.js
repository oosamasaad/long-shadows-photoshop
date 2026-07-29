const { app, action, core, imaging, constants } = require("photoshop");

const META_PREFIX = "[#LS1:";
const META_SUFFIX = "]";
const DEFAULTS = {
  mode: "flat",
  angle: 45,
  length: 180,
  perspective: 0,
  skew: 0,
  color: "#171B24",
  opacity: 55,
  feather: 0,
  fade: 0,
  lightSize: 24,
  contactSoftness: 1,
  blendMode: "normal"
};

const BLEND_MODES = [
  ["normal", "NORMAL"],
  ["dissolve", "DISSOLVE"],
  ["darken", "DARKEN"],
  ["multiply", "MULTIPLY"],
  ["colorBurn", "COLORBURN"],
  ["linearBurn", "LINEARBURN"],
  ["darkerColor", "DARKERCOLOR"],
  ["lighten", "LIGHTEN"],
  ["screen", "SCREEN"],
  ["colorDodge", "COLORDODGE"],
  ["linearDodge", "LINEARDODGE"],
  ["lighterColor", "LIGHTERCOLOR"],
  ["overlay", "OVERLAY"],
  ["softLight", "SOFTLIGHT"],
  ["hardLight", "HARDLIGHT"],
  ["vividLight", "VIVIDLIGHT"],
  ["linearLight", "LINEARLIGHT"],
  ["pinLight", "PINLIGHT"],
  ["hardMix", "HARDMIX"],
  ["difference", "DIFFERENCE"],
  ["exclusion", "EXCLUSION"],
  ["subtract", "SUBTRACT"],
  ["divide", "DIVIDE"],
  ["hue", "HUE"],
  ["saturation", "SATURATION"],
  ["color", "COLOR"],
  ["luminosity", "LUMINOSITY"]
];

const PRESETS = {
  natural: {
    mode: "realistic",
    angle: 45,
    length: 220,
    perspective: 8,
    skew: 0,
    color: "#20242C",
    opacity: 45,
    blendMode: "normal",
    feather: 0,
    fade: 28,
    lightSize: 32,
    contactSoftness: 1
  },
  graphic: {
    mode: "flat",
    angle: 45,
    length: 260,
    perspective: 0,
    skew: 0,
    color: "#171B24",
    opacity: 62,
    blendMode: "normal",
    feather: 0,
    fade: 0,
    lightSize: 0,
    contactSoftness: 0
  },
  dramatic: {
    mode: "realistic",
    angle: 125,
    length: 440,
    perspective: 18,
    skew: 10,
    color: "#10131A",
    opacity: 68,
    blendMode: "multiply",
    feather: 0,
    fade: 42,
    lightSize: 58,
    contactSoftness: 0.5
  }
};

let rendering = false;
let autoTimer = null;
let lastSelectionId = null;

function byId(id) {
  return document.getElementById(id);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeHex(value) {
  let hex = String(value || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    hex = hex.split("").map((character) => character + character).join("");
  }
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : DEFAULTS.color;
}

function hexToRgb(hex) {
  const value = parseInt(normalizeHex(hex).slice(1), 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
}

function rgbToHex(red, green, blue) {
  const channel = (value) => clamp(Math.round(number(value, 0)), 0, 255)
    .toString(16)
    .padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`.toUpperCase();
}

function isValidHexInput(value) {
  return /^#?[0-9a-f]{6}$/i.test(String(value || "").trim());
}

function coordinateValue(value) {
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value.value === "number") {
    return value.value;
  }
  return Number(value);
}

function plainBounds(bounds) {
  const normalized = {
    left: coordinateValue(bounds && bounds.left),
    top: coordinateValue(bounds && bounds.top),
    right: coordinateValue(bounds && bounds.right),
    bottom: coordinateValue(bounds && bounds.bottom)
  };
  if (!Object.keys(normalized).every((key) => Number.isFinite(normalized[key]))) {
    throw new Error("Photoshop returned invalid bounds for the source layer.");
  }
  return normalized;
}

function readableError(error, fallback) {
  if (error && error.message) {
    return error.message;
  }
  const text = String(error || "");
  return text && text !== "[object Object]" ? text : fallback;
}

function blendModeDefinition(value) {
  return BLEND_MODES.find((entry) => entry[0] === value) || BLEND_MODES[0];
}

function blendModeConstant(value) {
  const definition = blendModeDefinition(value);
  return constants.BlendMode[definition[1]] || constants.BlendMode.NORMAL;
}

function sanitizeSettings(raw) {
  const settings = Object.assign({}, DEFAULTS, raw || {});
  settings.mode = ["flat", "perspective", "realistic"].includes(settings.mode)
    ? settings.mode
    : "flat";
  settings.angle = ((number(settings.angle, DEFAULTS.angle) % 360) + 360) % 360;
  settings.length = clamp(Math.round(number(settings.length, DEFAULTS.length)), 1, 2000);
  settings.perspective = clamp(number(settings.perspective, 0), -100, 100);
  settings.skew = clamp(number(settings.skew, 0), -100, 100);
  settings.color = normalizeHex(settings.color);
  settings.opacity = clamp(number(settings.opacity, DEFAULTS.opacity), 0, 100);
  settings.feather = clamp(number(settings.feather, 0), 0, 100);
  settings.fade = clamp(number(settings.fade, 0), 0, 100);
  settings.lightSize = clamp(number(settings.lightSize, DEFAULTS.lightSize), 0, 100);
  settings.contactSoftness = clamp(number(settings.contactSoftness, DEFAULTS.contactSoftness), 0, 20);
  settings.blendMode = blendModeDefinition(settings.blendMode)[0];
  return settings;
}

function compactMetadata(sourceId, settings) {
  const clean = sanitizeSettings(settings);
  return {
    s: Number(sourceId),
    m: clean.mode === "realistic" ? "r" : clean.mode === "perspective" ? "p" : "f",
    a: Math.round(clean.angle * 10) / 10,
    l: clean.length,
    p: Math.round(clean.perspective * 10) / 10,
    k: Math.round(clean.skew * 10) / 10,
    c: clean.color.slice(1),
    o: Math.round(clean.opacity * 10) / 10,
    b: Math.round(clean.feather * 10) / 10,
    f: Math.round(clean.fade * 10) / 10,
    z: Math.round(clean.lightSize * 10) / 10,
    n: Math.round(clean.contactSoftness * 10) / 10,
    d: BLEND_MODES.findIndex((entry) => entry[0] === clean.blendMode)
  };
}

function expandMetadata(data) {
  if (!data || !Number.isFinite(Number(data.s))) {
    return null;
  }
  return {
    sourceId: Number(data.s),
    settings: sanitizeSettings({
      mode: data.m === "r"
        ? "realistic"
        : data.m === "p"
          ? "perspective"
          : "flat",
      angle: data.a,
      length: data.l,
      perspective: data.p,
      skew: data.k,
      color: `#${data.c || DEFAULTS.color.slice(1)}`,
      opacity: data.o,
      feather: data.b,
      fade: data.f,
      lightSize: data.z,
      contactSoftness: data.n,
      blendMode: BLEND_MODES[Number(data.d)]
        ? BLEND_MODES[Number(data.d)][0]
        : DEFAULTS.blendMode
    })
  };
}

function makeShadowName(sourceId, settings) {
  const payload = encodeURIComponent(JSON.stringify(compactMetadata(sourceId, settings)));
  return `Long Shadow ${META_PREFIX}${payload}${META_SUFFIX}`;
}

function readShadowMetadata(layer) {
  const name = String(layer && layer.name || "");
  const start = name.indexOf(META_PREFIX);
  const end = name.indexOf(META_SUFFIX, start + META_PREFIX.length);
  if (start < 0 || end < 0) {
    return null;
  }
  try {
    const encoded = name.slice(start + META_PREFIX.length, end);
    return expandMetadata(JSON.parse(decodeURIComponent(encoded)));
  } catch (error) {
    console.warn("Long Shadows: invalid metadata", error);
    return null;
  }
}

function allLayers(container, result) {
  const list = result || [];
  const layers = container && container.layers ? Array.from(container.layers) : [];
  layers.forEach((layer) => {
    list.push(layer);
    if (layer.layers) {
      allLayers(layer, list);
    }
  });
  return list;
}

function findLayerById(doc, id) {
  return allLayers(doc).find((layer) => Number(layer.id) === Number(id)) || null;
}

function findShadowForSource(doc, sourceId) {
  return allLayers(doc).find((layer) => {
    const metadata = readShadowMetadata(layer);
    return metadata && metadata.sourceId === Number(sourceId);
  }) || null;
}

function getActiveLayer() {
  if (!app.activeDocument || !app.activeDocument.activeLayers.length) {
    return null;
  }
  return app.activeDocument.activeLayers[0];
}

function resolveManagedSelection(doc, selected) {
  if (!selected) {
    return null;
  }
  const direct = readShadowMetadata(selected);
  if (direct) {
    return {
      shadow: selected,
      source: findLayerById(doc, direct.sourceId),
      settings: direct.settings
    };
  }
  const shadow = findShadowForSource(doc, selected.id);
  if (!shadow) {
    return null;
  }
  const metadata = readShadowMetadata(shadow);
  return {
    shadow,
    source: selected,
    settings: metadata.settings
  };
}

function settingsFromUI() {
  return sanitizeSettings({
    mode: byId("mode").value,
    angle: byId("angle").value,
    length: byId("length").value,
    perspective: byId("perspective").value,
    skew: byId("skew").value,
    color: byId("color").value,
    opacity: byId("opacity").value,
    feather: byId("feather").value,
    fade: byId("fade").value,
    lightSize: byId("lightSize").value,
    contactSoftness: byId("contactSoftness").value,
    blendMode: byId("blendMode").value
  });
}

function settingsToUI(settings) {
  const clean = sanitizeSettings(settings);
  byId("mode").value = clean.mode;
  byId("angle").value = clean.angle;
  byId("length").value = clean.length;
  byId("perspective").value = clean.perspective;
  byId("skew").value = clean.skew;
  byId("color").value = clean.color;
  byId("opacity").value = clean.opacity;
  byId("feather").value = clean.feather;
  byId("fade").value = clean.fade;
  byId("lightSize").value = clean.lightSize;
  byId("contactSoftness").value = clean.contactSoftness;
  byId("blendMode").value = clean.blendMode;
  updateControlLabels();
  document.querySelectorAll(".preset-button").forEach((button) => {
    button.classList.remove("active");
  });
}

function savePreferences() {
  try {
    localStorage.setItem("longShadows.settings", JSON.stringify(settingsFromUI()));
    localStorage.setItem("longShadows.autoUpdate", String(byId("autoUpdate").checked));
  } catch (error) {
    console.warn("Long Shadows: could not save preferences", error);
  }
}

function loadPreferences() {
  try {
    const saved = localStorage.getItem("longShadows.settings");
    if (saved) {
      settingsToUI(JSON.parse(saved));
    } else {
      settingsToUI(DEFAULTS);
    }
    const auto = localStorage.getItem("longShadows.autoUpdate");
    if (auto !== null) {
      byId("autoUpdate").checked = auto === "true";
    }
  } catch (error) {
    settingsToUI(DEFAULTS);
  }
}

function updateControlLabels() {
  const mode = byId("mode").value;
  byId("angleValue").textContent = `${Math.round(number(byId("angle").value, 0))}°`;
  byId("lengthValue").textContent = `${Math.round(number(byId("length").value, 0))} px`;
  byId("perspectiveValue").textContent = `${Math.round(number(byId("perspective").value, 0))}%`;
  byId("skewValue").textContent = `${Math.round(number(byId("skew").value, 0))}%`;
  byId("opacityValue").textContent = `${Math.round(number(byId("opacity").value, 0))}%`;
  byId("featherValue").textContent = `${number(byId("feather").value, 0)} px`;
  byId("fadeValue").textContent = `${Math.round(number(byId("fade").value, 0))}%`;
  byId("lightSizeValue").textContent = `${Math.round(number(byId("lightSize").value, 0))}%`;
  byId("contactSoftnessValue").textContent = `${number(byId("contactSoftness").value, 0)} px`;
  byId("color").value = normalizeHex(byId("color").value);
  byId("colorSwatch").style.backgroundColor = byId("color").value;
  byId("perspectiveControls").classList.toggle("is-disabled", mode === "flat");
  byId("realisticControls").classList.toggle("is-hidden", mode !== "realistic");
}

function setStatus(message, type) {
  const status = byId("status");
  status.textContent = message;
  status.className = `status ${type || "info"}`;
}

function refreshSelectionUI(loadManagedSettings) {
  const doc = app.activeDocument;
  const selected = getActiveLayer();
  const state = byId("linkState");
  if (!doc || !selected) {
    byId("activeLayerName").textContent = "Nothing selected";
    byId("createOrUpdate").textContent = "Create shadow";
    byId("createOrUpdate").disabled = true;
    byId("detach").disabled = true;
    state.textContent = "SELECT";
    state.className = "state-pill empty";
    lastSelectionId = null;
    return;
  }

  const managed = resolveManagedSelection(doc, selected);
  const displayLayer = managed && managed.source ? managed.source : selected;
  byId("activeLayerName").textContent = displayLayer.name;
  byId("createOrUpdate").textContent = managed ? "Update shadow" : "Create shadow";
  byId("createOrUpdate").disabled = Boolean(selected.layers && !managed);
  byId("detach").disabled = !managed;
  if (managed) {
    state.textContent = managed.source ? "LINKED" : "BROKEN";
    state.className = managed.source ? "state-pill linked" : "state-pill empty";
  } else if (selected.layers) {
    state.textContent = "GROUP";
    state.className = "state-pill empty";
  } else {
    state.textContent = "READY";
    state.className = "state-pill";
  }
  if (managed && loadManagedSettings && lastSelectionId !== selected.id) {
    settingsToUI(managed.settings);
  }
  lastSelectionId = selected.id;
}

function alphaAt(data, components, hasAlpha, width, height, x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return 0;
  }
  if (!hasAlpha) {
    return 255;
  }
  return data[(y * width + x) * components + components - 1];
}

function endpointOffset(x, y, width, height, direction, settings) {
  const baseX = direction.x * settings.length;
  const baseY = direction.y * settings.length;
  if (settings.mode === "flat") {
    return { x: baseX, y: baseY };
  }

  const perpendicular = { x: -direction.y, y: direction.x };
  const centeredX = x - (width - 1) / 2;
  const centeredY = y - (height - 1) / 2;
  const across = centeredX * perpendicular.x + centeredY * perpendicular.y;
  const halfAcross = Math.max(
    1,
    Math.abs(perpendicular.x) * width / 2 + Math.abs(perpendicular.y) * height / 2
  );
  const normalizedAcross = clamp(across / halfAcross, -1, 1);
  const fan = normalizedAcross * (settings.perspective / 100) * settings.length * 0.45;
  const skew = (settings.skew / 100) * settings.length * 0.5;

  return {
    x: baseX + perpendicular.x * (fan + skew),
    y: baseY + perpendicular.y * (fan + skew)
  };
}

function calculateOutputBounds(sourceBounds, width, height, direction, settings, doc) {
  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1]
  ];
  let minX = 0;
  let minY = 0;
  let maxX = width;
  let maxY = height;

  corners.forEach(([x, y]) => {
    const endpoint = endpointOffset(x, y, width, height, direction, settings);
    minX = Math.min(minX, x + endpoint.x);
    minY = Math.min(minY, y + endpoint.y);
    maxX = Math.max(maxX, x + endpoint.x + 1);
    maxY = Math.max(maxY, y + endpoint.y + 1);
  });

  const realisticBlur = settings.mode === "realistic"
    ? settings.contactSoftness + settings.lightSize * 0.65
    : 0;
  const padding = Math.ceil((settings.feather + realisticBlur) * 3 + 2);
  const left = clamp(Math.floor(sourceBounds.left + minX - padding), 0, Number(doc.width));
  const top = clamp(Math.floor(sourceBounds.top + minY - padding), 0, Number(doc.height));
  const right = clamp(Math.ceil(sourceBounds.left + maxX + padding), 0, Number(doc.width));
  const bottom = clamp(Math.ceil(sourceBounds.top + maxY + padding), 0, Number(doc.height));

  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function drawLineAlpha(
  buffer,
  distanceMap,
  outputWidth,
  outputHeight,
  startX,
  startY,
  endX,
  endY,
  alpha,
  fade
) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(deltaX), Math.abs(deltaY))));

  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    const x = Math.round(startX + deltaX * progress);
    const y = Math.round(startY + deltaY * progress);
    if (x < 0 || y < 0 || x >= outputWidth || y >= outputHeight) {
      continue;
    }
    const fadedAlpha = Math.round(alpha * (1 - fade * progress));
    const index = (y * outputWidth + x) * 4 + 3;
    if (fadedAlpha > buffer[index]) {
      buffer[index] = fadedAlpha;
    }
    if (distanceMap) {
      const distanceIndex = y * outputWidth + x;
      const distance = Math.round(progress * 254);
      if (distance < distanceMap[distanceIndex]) {
        distanceMap[distanceIndex] = distance;
      }
    }
  }
}

function boxBlurAlpha(rgba, width, height, radius) {
  const size = width * height;
  const blurRadius = Math.max(0, Math.round(radius));
  const horizontal = new Uint8Array(size);
  const output = new Uint8Array(size);

  if (blurRadius === 0) {
    for (let index = 0; index < size; index += 1) {
      output[index] = rgba[index * 4 + 3];
    }
    return output;
  }

  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    const row = y * width;
    for (let x = 0; x <= Math.min(width - 1, blurRadius); x += 1) {
      sum += rgba[(row + x) * 4 + 3];
    }
    for (let x = 0; x < width; x += 1) {
      const first = Math.max(0, x - blurRadius);
      const last = Math.min(width - 1, x + blurRadius);
      if (x > 0) {
        const remove = x - blurRadius - 1;
        const add = x + blurRadius;
        if (remove >= 0) {
          sum -= rgba[(row + remove) * 4 + 3];
        }
        if (add < width) {
          sum += rgba[(row + add) * 4 + 3];
        }
      }
      horizontal[row + x] = Math.round(sum / (last - first + 1));
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = 0; y <= Math.min(height - 1, blurRadius); y += 1) {
      sum += horizontal[y * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      const first = Math.max(0, y - blurRadius);
      const last = Math.min(height - 1, y + blurRadius);
      if (y > 0) {
        const remove = y - blurRadius - 1;
        const add = y + blurRadius;
        if (remove >= 0) {
          sum -= horizontal[remove * width + x];
        }
        if (add < height) {
          sum += horizontal[add * width + x];
        }
      }
      output[y * width + x] = Math.round(sum / (last - first + 1));
    }
  }
  return output;
}

function applyRealisticSoftness(
  rgba,
  distanceMap,
  bounds,
  sourceBounds,
  direction,
  settings
) {
  const width = bounds.width;
  const height = bounds.height;
  const size = width * height;
  const progressMap = new Uint8Array(size);
  const finalAlpha = new Uint8Array(size);
  const sourceCorners = [
    [sourceBounds.left, sourceBounds.top],
    [sourceBounds.right, sourceBounds.top],
    [sourceBounds.left, sourceBounds.bottom],
    [sourceBounds.right, sourceBounds.bottom]
  ];
  const sourceMaxProjection = Math.max(...sourceCorners.map(
    ([x, y]) => x * direction.x + y * direction.y
  ));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (distanceMap[index] < 255) {
        progressMap[index] = distanceMap[index];
      } else {
        const globalX = bounds.left + x;
        const globalY = bounds.top + y;
        const projection = globalX * direction.x + globalY * direction.y;
        const progress = clamp(
          (projection - sourceMaxProjection) / Math.max(1, settings.length),
          0,
          1
        );
        progressMap[index] = Math.round(progress * 254);
      }
    }
  }

  const levelCount = 5;
  const nearRadius = settings.contactSoftness;
  const farRadius = nearRadius + settings.lightSize * 0.65;
  let previous = boxBlurAlpha(rgba, width, height, nearRadius);

  for (let level = 1; level < levelCount; level += 1) {
    const levelProgress = level / (levelCount - 1);
    const radius = nearRadius + (farRadius - nearRadius) * Math.pow(levelProgress, 1.15);
    const current = boxBlurAlpha(rgba, width, height, radius);
    const lower = (level - 1) / (levelCount - 1);
    const upper = levelProgress;

    for (let index = 0; index < size; index += 1) {
      const progress = progressMap[index] / 254;
      if (progress < lower || progress > upper) {
        continue;
      }
      const mix = clamp((progress - lower) / Math.max(0.0001, upper - lower), 0, 1);
      finalAlpha[index] = Math.round(previous[index] * (1 - mix) + current[index] * mix);
    }
    previous = current;
  }

  for (let index = 0; index < size; index += 1) {
    rgba[index * 4 + 3] = finalAlpha[index];
  }
}

function renderShadowPixels(source, sourceBounds, settings, doc) {
  const width = source.imageData.width;
  const height = source.imageData.height;
  const components = source.imageData.components;
  const hasAlpha = source.imageData.hasAlpha;
  const radians = settings.angle * Math.PI / 180;
  const direction = { x: Math.cos(radians), y: Math.sin(radians) };
  const bounds = calculateOutputBounds(sourceBounds, width, height, direction, settings, doc);

  return source.imageData.getData({ chunky: true }).then((data) => {
    const rgba = new Uint8Array(bounds.width * bounds.height * 4);
    const distanceMap = settings.mode === "realistic"
      ? new Uint8Array(bounds.width * bounds.height).fill(255)
      : null;
    const color = hexToRgb(settings.color);
    const neighborX = Math.round(direction.x);
    const neighborY = Math.round(direction.y);
    const fade = settings.fade / 100;
    let boundaryCount = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = alphaAt(data, components, hasAlpha, width, height, x, y);
        if (alpha === 0) {
          continue;
        }

        const globalX = Math.round(sourceBounds.left + x);
        const globalY = Math.round(sourceBounds.top + y);
        const localX = globalX - bounds.left;
        const localY = globalY - bounds.top;
        if (localX >= 0 && localY >= 0 && localX < bounds.width && localY < bounds.height) {
          const baseIndex = (localY * bounds.width + localX) * 4 + 3;
          if (alpha > rgba[baseIndex]) {
            rgba[baseIndex] = alpha;
          }
          if (distanceMap) {
            distanceMap[localY * bounds.width + localX] = 0;
          }
        }

        const neighborAlpha = alphaAt(
          data,
          components,
          hasAlpha,
          width,
          height,
          x + neighborX,
          y + neighborY
        );
        if (neighborAlpha >= alpha && neighborAlpha > 0) {
          continue;
        }

        boundaryCount += 1;
        const endpoint = endpointOffset(x, y, width, height, direction, settings);
        drawLineAlpha(
          rgba,
          distanceMap,
          bounds.width,
          bounds.height,
          localX,
          localY,
          localX + endpoint.x,
          localY + endpoint.y,
          alpha,
          fade
        );
      }
    }

    if (settings.mode === "realistic") {
      applyRealisticSoftness(
        rgba,
        distanceMap,
        bounds,
        sourceBounds,
        direction,
        settings
      );
    }

    for (let index = 0; index < rgba.length; index += 4) {
      if (rgba[index + 3] > 0) {
        rgba[index] = color.r;
        rgba[index + 1] = color.g;
        rgba[index + 2] = color.b;
      }
    }

    return { rgba, bounds, boundaryCount };
  });
}

async function renderShadowLayer(doc, sourceLayer, shadowLayer, settings) {
  const clean = sanitizeSettings(settings);
  const sourceBounds = plainBounds(sourceLayer.boundsNoEffects);
  const pixelResult = await imaging.getPixels({
    documentID: doc.id,
    layerID: sourceLayer.id,
    sourceBounds,
    colorSpace: "RGB",
    colorProfile: "sRGB IEC61966-2.1",
    componentSize: 8,
    applyAlpha: false
  });

  try {
    if (!pixelResult || !pixelResult.imageData || pixelResult.imageData.width < 1 || pixelResult.imageData.height < 1) {
      throw new Error("The source layer has no visible pixels.");
    }

    const rendered = await renderShadowPixels(pixelResult, pixelResult.sourceBounds, clean, doc);
    const outputData = await imaging.createImageDataFromBuffer(rendered.rgba, {
      width: rendered.bounds.width,
      height: rendered.bounds.height,
      components: 4,
      chunky: true,
      colorSpace: "RGB",
      colorProfile: "sRGB IEC61966-2.1"
    });

    try {
      await imaging.putPixels({
        documentID: doc.id,
        layerID: shadowLayer.id,
        imageData: outputData,
        replace: true,
        targetBounds: {
          left: rendered.bounds.left,
          top: rendered.bounds.top
        },
        commandName: "Render Long Shadow"
      });
    } finally {
      outputData.dispose();
    }

    shadowLayer.name = makeShadowName(sourceLayer.id, clean);
    shadowLayer.opacity = clean.opacity;
    try {
      shadowLayer.blendMode = blendModeConstant(clean.blendMode);
    } catch (error) {
      console.warn(`Long Shadows: ${clean.blendMode} blend mode unavailable`, error);
    }

    if (clean.feather > 0) {
      await shadowLayer.applyGaussianBlur(clean.feather);
    }
    return rendered.boundaryCount;
  } finally {
    pixelResult.imageData.dispose();
  }
}

async function createManagedShadow(doc, sourceLayer, settings) {
  const group = await doc.createLayerGroup({
    name: `Long Shadow — ${sourceLayer.name}`
  });
  await group.move(sourceLayer, constants.ElementPlacement.PLACEBEFORE);
  await sourceLayer.move(group, constants.ElementPlacement.PLACEINSIDE);

  const shadow = await doc.createLayer({
    name: makeShadowName(sourceLayer.id, settings)
  });
  await shadow.move(group, constants.ElementPlacement.PLACEINSIDE);
  await shadow.move(sourceLayer, constants.ElementPlacement.PLACEAFTER);
  await renderShadowLayer(doc, sourceLayer, shadow, settings);
  return shadow;
}

async function createOrUpdate() {
  if (rendering) {
    return;
  }
  const doc = app.activeDocument;
  const selected = getActiveLayer();
  if (!doc || !selected) {
    setStatus("Select a source layer first.", "error");
    return;
  }
  if (selected.layers) {
    setStatus("Select a text, shape, Smart Object, or pixel layer—not a group.", "error");
    return;
  }

  rendering = true;
  byId("createOrUpdate").disabled = true;
  setStatus("Rendering shadow…", "info");
  const settings = settingsFromUI();

  try {
    let result = "updated";
    await core.executeAsModal(async (executionContext) => {
      const managed = resolveManagedSelection(doc, selected);
      const source = managed ? managed.source : selected;
      if (!source) {
        throw new Error("The linked source layer no longer exists.");
      }
      const suspension = await executionContext.hostControl.suspendHistory({
        documentID: doc.id,
        name: managed ? "Update Long Shadow" : "Create Long Shadow"
      });
      let commit = false;
      try {
        if (managed) {
          await renderShadowLayer(doc, source, managed.shadow, settings);
        } else {
          result = "created";
          await createManagedShadow(doc, source, settings);
        }
        commit = true;
      } finally {
        await executionContext.hostControl.resumeHistory(suspension, commit);
      }
    }, { commandName: "Long Shadows" });

    savePreferences();
    setStatus(`Shadow ${result}. Masks and layer styling remain editable.`, "success");
  } catch (error) {
    console.error(error);
    setStatus(readableError(error, "Photoshop could not render the shadow."), "error");
  } finally {
    rendering = false;
    byId("createOrUpdate").disabled = false;
    refreshSelectionUI(false);
  }
}

async function detachManagedShadow() {
  if (rendering) {
    return;
  }
  const doc = app.activeDocument;
  const selected = getActiveLayer();
  const managed = doc && resolveManagedSelection(doc, selected);
  if (!managed) {
    setStatus("Select a managed source or shadow layer first.", "error");
    return;
  }

  rendering = true;
  try {
    await core.executeAsModal(async () => {
      managed.shadow.name = "Long Shadow (detached)";
    }, { commandName: "Detach Long Shadow" });
    setStatus("Shadow detached. It is now an ordinary Photoshop layer.", "success");
  } catch (error) {
    setStatus(error.message || "Could not detach the shadow.", "error");
  } finally {
    rendering = false;
    refreshSelectionUI(false);
  }
}

async function autoRefreshManagedShadows() {
  if (rendering || !byId("autoUpdate").checked || !app.activeDocument) {
    return;
  }
  const doc = app.activeDocument;
  const managedLayers = allLayers(doc)
    .map((layer) => ({ layer, metadata: readShadowMetadata(layer) }))
    .filter((entry) => entry.metadata);
  if (!managedLayers.length) {
    return;
  }

  rendering = true;
  setStatus(`Refreshing ${managedLayers.length} linked shadow${managedLayers.length === 1 ? "" : "s"}…`, "info");
  try {
    await core.executeAsModal(async (executionContext) => {
      const suspension = await executionContext.hostControl.suspendHistory({
        documentID: doc.id,
        name: "Auto-update Long Shadows"
      });
      let commit = false;
      try {
        for (const entry of managedLayers) {
          const source = findLayerById(doc, entry.metadata.sourceId);
          if (source) {
            await renderShadowLayer(doc, source, entry.layer, entry.metadata.settings);
          }
        }
        commit = true;
      } finally {
        await executionContext.hostControl.resumeHistory(suspension, commit);
      }
    }, { commandName: "Auto-update Long Shadows", timeOut: 2000 });
    setStatus("Linked shadows are up to date.", "success");
  } catch (error) {
    console.warn("Long Shadows auto-update:", error);
    setStatus("Auto-update paused because Photoshop was busy. Use Update shadow.", "error");
  } finally {
    rendering = false;
    refreshSelectionUI(false);
  }
}

function scheduleAutoRefresh() {
  if (rendering || !byId("autoUpdate").checked) {
    return;
  }
  if (autoTimer) {
    clearTimeout(autoTimer);
  }
  autoTimer = setTimeout(autoRefreshManagedShadows, 650);
}

async function attachPhotoshopListeners() {
  try {
    await action.addNotificationListener(
      ["transform", "move", "set", "placedLayerReplaceContents"],
      scheduleAutoRefresh
    );
  } catch (error) {
    console.warn("Long Shadows: automatic event listeners unavailable", error);
    setStatus("Manual updates work, but Photoshop did not enable automatic event listening.", "info");
  }
}

async function openPhotoshopColorPicker() {
  const initial = hexToRgb(byId("color").value);
  try {
    const result = await core.executeAsModal(async () => action.batchPlay([{
      _obj: "showColorPicker",
      _target: { _ref: "application" },
      context: "Choose Long Shadow Color",
      color: {
        _obj: "RGBColor",
        red: initial.r,
        green: initial.g,
        blue: initial.b
      }
    }], {}), {
      commandName: "Choose Long Shadow Color",
      interactive: true,
      timeOut: 2000
    });
    const picked = result && result[0] && result[0].RGBFloatColor;
    if (!picked) {
      return;
    }
    const green = picked.green === undefined ? picked.grain : picked.green;
    const hex = rgbToHex(picked.red, green, picked.blue);
    byId("color").value = hex;
    byId("colorSwatch").style.backgroundColor = hex;
    savePreferences();
  } catch (error) {
    console.error("Long Shadows color picker:", error);
    setStatus(readableError(error, "Photoshop could not open its color picker."), "error");
  }
}

function commitColorField() {
  const hex = normalizeHex(byId("color").value);
  byId("color").value = hex;
  byId("colorSwatch").style.backgroundColor = hex;
  savePreferences();
}

function bindColorPicker() {
  const colorWell = byId("colorSwatch");
  colorWell.addEventListener("click", openPhotoshopColorPicker);
  colorWell.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      openPhotoshopColorPicker();
    }
  });
  byId("color").addEventListener("input", (event) => {
    if (isValidHexInput(event.target.value)) {
      byId("colorSwatch").style.backgroundColor = normalizeHex(event.target.value);
    }
  });
  byId("color").addEventListener("change", commitColorField);
  byId("color").addEventListener("blur", commitColorField);
}

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) {
    return;
  }
  settingsToUI(preset);
  savePreferences();
  document.querySelectorAll(".preset-button").forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-preset") === name);
  });
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  setStatus(`${label} preset loaded. Update the shadow to apply it.`, "info");
}

function resetSettings() {
  settingsToUI(DEFAULTS);
  savePreferences();
  document.querySelectorAll(".preset-button").forEach((button) => {
    button.classList.remove("active");
  });
  setStatus("Controls reset to defaults.", "info");
}

function bindUI() {
  const controls = [
    "mode",
    "angle",
    "length",
    "perspective",
    "skew",
    "opacity",
    "feather",
    "fade",
    "lightSize",
    "contactSoftness",
    "blendMode"
  ];
  controls.forEach((id) => {
    byId(id).addEventListener("input", () => {
      document.querySelectorAll(".preset-button").forEach((button) => {
        button.classList.remove("active");
      });
      updateControlLabels();
      savePreferences();
    });
    byId(id).addEventListener("change", () => {
      document.querySelectorAll(".preset-button").forEach((button) => {
        button.classList.remove("active");
      });
      updateControlLabels();
      savePreferences();
    });
  });
  bindColorPicker();

  [
    ["presetNatural", "natural"],
    ["presetGraphic", "graphic"],
    ["presetDramatic", "dramatic"]
  ].forEach(([id, name]) => {
    byId(id).addEventListener("click", () => applyPreset(name));
  });
  byId("resetSettings").addEventListener("click", resetSettings);

  byId("autoUpdate").addEventListener("change", savePreferences);
  byId("refreshSelection").addEventListener("click", () => refreshSelectionUI(true));
  byId("createOrUpdate").addEventListener("click", createOrUpdate);
  byId("detach").addEventListener("click", detachManagedShadow);
}

document.addEventListener("DOMContentLoaded", async () => {
  bindUI();
  loadPreferences();
  updateControlLabels();
  refreshSelectionUI(true);
  await attachPhotoshopListeners();
  setInterval(() => refreshSelectionUI(true), 500);
});
