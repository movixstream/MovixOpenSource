import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  shouldInterruptAfterDeadline,
} from 'quickjs-emscripten-core';

const WASM_CDN_URL =
  'https://cdn.jsdelivr.net/npm/@jitl/quickjs-wasmfile-release-sync@0.32.0/dist/emscripten-module.wasm';
const WASM_SHA256 =
  '105c3bed22d457e43e3d1c3c1c6959fda62a8fe06f0fc8a985303c3a2be72232';
const MAX_WASM_BYTES = 600 * 1024;
const MAX_HTML_LENGTH = 512 * 1024;
const MAX_SCRIPT_LENGTH = 128 * 1024;
const MAX_TOTAL_SCRIPT_LENGTH = 256 * 1024;
const MAX_SCRIPT_COUNT = 16;
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
const STACK_LIMIT_BYTES = 512 * 1024;
// WASM is slower than the native Python binding on packed Fsvid scripts.
const EXECUTION_TIMEOUT_MS = 1500;
const MAX_MEDIA_URL_LENGTH = 16 * 1024;
const PLAYER_SIGNALS = Object.freeze([
  'videojs',
  'jwplayer',
  'sources',
  'atob(',
  'eval(function',
  'eval ( function',
  '.m3u8',
]);

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;

let quickJsModulePromise;

// Mini-DOM injecté dans QuickJS via `toString()` : la fonction doit rester
// autonome (aucune référence à la portée du module). Les lecteurs Fsvid et
// Vidzy dérivent leur clé de `offsetWidth` d'éléments qu'ils créent (un div
// enfant à 50 % d'un parent en `calc(1in + Npx)` en octobre 2026). On calcule
// donc les largeurs comme un navigateur : `style.cssText`, arbre
// parent/enfant, pourcentages relatifs au bloc conteneur, unités absolues et
// relatives, `calc()`, padding/bordure, `display:none` et élément détaché à 0,
// `html`/`body` posés sur une fenêtre de 1280 × 720.
// Toute modification doit être reportée dans `movixCreateDomEmulator` du
// userscript (userscript/movix.user.js).
export function movixCreateDomEmulator(fallback, viewportWidth, viewportHeight) {
  var BLOCK_TAGS = { html: 1, body: 1, div: 1, p: 1, section: 1, article: 1, main: 1, header: 1, footer: 1, nav: 1, aside: 1, ul: 1, ol: 1, li: 1, form: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, pre: 1, blockquote: 1, figure: 1, table: 1, fieldset: 1, center: 1, dl: 1, dd: 1, dt: 1, hr: 1 };
  var HIDDEN_TAGS = { head: 1, script: 1, style: 1, meta: 1, link: 1, title: 1, template: 1, noscript: 1 };
  var REPLACED_SIZES = { img: [0, 0], video: [300, 150], canvas: [300, 150], iframe: [300, 150], object: [300, 150], embed: [300, 150], input: [153, 21], button: [0, 0], textarea: [182, 36], select: [0, 19] };
  var ABSOLUTE_UNITS = { px: 1, 'in': 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, pt: 96 / 72, pc: 16 };
  var FONT_KEYWORDS = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48 };
  var BORDER_KEYWORDS = { thin: 1, medium: 3, thick: 5 };
  var BORDER_STYLES = { none: 1, hidden: 1, dotted: 1, dashed: 1, solid: 1, double: 1, groove: 1, ridge: 1, inset: 1, outset: 1 };
  var SIDES = ['top', 'right', 'bottom', 'left'];

  function kebab(name) {
    name = String(name);
    if (name.indexOf('-') !== -1) return name.toLowerCase();
    return name.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
  }

  function splitTopLevel(text, separator) {
    var parts = [];
    var depth = 0;
    var start = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0 && (separator === ' ' ? /\s/.test(c) : c === separator)) {
        parts.push(text.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(text.slice(start));
    var out = [];
    for (var j = 0; j < parts.length; j++) {
      var part = parts[j].trim();
      if (part) out.push(part);
    }
    return out;
  }

  function expandBox(declarations, name, value) {
    var values = splitTopLevel(value, ' ');
    if (!values.length || values.length > 4) return;
    var top = values[0];
    var right = values.length > 1 ? values[1] : top;
    var bottom = values.length > 2 ? values[2] : top;
    var left = values.length > 3 ? values[3] : right;
    var expanded = [top, right, bottom, left];
    for (var i = 0; i < 4; i++) {
      declarations[name.replace('*', SIDES[i])] = expanded[i];
    }
  }

  function expandBorder(declarations, sides, value) {
    var width = 'medium';
    var style = 'none';
    var tokens = splitTopLevel(value, ' ');
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i].toLowerCase();
      if (BORDER_STYLES[token]) style = token;
      else if (BORDER_KEYWORDS[token] !== undefined || /^[-+.\d]|^calc\(/.test(token)) width = token;
    }
    for (var j = 0; j < sides.length; j++) {
      declarations['border-' + sides[j] + '-width'] = width;
      declarations['border-' + sides[j] + '-style'] = style;
    }
  }

  function setDeclaration(declarations, rawName, rawValue) {
    var name = kebab(rawName).trim();
    var value = String(rawValue == null ? '' : rawValue).replace(/!\s*important\s*$/i, '').trim();
    if (!name) return;
    if (!value) {
      delete declarations[name];
      return;
    }
    if (name === 'padding' || name === 'margin') expandBox(declarations, name + '-*', value);
    else if (name === 'border-width') expandBox(declarations, 'border-*-width', value);
    else if (name === 'border-style') expandBox(declarations, 'border-*-style', value);
    else if (name === 'border') expandBorder(declarations, SIDES, value);
    else if (/^border-(top|right|bottom|left)$/.test(name)) expandBorder(declarations, [name.slice(7)], value);
    else if (name === 'inset') expandBox(declarations, '*', value);
    else declarations[name] = value;
  }

  function parseCssText(declarations, text) {
    var keys = Object.keys(declarations);
    for (var k = 0; k < keys.length; k++) delete declarations[keys[k]];
    var entries = splitTopLevel(String(text == null ? '' : text), ';');
    for (var i = 0; i < entries.length; i++) {
      var colon = entries[i].indexOf(':');
      if (colon <= 0) continue;
      setDeclaration(declarations, entries[i].slice(0, colon), entries[i].slice(colon + 1));
    }
  }

  function serialize(declarations) {
    var keys = Object.keys(declarations);
    var out = [];
    for (var i = 0; i < keys.length; i++) out.push(keys[i] + ': ' + declarations[keys[i]] + ';');
    return out.join(' ');
  }

  // Évalue une longueur CSS (calc() compris) en px. `context.percent` est la
  // base des pourcentages (null = indéfinie → la valeur est ignorée).
  function resolveLength(raw, context) {
    var text = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!text) return null;
    var position = 0;
    function skip() { while (position < text.length && /\s/.test(text.charAt(position))) position++; }
    function fail() { throw new Error('css'); }
    function primary() {
      skip();
      var c = text.charAt(position);
      if (c === '(') {
        position++;
        var inner = sum();
        skip();
        if (text.charAt(position) !== ')') fail();
        position++;
        return inner;
      }
      var fn = /^(calc|min|max|clamp)\(/.exec(text.slice(position));
      if (fn) {
        position += fn[0].length;
        var args = [sum()];
        skip();
        while (text.charAt(position) === ',') {
          position++;
          args.push(sum());
          skip();
        }
        if (text.charAt(position) !== ')') fail();
        position++;
        if (fn[1] === 'calc') return args[0];
        if (fn[1] === 'min') return Math.min.apply(Math, args);
        if (fn[1] === 'max') return Math.max.apply(Math, args);
        if (args.length !== 3) fail();
        return Math.max(args[0], Math.min(args[1], args[2]));
      }
      var number = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(%|[a-z]+)?/.exec(text.slice(position));
      if (!number) fail();
      position += number[0].length;
      var value = parseFloat(number[1]);
      var unit = number[2] || '';
      if (!unit) return value;
      if (unit === '%') {
        if (context.percent == null) throw new Error('indefinite');
        return (value * context.percent) / 100;
      }
      if (ABSOLUTE_UNITS[unit] !== undefined) return value * ABSOLUTE_UNITS[unit];
      if (unit === 'em') return value * context.fontSize;
      if (unit === 'rem') return value * 16;
      if (unit === 'ex' || unit === 'ch') return value * context.fontSize * 0.5;
      if (unit === 'vw' || unit === 'svw' || unit === 'lvw' || unit === 'dvw') return (value * viewportWidth) / 100;
      if (unit === 'vh' || unit === 'svh' || unit === 'lvh' || unit === 'dvh') return (value * viewportHeight) / 100;
      if (unit === 'vmin') return (value * Math.min(viewportWidth, viewportHeight)) / 100;
      if (unit === 'vmax') return (value * Math.max(viewportWidth, viewportHeight)) / 100;
      fail();
    }
    function product() {
      var value = primary();
      for (;;) {
        skip();
        var c = text.charAt(position);
        if (c !== '*' && c !== '/') return value;
        position++;
        var right = primary();
        if (c === '*') value *= right;
        else {
          if (!right) fail();
          value /= right;
        }
      }
    }
    function sum() {
      var value = product();
      for (;;) {
        skip();
        var c = text.charAt(position);
        if (c !== '+' && c !== '-') return value;
        position++;
        var right = product();
        value = c === '+' ? value + right : value - right;
      }
    }
    try {
      var result = sum();
      skip();
      if (position !== text.length || !isFinite(result)) return null;
      return result;
    } catch (_) {
      return null;
    }
  }

  var nodes = [];
  var documentElement;
  var body;
  var head;

  function nodeOf(value) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].proxy === value || nodes[i] === value) return nodes[i];
    }
    return null;
  }

  function declared(node, name) {
    return node.style[name];
  }

  function displayOf(node) {
    var value = String(declared(node, 'display') || '').toLowerCase();
    if (value) return value;
    if (HIDDEN_TAGS[node.tag]) return 'none';
    if (BLOCK_TAGS[node.tag]) return 'block';
    if (REPLACED_SIZES[node.tag]) return 'inline-block';
    return 'inline';
  }

  function positionOf(node) {
    return String(declared(node, 'position') || 'static').toLowerCase();
  }

  function isRendered(node) {
    var current = node;
    while (current) {
      if (displayOf(current) === 'none') return false;
      if (current === documentElement) return true;
      current = current.parent;
    }
    return false;
  }

  function fontSizeOf(node) {
    var parentSize = node.parent ? fontSizeOf(node.parent) : 16;
    var raw = String(declared(node, 'font-size') || '').toLowerCase();
    if (!raw) return parentSize;
    if (FONT_KEYWORDS[raw] !== undefined) return FONT_KEYWORDS[raw];
    if (raw === 'smaller') return parentSize / 1.2;
    if (raw === 'larger') return parentSize * 1.2;
    var size = resolveLength(raw, { percent: parentSize, fontSize: parentSize });
    return size == null || size < 0 ? parentSize : size;
  }

  function lengthOf(node, name, percentBase, fallbackValue) {
    var raw = declared(node, name);
    if (raw == null || raw === '' || /^(auto|none|initial|inherit|unset)$/i.test(String(raw))) return fallbackValue;
    var value = resolveLength(raw, { percent: percentBase, fontSize: fontSizeOf(node) });
    return value == null ? fallbackValue : value;
  }

  function borderOf(node, side) {
    var style = String(declared(node, 'border-' + side + '-style') || 'none').toLowerCase();
    if (style === 'none' || style === 'hidden') return 0;
    var raw = String(declared(node, 'border-' + side + '-width') || 'medium').toLowerCase();
    if (BORDER_KEYWORDS[raw] !== undefined) return BORDER_KEYWORDS[raw];
    var value = resolveLength(raw, { percent: null, fontSize: fontSizeOf(node) });
    return value == null || value < 0 ? 0 : value;
  }

  function horizontalExtras(node, containingWidth) {
    return {
      padding: Math.max(0, lengthOf(node, 'padding-left', containingWidth, 0)) + Math.max(0, lengthOf(node, 'padding-right', containingWidth, 0)),
      border: borderOf(node, 'left') + borderOf(node, 'right'),
      margin: lengthOf(node, 'margin-left', containingWidth, node.tag === 'body' ? 8 : 0) + lengthOf(node, 'margin-right', containingWidth, node.tag === 'body' ? 8 : 0)
    };
  }

  function verticalExtras(node, containingWidth) {
    return {
      padding: Math.max(0, lengthOf(node, 'padding-top', containingWidth, 0)) + Math.max(0, lengthOf(node, 'padding-bottom', containingWidth, 0)),
      border: borderOf(node, 'top') + borderOf(node, 'bottom'),
      margin: lengthOf(node, 'margin-top', containingWidth, node.tag === 'body' ? 8 : 0) + lengthOf(node, 'margin-bottom', containingWidth, node.tag === 'body' ? 8 : 0)
    };
  }

  // Bloc conteneur : contenu du parent en flux normal, boîte de padding du
  // premier ancêtre positionné pour `absolute`, la fenêtre pour `fixed`.
  // Les largeurs ne remontent que vers les ancêtres et ne descendent que
  // pour le rétrécissement : aucun cycle possible.
  function positionedAncestor(node) {
    var ancestor = node.parent;
    while (ancestor && ancestor !== documentElement && positionOf(ancestor) === 'static') ancestor = ancestor.parent;
    return !ancestor || ancestor === documentElement ? null : ancestor;
  }

  function containingWidthOf(node) {
    var position = positionOf(node);
    if (node === documentElement || position === 'fixed') return viewportWidth;
    if (position === 'absolute') {
      var ancestor = positionedAncestor(node);
      if (!ancestor) return viewportWidth;
      var box = widthBox(ancestor);
      return box.contentWidth + box.paddingX;
    }
    return node.parent ? widthBox(node.parent).contentWidth : 0;
  }

  function containingHeightOf(node) {
    var position = positionOf(node);
    if (node === documentElement || position === 'fixed') return viewportHeight;
    if (position === 'absolute') {
      var ancestor = positionedAncestor(node);
      if (!ancestor) return viewportHeight;
      var height = definiteHeightOf(ancestor);
      return height == null ? null : height + verticalExtras(ancestor, containingWidthOf(ancestor)).padding;
    }
    return node.parent ? definiteHeightOf(node.parent) : null;
  }

  function clampWidth(node, width, containingWidth, extras, borderBox) {
    var adjust = borderBox ? extras.padding + extras.border : 0;
    var maxWidth = lengthOf(node, 'max-width', containingWidth, null);
    if (maxWidth != null) width = Math.min(width, Math.max(0, maxWidth - adjust));
    var minWidth = lengthOf(node, 'min-width', containingWidth, null);
    if (minWidth != null) width = Math.max(width, Math.max(0, minWidth - adjust));
    return Math.max(0, width);
  }

  function shrinkToFit(node) {
    var width = 0;
    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i];
      if (displayOf(child) === 'none' || positionOf(child) === 'absolute' || positionOf(child) === 'fixed') continue;
      var box = widthBox(child, 0);
      width = Math.max(width, box.contentWidth + box.paddingX + box.borderX + box.marginX);
    }
    return width;
  }

  function widthBox(node, forcedContainingWidth) {
    var display = displayOf(node);
    var containingWidth = forcedContainingWidth == null ? containingWidthOf(node) : forcedContainingWidth;
    var horizontal = horizontalExtras(node, containingWidth);
    var borderBox = String(declared(node, 'box-sizing') || '').toLowerCase() === 'border-box';
    var position = positionOf(node);
    var floating = /^(left|right|inline-start|inline-end)$/i.test(String(declared(node, 'float') || ''));
    var replaced = REPLACED_SIZES[node.tag];
    var contentWidth;

    if (display === 'inline' && !replaced) {
      contentWidth = 0;
    } else {
      var specified = lengthOf(node, 'width', containingWidth, null);
      if (specified != null) {
        contentWidth = borderBox ? specified - horizontal.padding - horizontal.border : specified;
      } else if (replaced) {
        contentWidth = replaced[0];
      } else if (position === 'absolute' || position === 'fixed') {
        var left = lengthOf(node, 'left', containingWidth, null);
        var right = lengthOf(node, 'right', containingWidth, null);
        contentWidth = left != null && right != null
          ? containingWidth - left - right - horizontal.margin - horizontal.padding - horizontal.border
          : shrinkToFit(node);
      } else if (
        floating ||
        /^inline-|^table/.test(display) ||
        /(?:fit|max|min)-content/i.test(String(declared(node, 'width') || ''))
      ) {
        contentWidth = shrinkToFit(node);
      } else {
        contentWidth = containingWidth - horizontal.margin - horizontal.padding - horizontal.border;
      }
      contentWidth = clampWidth(node, contentWidth, containingWidth, horizontal, borderBox);
    }

    return {
      contentWidth: contentWidth,
      paddingX: horizontal.padding,
      borderX: horizontal.border,
      marginX: horizontal.margin
    };
  }

  // Hauteur de contenu imposée par le style (null si `auto` ou pourcentage
  // d'un bloc conteneur sans hauteur définie).
  function definiteHeightOf(node) {
    if (node === documentElement) return viewportHeight;
    if (displayOf(node) === 'inline' && !REPLACED_SIZES[node.tag]) return null;
    var specified = lengthOf(node, 'height', containingHeightOf(node), null);
    if (specified == null) return null;
    if (String(declared(node, 'box-sizing') || '').toLowerCase() === 'border-box') {
      var vertical = verticalExtras(node, containingWidthOf(node));
      specified -= vertical.padding + vertical.border;
    }
    return Math.max(0, specified);
  }

  function heightBox(node) {
    var vertical = verticalExtras(node, containingWidthOf(node));
    var replaced = REPLACED_SIZES[node.tag];
    var contentHeight = definiteHeightOf(node);
    if (contentHeight == null) {
      if (displayOf(node) === 'inline' && !replaced) contentHeight = 0;
      else if (replaced) contentHeight = replaced[1];
      else {
        contentHeight = 0;
        for (var i = 0; i < node.children.length; i++) {
          var child = node.children[i];
          var childPosition = positionOf(child);
          if (displayOf(child) === 'none' || childPosition === 'absolute' || childPosition === 'fixed') continue;
          var childBox = heightBox(child);
          contentHeight += childBox.contentHeight + childBox.paddingY + childBox.borderY + childBox.marginY;
        }
      }
    }
    return {
      contentHeight: contentHeight,
      paddingY: vertical.padding,
      borderY: vertical.border,
      marginY: vertical.margin
    };
  }

  function measure(node) {
    if (!isRendered(node)) return { width: 0, height: 0, clientWidth: 0, clientHeight: 0 };
    var box = widthBox(node);
    var vertical = heightBox(node);
    var inline = displayOf(node) === 'inline' && !REPLACED_SIZES[node.tag];
    return {
      width: box.contentWidth + box.paddingX + box.borderX,
      height: vertical.contentHeight + vertical.paddingY + vertical.borderY,
      clientWidth: inline ? 0 : box.contentWidth + box.paddingX,
      clientHeight: inline ? 0 : vertical.contentHeight + vertical.paddingY
    };
  }

  function detach(node) {
    if (!node.parent) return;
    var siblings = node.parent.children;
    var index = siblings.indexOf(node);
    if (index !== -1) siblings.splice(index, 1);
    node.parent = null;
  }

  function contains(ancestor, node) {
    for (var current = node; current; current = current.parent) {
      if (current === ancestor) return true;
    }
    return false;
  }

  function insert(parent, child, before) {
    var childNode = nodeOf(child);
    if (!childNode) return child;
    if (contains(childNode, parent)) throw new Error('HierarchyRequestError');
    detach(childNode);
    var referenceNode = before == null ? null : nodeOf(before);
    var index = referenceNode ? parent.children.indexOf(referenceNode) : -1;
    if (index === -1) parent.children.push(childNode);
    else parent.children.splice(index, 0, childNode);
    childNode.parent = parent;
    return child;
  }

  function createStyle(node) {
    return new Proxy({}, {
      get: function (_target, property) {
        if (typeof property !== 'string') return undefined;
        if (property === 'cssText') return serialize(node.style);
        if (property === 'setProperty') return function (name, value) { setDeclaration(node.style, name, value); };
        if (property === 'getPropertyValue') return function (name) { return node.style[kebab(name)] || ''; };
        if (property === 'removeProperty') return function (name) { var key = kebab(name); var old = node.style[key] || ''; delete node.style[key]; return old; };
        if (property === 'length') return Object.keys(node.style).length;
        return node.style[kebab(property)] || '';
      },
      set: function (_target, property, value) {
        if (typeof property !== 'string') return true;
        if (property === 'cssText') parseCssText(node.style, value);
        else setDeclaration(node.style, property, value);
        return true;
      }
    });
  }

  function createNode(tagName) {
    var node = { tag: String(tagName || 'div').toLowerCase(), parent: null, children: [], style: {}, attributes: {}, props: {} };
    var style = createStyle(node);
    var methods = {
      appendChild: function (child) { return insert(node, child, null); },
      append: function () { for (var i = 0; i < arguments.length; i++) insert(node, arguments[i], null); },
      prepend: function () { for (var i = arguments.length - 1; i >= 0; i--) insert(node, arguments[i], node.children[0] ? node.children[0].proxy : null); },
      insertBefore: function (child, before) { return insert(node, child, before); },
      removeChild: function (child) { var childNode = nodeOf(child); if (childNode && childNode.parent === node) detach(childNode); return child; },
      replaceChild: function (child, old) { insert(node, child, old); var oldNode = nodeOf(old); if (oldNode) detach(oldNode); return old; },
      remove: function () { detach(node); },
      contains: function (other) { var otherNode = nodeOf(other); return Boolean(otherNode && contains(node, otherNode)); },
      setAttribute: function (name, value) {
        name = String(name).toLowerCase();
        node.attributes[name] = String(value);
        if (name === 'style') parseCssText(node.style, value);
      },
      getAttribute: function (name) {
        name = String(name).toLowerCase();
        if (name === 'style') return serialize(node.style);
        return Object.prototype.hasOwnProperty.call(node.attributes, name) ? node.attributes[name] : null;
      },
      hasAttribute: function (name) { return Object.prototype.hasOwnProperty.call(node.attributes, String(name).toLowerCase()); },
      removeAttribute: function (name) { delete node.attributes[String(name).toLowerCase()]; },
      getBoundingClientRect: function () {
        var size = measure(node);
        return { x: 0, y: 0, top: 0, left: 0, width: size.width, height: size.height, right: size.width, bottom: size.height };
      },
      getClientRects: function () { return isRendered(node) ? [methods.getBoundingClientRect()] : []; },
      addEventListener: function () {},
      removeEventListener: function () {},
      dispatchEvent: function () { return true; }
    };
    node.proxy = new Proxy(function () {}, {
      get: function (_target, property) {
        if (typeof property !== 'string') {
          if (property === Symbol.toPrimitive) return function () { return '[object HTMLElement]'; };
          return undefined;
        }
        if (Object.prototype.hasOwnProperty.call(methods, property)) return methods[property];
        if (property === 'style') return style;
        if (property === 'tagName' || property === 'nodeName') return node.tag.toUpperCase();
        if (property === 'nodeType') return 1;
        if (property === 'parentNode' || property === 'parentElement') return node.parent ? node.parent.proxy : null;
        if (property === 'isConnected') return contains(documentElement, node);
        if (property === 'children' || property === 'childNodes') return node.children.map(function (child) { return child.proxy; });
        if (property === 'firstChild' || property === 'firstElementChild') return node.children.length ? node.children[0].proxy : null;
        if (property === 'lastChild' || property === 'lastElementChild') return node.children.length ? node.children[node.children.length - 1].proxy : null;
        if (property === 'childElementCount') return node.children.length;
        if (property === 'offsetWidth') return Math.round(measure(node).width);
        if (property === 'offsetHeight') return Math.round(measure(node).height);
        if (property === 'clientWidth' || property === 'scrollWidth') return node === documentElement ? viewportWidth : Math.round(measure(node).clientWidth);
        if (property === 'clientHeight' || property === 'scrollHeight') return node === documentElement ? viewportHeight : Math.round(measure(node).clientHeight);
        if (property === 'offsetLeft' || property === 'offsetTop' || property === 'clientLeft' || property === 'clientTop' || property === 'scrollLeft' || property === 'scrollTop') return 0;
        if (property === 'offsetParent') return isRendered(node) && node !== body && node !== documentElement && positionOf(node) !== 'fixed' ? body.proxy : null;
        if (property === 'id' || property === 'className') return node.attributes[property === 'id' ? 'id' : 'class'] || '';
        if (property === 'ownerDocument') return documentProxy;
        if (property === 'then') return undefined;
        if (Object.prototype.hasOwnProperty.call(node.props, property)) return node.props[property];
        return fallback[property];
      },
      set: function (_target, property, value) {
        if (typeof property !== 'string') return true;
        if (property === 'style') parseCssText(node.style, value);
        else if (property === 'id') node.attributes.id = String(value);
        else if (property === 'className') node.attributes['class'] = String(value);
        else node.props[property] = value;
        return true;
      },
      apply: function () { return fallback; },
      construct: function () { return fallback; }
    });
    nodes.push(node);
    return node;
  }

  documentElement = createNode('html');
  head = createNode('head');
  body = createNode('body');
  insert(documentElement, head.proxy, null);
  insert(documentElement, body.proxy, null);

  function findByTag(tag) {
    tag = String(tag || '').trim().toLowerCase();
    if (tag === 'html') return documentElement.proxy;
    if (tag === 'body') return body.proxy;
    if (tag === 'head') return head.proxy;
    return null;
  }

  var documentMethods = {
    createElement: function (tag) { return createNode(tag).proxy; },
    createElementNS: function (_ns, tag) { return createNode(tag).proxy; },
    createTextNode: function () { return createNode('#text').proxy; },
    createDocumentFragment: function () { return createNode('#fragment').proxy; },
    querySelector: function (selector) { return findByTag(selector) || fallback; },
    getElementsByTagName: function (tag) { var found = findByTag(tag); return found ? [found] : [fallback]; },
    addEventListener: function () {},
    removeEventListener: function () {}
  };

  var documentProxy = new Proxy(function () {}, {
    get: function (_target, property) {
      if (typeof property !== 'string') {
        if (property === Symbol.toPrimitive) return function () { return '[object HTMLDocument]'; };
        return undefined;
      }
      if (Object.prototype.hasOwnProperty.call(documentMethods, property)) return documentMethods[property];
      if (property === 'documentElement') return documentElement.proxy;
      if (property === 'body') return body.proxy;
      if (property === 'head') return head.proxy;
      if (property === 'readyState') return 'complete';
      if (property === 'visibilityState') return 'visible';
      if (property === 'hidden') return false;
      if (property === 'then') return undefined;
      return fallback[property];
    },
    set: function () { return true; },
    apply: function () { return fallback; },
    construct: function () { return fallback; }
  });

  function getComputedStyle(element) {
    var node = nodeOf(element);
    if (!node) return fallback;
    return new Proxy({}, {
      get: function (_target, property) {
        if (typeof property !== 'string') return undefined;
        var name = kebab(property);
        if (property === 'getPropertyValue') return function (other) { return getComputedStyle(element)[kebab(other)]; };
        if (name === 'width' || name === 'height') {
          if (!isRendered(node)) return node.style[name] || 'auto';
          var borderBox = String(node.style['box-sizing'] || '').toLowerCase() === 'border-box';
          var box = name === 'width' ? widthBox(node) : heightBox(node);
          var size = name === 'width'
            ? box.contentWidth + (borderBox ? box.paddingX + box.borderX : 0)
            : box.contentHeight + (borderBox ? box.paddingY + box.borderY : 0);
          return size + 'px';
        }
        if (name === 'display') return displayOf(node);
        if (name === 'position') return positionOf(node);
        if (name === 'font-size') return fontSizeOf(node) + 'px';
        return node.style[name] || '';
      }
    });
  }

  return { document: documentProxy, getComputedStyle: getComputedStyle };
}

export function isAllowedEmbedUrl(rawUrl, provider) {
  if (provider !== 'fsvid' && provider !== 'vidzy') return false;

  try {
    const parsed = new URL(String(rawUrl || '').trim());
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      (!parsed.port || parsed.port === '443') &&
      Boolean(parsed.hostname) &&
      /\/embed(?:[-/])/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

export function normalizeProviderMediaUrl(rawCandidate, embedUrl, provider) {
  if (!isAllowedEmbedUrl(embedUrl, provider)) return null;

  const candidate = String(rawCandidate || '')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .trim()
    .replace(/\\+$/, '');
  if (
    !candidate ||
    candidate.length > MAX_MEDIA_URL_LENGTH ||
    !candidate.toLowerCase().includes('.m3u8') ||
    candidate.toLowerCase().includes('troll')
  ) {
    return null;
  }

  try {
    const parsed = /^https:\/\//i.test(candidate)
      ? new URL(candidate)
      : new URL(candidate, embedUrl);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      (parsed.port && parsed.port !== '443') ||
      !parsed.hostname ||
      !parsed.pathname.toLowerCase().includes('.m3u8') ||
      parsed.href.length > MAX_MEDIA_URL_LENGTH
    ) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

export function selectInlineScripts(html) {
  if (typeof html !== 'string' || html.length > MAX_HTML_LENGTH) return [];

  const scripts = [];
  let totalLength = 0;
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(pattern)) {
    const attributes = match[1] || '';
    const source = (match[2] || '').trim();
    if (
      !source ||
      source.length > MAX_SCRIPT_LENGTH ||
      /\bsrc\s*=/i.test(attributes) ||
      /\btype\s*=\s*["'](?:application\/json|application\/ld\+json|module)["']/i.test(
        attributes,
      )
    ) {
      continue;
    }
    const lowered = source.toLowerCase();
    if (!PLAYER_SIGNALS.some(signal => lowered.includes(signal))) continue;
    if (scripts.length >= MAX_SCRIPT_COUNT) break;
    if (totalLength + source.length > MAX_TOTAL_SCRIPT_LENGTH) break;
    scripts.push(source);
    totalLength += source.length;
  }
  return scripts;
}

function getExtensionRuntime() {
  return globalThis.chrome?.runtime || globalThis.browser?.runtime || null;
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function downloadVerifiedWasm() {
  const response = await fetch(WASM_CDN_URL, {
    cache: 'force-cache',
    credentials: 'omit',
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`quickjs_wasm_http_${response.status}`);

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_WASM_BYTES) throw new Error('quickjs_wasm_too_large');

  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > MAX_WASM_BYTES) {
    throw new Error('quickjs_wasm_invalid_size');
  }

  const digest = await crypto.subtle.digest('SHA-256', buffer);
  if (bytesToHex(new Uint8Array(digest)) !== WASM_SHA256) {
    throw new Error('quickjs_wasm_hash_mismatch');
  }
  return new Uint8Array(buffer);
}

async function getQuickJsModule() {
  if (!quickJsModulePromise) {
    const extensionRuntime = getExtensionRuntime();
    quickJsModulePromise = (async () => {
      // Node-based source tests keep using the package's local WASM. Real
      // extension runtimes download the immutable, hash-pinned CDN asset.
      const variant = extensionRuntime
        ? newVariant(RELEASE_SYNC, {
            wasmBinary: await downloadVerifiedWasm(),
            wasmLocation: WASM_CDN_URL,
            log: () => {},
          })
        : RELEASE_SYNC;
      return newQuickJSWASMModuleFromVariant(variant);
    })().catch(error => {
      quickJsModulePromise = undefined;
      throw error;
    });
  }
  return quickJsModulePromise;
}

export function createBootstrap(embedUrl) {
  const urlObj = new URL(embedUrl);
  const safeEmbedUrl = JSON.stringify(embedUrl);
  const safeEmbedOrigin = JSON.stringify(urlObj.origin);
  const safeEmbedHostname = JSON.stringify(urlObj.hostname);
  const safeEmbedHost = JSON.stringify(urlObj.host);
  const safeEmbedPathname = JSON.stringify(urlObj.pathname || '');
  const safeEmbedSearch = JSON.stringify(urlObj.search || '');
  const safeEmbedHash = JSON.stringify(urlObj.hash || '');
  const safeEmbedPort = JSON.stringify(urlObj.port || '');
  return `
    'use strict';
    var __movixCandidates = [];
    var __movixMaxCandidates = 64;
    var __movixMaxString = ${MAX_MEDIA_URL_LENGTH};
    var __movixSeen = new WeakSet();
    function __movixCapture(value, depth) {
      depth = depth || 0;
      if (depth > 6 || value == null || __movixCandidates.length >= __movixMaxCandidates) return;
      if (typeof value === 'string') {
        if (value.length <= __movixMaxString && value.toLowerCase().indexOf('.m3u8') !== -1) {
          __movixCandidates.push(value);
        }
        return;
      }
      if ((typeof value !== 'object' && typeof value !== 'function') || __movixSeen.has(value)) return;
      __movixSeen.add(value);
      var keys;
      try { keys = Object.keys(value); } catch (_) { return; }
      for (var j = 0; j < keys.length && j < 64; j++) {
        try { __movixCapture(value[keys[j]], depth + 1); } catch (_) {}
      }
    }
    function atob(input) {
      var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      var value = String(input).replace(/[\\t\\n\\f\\r ]/g, '').replace(/-/g, '+').replace(/_/g, '/');
      if (value.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(value)) throw new TypeError('Invalid base64');
      value = value.replace(/=+$/, '');
      var output = '';
      var buffer = 0;
      var bits = 0;
      for (var i = 0; i < value.length; i++) {
        var index = chars.indexOf(value.charAt(i));
        if (index < 0) throw new TypeError('Invalid base64');
        buffer = (buffer << 6) | index;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          output += String.fromCharCode((buffer >> bits) & 255);
        }
      }
      return output;
    }
    function btoa(input) {
      var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      var value = String(input);
      var output = '';
      for (var i = 0; i < value.length; i += 3) {
        var a = value.charCodeAt(i);
        var b = value.charCodeAt(i + 1);
        var c = value.charCodeAt(i + 2);
        if (a > 255 || b > 255 || c > 255) throw new TypeError('Invalid character');
        output += chars.charAt(a >> 2);
        output += chars.charAt(((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4));
        output += isNaN(b) ? '=' : chars.charAt(((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6));
        output += isNaN(c) ? '=' : chars.charAt(c & 63);
      }
      return output;
    }
    var __movixChainTarget = function () {};
    var __movixChain = new Proxy(__movixChainTarget, {
      apply: function (_target, _thisArg, args) {
        for (var i = 0; i < args.length; i++) __movixCapture(args[i], 0);
        return __movixChain;
      },
      construct: function (_target, args) {
        for (var i = 0; i < args.length; i++) __movixCapture(arguments[i], 0);
        return __movixChain;
      },
      get: function (_target, property) {
        if (property === 'then') return undefined;
        if (property === Symbol.toPrimitive) return function () { return ''; };
        return __movixChain;
      },
      set: function () { return true; }
    });
    function __movixPlayerFactory() {
      for (var i = 0; i < arguments.length; i++) __movixCapture(arguments[i], 0);
      return __movixChain;
    }
    __movixPlayerFactory.addLanguage = __movixPlayerFactory;
    __movixPlayerFactory.getPlayers = function () { return {}; };
    var __movixLooseObject = new Proxy(function () {}, {
      apply: function () { return __movixLooseObject; },
      construct: function () { return __movixLooseObject; },
      get: function (_target, property) {
        if (property === 'canPlayType') return function (type) { return type && (type.indexOf('hls') !== -1 || type.indexOf('mpegURL') !== -1 || type.indexOf('mp4') !== -1) ? 'probably' : 'maybe'; };
        if (property === 'getAttribute') return function (attr) { return attr === 'src' ? '' : 'true'; };
        if (property === 'hasAttribute') return function () { return true; };
        if (property === 'referrer') return ${safeEmbedOrigin};
        if (/^(?:offset|client|scroll)(?:Width|Height|Left|Top)$/.test(property)) return 0;
        if (property === 'then') return undefined;
        if (property === Symbol.toPrimitive) return function () { return ''; };
        return __movixLooseObject;
      },
      set: function () { return true; }
    });
    // Les lecteurs dérivent leur clé de la largeur d'éléments qu'ils créent :
    // un mini-DOM calcule ces mesures comme le ferait un navigateur.
    var __movixDom = (${movixCreateDomEmulator.toString()})(__movixLooseObject, ${VIEWPORT_WIDTH}, ${VIEWPORT_HEIGHT});
    var getComputedStyle = __movixDom.getComputedStyle;
    var innerWidth = ${VIEWPORT_WIDTH};
    var innerHeight = ${VIEWPORT_HEIGHT};
    var outerWidth = ${VIEWPORT_WIDTH};
    var outerHeight = ${VIEWPORT_HEIGHT};
    var devicePixelRatio = 1;
    var screen = { width: ${VIEWPORT_WIDTH}, height: ${VIEWPORT_HEIGHT}, availWidth: ${VIEWPORT_WIDTH}, availHeight: ${VIEWPORT_HEIGHT}, colorDepth: 24, pixelDepth: 24 };
    var console = { log: function(){}, info: function(){}, warn: function(){}, error: function(){}, debug: function(){} };
    var location = {
      href: ${safeEmbedUrl},
      origin: ${safeEmbedOrigin},
      hostname: ${safeEmbedHostname},
      host: ${safeEmbedHost},
      pathname: ${safeEmbedPathname},
      search: ${safeEmbedSearch},
      hash: ${safeEmbedHash},
      port: ${safeEmbedPort},
      ancestorOrigins: [${safeEmbedOrigin}],
      protocol: 'https:'
    };
    var navigator = { userAgent: 'Mozilla/5.0 Chrome/140.0.0.0', language: 'fr-FR' };
    var document = __movixDom.document;
    var videojs = __movixPlayerFactory;
    var player = __movixPlayerFactory;
    var jwplayer = __movixPlayerFactory;
    var fluidPlayer = __movixPlayerFactory;
    var Playerjs = __movixPlayerFactory;
    var Clappr = { Player: __movixPlayerFactory };
    function setTimeout(callback) { if (typeof callback === 'function') callback(); return 1; }
    function clearTimeout() {}
    function setInterval() { return 0; }
    function clearInterval() {}
    function requestAnimationFrame() { return 0; }
    function cancelAnimationFrame() {}
    function addEventListener() {}
    var fetch = undefined;
    var XMLHttpRequest = undefined;
    var WebSocket = undefined;
    var EventSource = undefined;
    var Worker = undefined;
    var SharedWorker = undefined;
    var window = globalThis;
    var self = globalThis;
  `;
}

function disposeResult(result) {
  try {
    if (result?.error) result.error.dispose();
    else result?.value?.dispose();
  } catch {
    // The runtime is disposed immediately afterwards.
  }
}

export async function extractPlayerM3u8(html, embedUrl, provider) {
  if (!isAllowedEmbedUrl(embedUrl, provider)) return null;
  const scripts = selectInlineScripts(html);
  if (!scripts.length) return null;

  let QuickJS;
  try {
    QuickJS = await getQuickJsModule();
  } catch (error) {
    console.warn('[MovixQuickJS] runtime unavailable:', error?.message || error);
    return null;
  }

  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
  runtime.setMaxStackSize(STACK_LIMIT_BYTES);
  const deadline = Date.now() + EXECUTION_TIMEOUT_MS;
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
  const context = runtime.newContext();

  try {
    const bootstrapResult = context.evalCode(createBootstrap(embedUrl), 'movix-bootstrap.js');
    if (bootstrapResult.error) {
      disposeResult(bootstrapResult);
      return null;
    }
    disposeResult(bootstrapResult);

    for (let index = 0; index < scripts.length; index++) {
      const result = context.evalCode(scripts[index], `player-script-${index + 1}.js`);
      disposeResult(result);
      if (Date.now() > deadline) break;
    }

    const captureResult = context.evalCode(`
      (function () {
        var names = ['sources', 'source', 'file', 'hls', 'hlsUrl', 'm3u8', 'config', 'playerConfig'];
        for (var i = 0; i < names.length; i++) {
          try { __movixCapture(globalThis[names[i]]); } catch (_) {}
        }
        return JSON.stringify(__movixCandidates);
      })()
    `, 'movix-result.js');
    if (captureResult.error) {
      disposeResult(captureResult);
      return null;
    }
    const dumped = context.dump(captureResult.value);
    disposeResult(captureResult);
    const candidates = JSON.parse(String(dumped || '[]'));
    for (const candidate of candidates) {
      const normalized = normalizeProviderMediaUrl(candidate, embedUrl, provider);
      if (normalized) return normalized;
    }
    return null;
  } catch {
    return null;
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

globalThis.MovixQuickJS = Object.freeze({ extractPlayerM3u8 });
