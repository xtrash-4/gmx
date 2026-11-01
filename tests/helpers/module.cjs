const vm = require('node:vm');

// Keep the existing isolated unit harnesses synchronous. Only the app's static import/export declarations
// are adapted; dependencies are explicit namespace stubs, and the production function bodies run unchanged.
// Android build: modules read the graphics profile from ./quality.js. Unless a test stubs it, load the real module
// as a desktop browser would see it, so the tests exercise the original (High) settings.
let desktopQuality = null;
function getDesktopQuality() {
  if (!desktopQuality) {
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'js', 'quality.js'), 'utf8');
    desktopQuality = loadModule(source, {
      filename: 'quality.js',
      globals: {
        navigator: { userAgent: 'node' },
        screen: {},
        location: { search: '', href: 'http://localhost/' },
        localStorage: { getItem: () => null, setItem() {} },
        URLSearchParams,
        URL
      }
    });
  }
  return desktopQuality;
}

function loadModule(source, { imports = {}, globals = {}, filename = 'module.js' } = {}) {
  if (!Object.hasOwn(imports, './quality.js') && /from\s+['"]\.\/quality\.js['"]/.test(source)) {
    imports = { ...imports, './quality.js': getDesktopQuality() };
  }
  const exported = [];
  const names = (list) => list.split(',').map((name) => name.trim()).filter(Boolean).map((name) => {
    const match = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(name);
    if (!match) throw new Error(`Unsupported module binding: ${name}`);
    return [match[1], match[2] || match[1]];
  });
  let code = source.replace(/^import\s+(\*[\s\S]*?|\{[\s\S]*?\})\s+from\s+(['"])([^'"\n]+)\2\s*;/gm, (_declaration, bindings, _quote, specifier) => {
    if (!Object.hasOwn(imports, specifier)) throw new Error(`Missing import stub: ${specifier}`);
    const namespace = /^\*\s+as\s+([\w$]+)$/.exec(bindings.trim());
    const target = `imports[${JSON.stringify(specifier)}]`;
    if (namespace) return `const ${namespace[1]} = ${target};`;
    const fields = names(bindings.slice(1, -1)).map(([name, local]) => `${name}: ${local}`);
    return `const { ${fields.join(', ')} } = ${target};`;
  });
  code = code.replace(/^export\s*\{([^}]+)\}\s*;/gm, (_declaration, bindings) => {
    exported.push(...names(bindings));
    return '';
  });
  code = code.replace(/^export\s+(const|let|var|function|class)\s+([\w$]+)/gm, (_declaration, kind, name) => {
    exported.push([name, name]);
    return `${kind} ${name}`;
  });
  if (/^\s*(?:import|export)\b/m.test(code)) throw new Error(`Unsupported module syntax in ${filename}`);
  const properties = exported.map(([local, name]) => `${JSON.stringify(name)}: ${local}`).join(', ');
  const evaluate = vm.runInNewContext(`(function (imports) { 'use strict';\n${code}\nreturn { ${properties} };\n})`, globals, { filename });
  return evaluate(imports);
}

module.exports = { loadModule };
