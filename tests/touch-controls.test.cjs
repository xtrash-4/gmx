const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/touch-controls.js'), 'utf8');

function element(attributes = {}) {
  const listeners = new Map();
  const classes = new Set();
  const captures = new Set();
  const styles = new Map();
  return {
    hidden: false,
    textContent: '',
    dataset: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); }
    },
    style: { setProperty: (name, value) => styles.set(name, value), getPropertyValue: (name) => styles.get(name) },
    getAttribute: (name) => attributes[name],
    setAttribute: (name, value) => { attributes[name] = value; },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, options = {}) {
      const event = { pointerId: 1, pointerType: 'touch', button: 0, clientX: 64, clientY: 64, preventDefault() {}, stopPropagation() {}, ...options };
      for (const listener of listeners.get(type) || []) listener(event);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 128, height: 128 }),
    setPointerCapture: (id) => captures.add(id),
    hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture(id) {
      if (captures.delete(id)) this.dispatch('lostpointercapture', { pointerId: id });
    }
  };
}

function harness({ coarse = true, mode = 'person' } = {}) {
  const window = element();
  const document = { ...element(), body: element(), hidden: false };
  const media = { ...element(), matches: coarse };
  window.matchMedia = () => media;
  const root = element();
  const stick = element();
  const knob = element();
  // Android build: hold buttons (forward / backward / up / down) and the one-shot horn
  const buttons = Object.fromEntries(['forward', 'backward', 'up', 'down'].map((action) => [action, element({ 'data-touch-action': action })]));
  buttons.horn = element({ 'data-touch-tap': 'horn' });
  const labels = Object.fromEntries(['forward', 'backward', 'up', 'down'].map((action) => [action, element()]));
  for (const [action, button] of Object.entries(buttons)) button.querySelector = () => labels[action] || null;
  root.querySelectorAll = () => Object.values(buttons);
  document.getElementById = (id) => ({ 'touch-controls': root, 'touch-stick': stick, 'touch-stick-knob': knob })[id];
  const input = Object.fromEntries(['forward', 'backward', 'left', 'right', 'up', 'down'].map((action) => [action, 0]));
  const controller = {
    activeMode: mode,
    setTouchInput(action, value) { input[action] = value; },
    clearTouchInput() { for (const action of Object.keys(input)) input[action] = 0; }
  };
  const { TouchControls } = loadModule(source, { globals: { window, document, setTimeout } });
  const controls = new TouchControls(controller);
  return { controls, window, document, media, root, stick, knob, buttons, labels, input };
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should be close to ${expected}`);
}

test('stick preserves analog strength and normalizes diagonal input with a radial deadzone', () => {
  const { stick, knob, input } = harness();
  stick.dispatch('pointerdown');
  stick.dispatch('pointermove', { clientX: 70 });
  assert.equal(input.right, 0, 'small motions stay in the deadzone');
  stick.dispatch('pointermove', { clientX: 86 });
  near(input.right, (22 / 52 - 0.12) / 0.88);
  assert.equal(input.left, 0);
  assert.equal(input.forward, 0);
  stick.dispatch('pointermove', { clientX: 164, clientY: -36 });
  near(input.right, Math.SQRT1_2);
  near(input.forward, Math.SQRT1_2);
  near(Math.hypot(input.right, input.forward), 1);
  near(Math.hypot(parseFloat(knob.style.getPropertyValue('--stick-x')), parseFloat(knob.style.getPropertyValue('--stick-y'))), 52);
  assert.equal(stick.hasPointerCapture(1), true);
});

test('stick and multiple held button pointers release independently', () => {
  const { stick, buttons, input } = harness({ mode: 'helicopter' });
  stick.dispatch('pointerdown', { clientY: 0 });
  buttons.up.dispatch('pointerdown', { pointerId: 2 });
  buttons.up.dispatch('pointerdown', { pointerId: 3 });
  buttons.down.dispatch('pointerdown', { pointerId: 4 });
  assert.equal(input.forward, 1);
  assert.equal(input.up, 1);
  assert.equal(input.down, 1);
  stick.dispatch('pointermove', { pointerId: 5, clientY: 108 });
  assert.equal(input.forward, 1, 'an unrelated camera pointer cannot move the stick');
  buttons.up.dispatch('pointerup', { pointerId: 2 });
  assert.equal(input.up, 1, 'the second ascend pointer remains held');
  assert.equal(buttons.up.getAttribute('aria-pressed'), 'true');
  stick.dispatch('pointerup');
  assert.equal(input.forward, 0);
  assert.equal(input.up, 1);
  assert.equal(input.down, 1);
  buttons.up.dispatch('pointerup', { pointerId: 3 });
  assert.equal(input.up, 0);
  assert.equal(buttons.up.classList.contains('is-pressed'), false);
  assert.equal(buttons.up.getAttribute('aria-pressed'), 'false');
  assert.equal(input.down, 1);
});

for (const type of ['pointercancel', 'lostpointercapture']) {
  test(`${type} clears only the affected pointer and its feedback`, () => {
    const { stick, knob, buttons, input } = harness();
    stick.dispatch('pointerdown', { clientX: 20 });
    buttons.up.dispatch('pointerdown', { pointerId: 2 });
    stick.dispatch(type);
    assert.equal(input.left, 0);
    assert.equal(input.up, 1);
    assert.equal(stick.classList.contains('is-pressed'), false);
    assert.equal(knob.style.getPropertyValue('--stick-x'), '0px');
    buttons.up.dispatch(type, { pointerId: 2 });
    assert.equal(input.up, 0);
    assert.equal(buttons.up.getAttribute('aria-pressed'), 'false');
  });
}

test('mode changes clear touches and expose the relevant actions', () => {
  const { controls, stick, buttons, labels, input } = harness();
  const visible = () => Object.entries(buttons).filter(([, button]) => !button.hidden).map(([key]) => key).sort();
  assert.deepEqual(visible(), ['forward', 'up']);
  assert.equal(labels.up.textContent, 'JUMP');
  assert.equal(labels.forward.textContent, 'RUN');
  stick.dispatch('pointerdown', { clientY: 0 });
  buttons.up.dispatch('pointerdown', { pointerId: 2 });
  controls.setMode('helicopter');
  assert.equal(Object.values(input).some(Boolean), false);
  assert.equal(stick.hasPointerCapture(1), false);
  assert.equal(buttons.up.hasPointerCapture(2), false);
  assert.deepEqual(visible(), ['down', 'forward', 'up']);
  assert.equal(labels.up.textContent, 'UP');
  controls.setMode('car');
  assert.deepEqual(visible(), ['backward', 'forward', 'horn']);
  assert.equal(labels.forward.textContent, 'GAS');
  assert.equal(labels.backward.textContent, 'BRAKE');
  buttons.up.dispatch('pointerdown', { pointerId: 3 });
  assert.equal(input.up, 0, 'hidden actions cannot receive input');
  controls.setMode('cyclist');
  assert.deepEqual(visible(), ['backward', 'forward']);
});

test('the gas button and the stick drive forward together; the horn is a one-shot tap', () => {
  const { controls, stick, buttons, input } = harness({ mode: 'car' });
  const taps = [];
  controls.onTap = (name) => taps.push(name);
  stick.dispatch('pointerdown', { clientY: 40 });
  assert.ok(input.forward > 0 && input.forward < 1, 'a partial stick push is analog');
  buttons.forward.dispatch('pointerdown', { pointerId: 2 });
  assert.equal(input.forward, 1, 'holding GAS is full throttle');
  buttons.forward.dispatch('pointerup', { pointerId: 2 });
  assert.ok(input.forward > 0 && input.forward < 1, 'releasing GAS falls back to the stick');
  buttons.horn.dispatch('pointerdown', { pointerId: 3 });
  assert.deepEqual(taps, ['horn']);
  assert.equal(Object.values(input).filter((v) => v === 1).length, 0, 'the horn holds no movement input');
});

test('disabling controls clears held input and blocks new input until enabled', () => {
  const { controls, root, stick, buttons, input } = harness();
  stick.dispatch('pointerdown', { clientY: 0 });
  buttons.up.dispatch('pointerdown', { pointerId: 2 });
  controls.setEnabled(false);
  assert.equal(root.hidden, true);
  assert.equal(Object.values(input).some(Boolean), false);
  stick.dispatch('pointerdown', { clientY: 0 });
  buttons.up.dispatch('pointerdown', { pointerId: 3 });
  assert.equal(Object.values(input).some(Boolean), false);
  controls.setEnabled(true);
  assert.equal(root.hidden, false);
  stick.dispatch('pointerdown', { clientY: 0 });
  assert.equal(input.forward, 1);
});

for (const interruption of ['blur', 'hidden', 'resize']) {
  test(`${interruption} resets all held input and pointer captures`, () => {
    const { window, document, stick, buttons, input } = harness();
    stick.dispatch('pointerdown', { clientY: 0 });
    buttons.up.dispatch('pointerdown', { pointerId: 2 });
    if (interruption === 'hidden') {
      document.hidden = true;
      document.dispatch('visibilitychange');
    } else {
      window.dispatch(interruption);
    }
    assert.equal(Object.values(input).some(Boolean), false);
    assert.equal(stick.hasPointerCapture(1), false);
    assert.equal(buttons.up.hasPointerCapture(2), false);
  });
}

test('desktop controls stay hidden until a coarse pointer or first touch is available', () => {
  const { document, media, root, stick, input } = harness({ coarse: false });
  assert.equal(root.hidden, true);
  assert.equal(document.body.classList.contains('touch-enabled'), false);
  media.matches = true;
  media.dispatch('change');
  assert.equal(root.hidden, false);
  stick.dispatch('pointerdown', { clientY: 0 });
  media.matches = false;
  media.dispatch('change');
  assert.equal(root.hidden, true);
  assert.equal(input.forward, 0, 'losing availability clears active controls');
  document.dispatch('pointerdown', { pointerType: 'mouse' });
  assert.equal(root.hidden, true);
  document.dispatch('pointerdown', { pointerType: 'touch' });
  assert.equal(root.hidden, false);
  assert.equal(document.body.classList.contains('touch-enabled'), true);
});

test('availability callback runs after visibility updates and only on an actual change', () => {
  const { controls, document, media, root } = harness({ coarse: false });
  assert.equal(controls.onAvailabilityChange, null);
  const changes = [];
  controls.onAvailabilityChange = (available) => {
    changes.push(available);
    assert.equal(document.body.classList.contains('touch-enabled'), available);
    assert.equal(root.hidden, !available);
  };
  media.dispatch('change');
  assert.deepEqual(changes, []);
  media.matches = true;
  media.dispatch('change');
  media.dispatch('change');
  assert.deepEqual(changes, [true]);
  media.matches = false;
  media.dispatch('change');
  document.dispatch('pointerdown', { pointerType: 'touch' });
  document.dispatch('pointerdown', { pointerType: 'touch' });
  assert.deepEqual(changes, [true, false, true]);
});
