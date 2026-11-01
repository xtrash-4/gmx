// Touch input stays separate from the keyboard, so releasing a finger never releases a held key.
// Android build: a joystick (left thumb) plus big action buttons (right thumb) that change with the travel mode.
// The joystick and the buttons can drive the same action (the stick's forward and the GAS button): the strongest wins.
const DEAD_ZONE = 0.12;
const MAX_RADIUS = 52;
const MOVE_ACTIONS = ['forward', 'backward', 'left', 'right', 'up', 'down'];

// Which buttons show in each mode, and their labels
const BUTTON_LAYOUT = {
  person: { forward: 'RUN', up: 'JUMP' },
  car: { forward: 'GAS', backward: 'BRAKE', horn: 'HORN' },
  cyclist: { forward: 'PEDAL', backward: 'BRAKE' },
  helicopter: { up: 'UP', down: 'DOWN', forward: 'FWD' }
};

class TouchControls {
  constructor(controllerManager) {
    this.controller = controllerManager;
    this.root = document.getElementById('touch-controls');
    this.stick = document.getElementById('touch-stick');
    this.knob = document.getElementById('touch-stick-knob');
    this.buttons = this.root ? [...this.root.querySelectorAll('[data-touch-action], [data-touch-tap]')] : [];
    this.buttonPointers = new Map();
    this.stickPointer = null;
    this.stickValues = {};
    this.enabled = true;
    this.available = false;
    this.touchSeen = false;
    this.onAvailabilityChange = null;
    this.onTap = null; // (name) => void, for one-shot buttons such as the horn
    this.media = window.matchMedia('(any-pointer: coarse)');

    if (!this.root || !this.stick || !this.knob) return;

    this.stick.addEventListener('pointerdown', (event) => {
      if (!this.canInteract() || event.button !== 0 || this.stickPointer !== null || this.buttonPointers.has(event.pointerId)) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = this.stick.getBoundingClientRect();
      this.stickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      this.stickRadius = Math.min(MAX_RADIUS, Math.min(rect.width, rect.height) / 2) || MAX_RADIUS;
      this.stickPointer = event.pointerId;
      try { this.stick.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
      this.stick.classList.add('is-pressed');
      this.moveStick(event);
    });
    this.stick.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.stickPointer) return;
      event.preventDefault();
      event.stopPropagation();
      this.moveStick(event);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.stick.addEventListener(type, (event) => this.releaseStick(event.pointerId));
    }

    for (const button of this.buttons) {
      const action = button.getAttribute('data-touch-action');
      const tap = button.getAttribute('data-touch-tap');
      button.addEventListener('pointerdown', (event) => {
        if (!this.canInteract() || button.hidden || event.button !== 0 || this.buttonPointers.has(event.pointerId) || event.pointerId === this.stickPointer) return;
        event.preventDefault();
        event.stopPropagation();
        globalThis.navigator?.vibrate?.(8); // short haptic tick on Android
        if (tap) {
          button.classList.add('is-pressed');
          setTimeout(() => button.classList.remove('is-pressed'), 140);
          if (typeof this.onTap === 'function') this.onTap(tap);
          return;
        }
        this.buttonPointers.set(event.pointerId, { button, action });
        this.updateButton(button);
        try { button.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        button.addEventListener(type, (event) => this.releaseButton(event.pointerId));
      }
      // A long press must not open the Android context menu
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    }

    this.media.addEventListener('change', () => this.updateAvailability());
    // Hybrid devices can report a fine pointer until their first touch. Capture runs before the control handlers.
    document.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch' || this.touchSeen) return;
      this.touchSeen = true;
      this.updateAvailability();
    }, { capture: true, passive: true });
    window.addEventListener('blur', () => this.reset());
    window.addEventListener('resize', () => this.reset());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    });

    this.setMode(controllerManager.activeMode || 'car');
    this.updateAvailability();
  }

  canInteract() {
    return this.enabled && this.available && !document.hidden;
  }

  updateAvailability() {
    const available = this.media.matches || this.touchSeen;
    const changed = available !== this.available;
    if (changed) this.reset();
    this.available = available;
    document.body.classList.toggle('touch-enabled', available);
    this.root.hidden = !this.enabled || !available;
    if (changed && typeof this.onAvailabilityChange === 'function') this.onAvailabilityChange(available);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.reset();
    if (this.root) this.root.hidden = !this.enabled || !this.available;
  }

  setMode(mode) {
    if (!BUTTON_LAYOUT[mode]) return;
    this.reset();
    this.mode = mode;
    if (!this.root) return;
    this.root.dataset.mode = mode;
    const layout = BUTTON_LAYOUT[mode];
    for (const button of this.buttons) {
      const key = button.getAttribute('data-touch-action') || button.getAttribute('data-touch-tap');
      const label = layout[key];
      button.hidden = !label;
      if (!label) continue;
      button.setAttribute('aria-label', label);
      const text = button.querySelector('[data-touch-label]');
      if (text) text.textContent = label;
    }
  }

  moveStick(event) {
    const dx = event.clientX - this.stickCenter.x;
    const dy = event.clientY - this.stickCenter.y;
    const distance = Math.hypot(dx, dy);
    const reach = Math.min(distance / this.stickRadius, 1);
    const strength = Math.max(0, (reach - DEAD_ZONE) / (1 - DEAD_ZONE));
    const x = distance ? dx / distance : 0;
    const y = distance ? dy / distance : 0;
    this.knob.style.setProperty('--stick-x', `${x * reach * this.stickRadius}px`);
    this.knob.style.setProperty('--stick-y', `${y * reach * this.stickRadius}px`);
    this.stickValues.left = Math.max(0, -x * strength);
    this.stickValues.right = Math.max(0, x * strength);
    this.stickValues.forward = Math.max(0, -y * strength);
    this.stickValues.backward = Math.max(0, y * strength);
    this.apply();
  }

  // Blend the stick and the held buttons into the controller's touch input
  apply() {
    const held = new Set([...this.buttonPointers.values()].map((pointer) => pointer.action));
    for (const action of MOVE_ACTIONS) {
      this.controller.setTouchInput(action, held.has(action) ? 1 : (this.stickValues[action] || 0));
    }
  }

  releaseCapture(element, pointerId) {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  }

  releaseStick(pointerId) {
    if (pointerId !== this.stickPointer || this.stickPointer === null) return;
    this.stickPointer = null;
    this.releaseCapture(this.stick, pointerId);
    this.stick.classList.remove('is-pressed');
    this.knob.style.setProperty('--stick-x', '0px');
    this.knob.style.setProperty('--stick-y', '0px');
    this.stickValues = {};
    this.apply();
  }

  updateButton(button) {
    const pressed = [...this.buttonPointers.values()].some((pointer) => pointer.button === button);
    button.classList.toggle('is-pressed', pressed);
    button.setAttribute('aria-pressed', String(pressed));
    this.apply();
  }

  releaseButton(pointerId) {
    const pointer = this.buttonPointers.get(pointerId);
    if (!pointer) return;
    this.buttonPointers.delete(pointerId);
    this.releaseCapture(pointer.button, pointerId);
    this.updateButton(pointer.button);
  }

  reset() {
    this.releaseStick(this.stickPointer);
    for (const pointerId of [...this.buttonPointers.keys()]) this.releaseButton(pointerId);
    for (const button of this.buttons) {
      button.classList.remove('is-pressed');
      button.setAttribute('aria-pressed', 'false');
    }
    this.stickValues = {};
    this.controller.clearTouchInput();
  }
}

export { TouchControls };
