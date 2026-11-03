// Graphics quality profiles for phones (Android) and desktops.
//
// Every module reads QUALITY at import time, so the profile is fixed for the whole session. Switching quality saves
// the choice and reloads the page (see setQuality).
//
// Choice order: ?quality=low|medium|high in the URL, then the saved choice, then automatic detection.

const STORAGE_KEY = 'nyc-quality';

const PROFILES = {
  // Phones and weak tablets: no SSR, no MSAA, no sun shadows, fewer cars / people / lights, shorter detail ranges.
  low: {
    id: 'low',
    label: 'Low',
    renderScale: 0.8, // fraction of CSS pixels rendered (dynamic resolution moves between min and max)
    minRenderScale: 0.55,
    maxRenderScale: 1.0,
    dynamicResolution: true,
    maxFps: 60,
    antialias: false,
    fxaa: true,
    ssr: false,
    bloom: true,
    bloomScale: 0.25,
    shadows: false,
    shadowTile: 1024,
    shadowFar: 160,
    clusteredLights: [96, 64, 16, 24], // maxLights, tileSize, zSlices, maxLightsPerCluster
    cars: 70,
    buses: 5,
    peds: 110,
    carLightPool: 24,
    policeLightPool: 2,
    streetSpotPool: 12,
    streetPointPool: 14,
    storeSpotPool: 8,
    highwaySpotPool: 8,
    lightDistanceScale: 0.7,
    trafficRadiusScale: 0.7,
    buildingStreamRadius: 340,
    treeLodScale: 0.55,
    cullScale: 0.55,
    fogScale: 1.5, // thicker haze...
    fogFar: true, // ...and nothing drawn beyond where it is opaque (lighting.js fogFarDistance)
    compilePool: 16 // shader builds in flight while loading: 16 halved the compile time of 4 (measured); 32 gains nothing
  },
  // Strong phones (Snapdragon 8 Gen class) and laptops with integrated GPUs.
  medium: {
    id: 'medium',
    label: 'Medium',
    renderScale: 1.0,
    minRenderScale: 0.65,
    maxRenderScale: 1.0,
    dynamicResolution: true,
    maxFps: 60,
    antialias: false,
    fxaa: true,
    ssr: false,
    bloom: true,
    bloomScale: 0.35,
    shadows: true,
    shadowTile: 1024,
    shadowFar: 220,
    clusteredLights: [160, 48, 20, 32],
    cars: 120,
    buses: 8,
    peds: 200,
    carLightPool: 48,
    policeLightPool: 4,
    streetSpotPool: 22,
    streetPointPool: 28,
    storeSpotPool: 16,
    highwaySpotPool: 16,
    lightDistanceScale: 0.85,
    trafficRadiusScale: 0.85,
    buildingStreamRadius: 450,
    treeLodScale: 0.75,
    cullScale: 0.75,
    fogScale: 1.2,
    fogFar: true,
    compilePool: 16
  },
  // The original desktop settings, unchanged.
  high: {
    id: 'high',
    label: 'High',
    renderScale: 1.0,
    minRenderScale: 1.0,
    maxRenderScale: 1.0,
    dynamicResolution: false,
    maxFps: 0, // 0 = no cap
    antialias: true,
    fxaa: false,
    ssr: true,
    bloom: true,
    bloomScale: 0.5,
    shadows: true,
    shadowTile: 0, // 0 = original choice (3072 or 2048 from the GPU's texture limit)
    shadowFar: 300,
    clusteredLights: [256, 32, 28, 48],
    cars: 200,
    buses: 12,
    peds: 340,
    carLightPool: 96,
    policeLightPool: 6,
    streetSpotPool: 36,
    streetPointPool: 48,
    storeSpotPool: 28,
    highwaySpotPool: 28,
    lightDistanceScale: 1,
    trafficRadiusScale: 1,
    buildingStreamRadius: 560,
    treeLodScale: 1,
    cullScale: 1,
    fogScale: 1,
    fogFar: false, // the original 60 km far plane
    compilePool: 16
  }
};

function detectMobile() {
  const ua = navigator.userAgent || '';
  const uaMobile = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width || 9999, screen.height || 9999) <= 900;
  return uaMobile || (coarse && small);
}

function detectProfile() {
  if (!detectMobile()) return 'high';
  const memory = navigator.deviceMemory || 4; // GB, Chrome rounds down and caps at 8
  const cores = navigator.hardwareConcurrency || 4;
  // Only flagship-class phones get medium; everything else starts on low and dynamic resolution keeps it smooth.
  return memory >= 8 && cores >= 8 ? 'medium' : 'low';
}

function readChoice() {
  try {
    const fromUrl = new URLSearchParams(location.search).get('quality');
    if (fromUrl && PROFILES[fromUrl]) return { id: fromUrl, source: 'url' };
  } catch { /* ignore */ }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && PROFILES[saved]) return { id: saved, source: 'saved' };
  } catch { /* storage unavailable */ }
  return { id: detectProfile(), source: 'auto' };
}

// Fine tuning from the URL on top of the profile, e.g. ?quality=low&shadows=1&cars=90&renderScale=0.7
function readOverrides(profile) {
  const out = {};
  try {
    const params = new URLSearchParams(location.search);
    for (const [key, base] of Object.entries(profile)) {
      if (!params.has(key) || key === 'id' || key === 'label') continue;
      const raw = params.get(key);
      if (typeof base === 'boolean') out[key] = raw === '1' || raw === 'true';
      else if (typeof base === 'number' && Number.isFinite(Number(raw))) out[key] = Number(raw);
    }
  } catch { /* ignore */ }
  return out;
}

const choice = readChoice();
const QUALITY = Object.freeze({
  ...PROFILES[choice.id],
  ...readOverrides(PROFILES[choice.id]),
  source: choice.source,
  isMobile: detectMobile()
});

function setQuality(id) {
  if (!PROFILES[id]) return;
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
  // Drop a ?quality= override so the new choice applies after the reload.
  const url = new URL(location.href);
  url.searchParams.delete('quality');
  location.replace(url.toString());
}

// Dynamic resolution: lowers the render scale when frames run long and raises it again when there's headroom.
// Changing the pixel ratio reallocates the render targets, so it moves in small steps and at most every 1.5 s.
class DynamicResolution {
  constructor(renderer, quality = QUALITY) {
    this.renderer = renderer;
    this.q = quality;
    this.scale = quality.renderScale;
    this.enabled = quality.dynamicResolution;
    this.target = 1000 / Math.max(30, quality.maxFps || 60); // ms per frame
    this.avg = this.target;
    this.cooldown = 3000; // let the first frames settle
    this.apply();
  }

  apply() {
    this.renderer.setPixelRatio(this.scale);
  }

  update(frameMs) {
    if (!this.enabled) return;
    // Ignore tab switches / hitches so a single long frame doesn't drop the resolution
    if (frameMs > 250) return;
    this.avg += (frameMs - this.avg) * 0.05;
    this.cooldown -= frameMs;
    if (this.cooldown > 0) return;
    let next = this.scale;
    if (this.avg > this.target * 1.18) next = Math.max(this.q.minRenderScale, this.scale - 0.05);
    else if (this.avg < this.target * 1.04) next = Math.min(this.q.maxRenderScale, this.scale + 0.05);
    if (next !== this.scale) {
      this.scale = Math.round(next * 100) / 100;
      this.apply();
      this.cooldown = 1500;
    }
  }
}

export { QUALITY, PROFILES, setQuality, DynamicResolution };
