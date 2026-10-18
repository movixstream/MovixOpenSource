"""One-shot QuickJS worker. It must never import application code."""

from __future__ import annotations

import json
import sys
from urllib.parse import urlsplit

MAX_REQUEST_BYTES = 800 * 1024
MAX_RESPONSE_BYTES = 128 * 1024
MEMORY_LIMIT_BYTES = 16 * 1024 * 1024
STACK_LIMIT_BYTES = 512 * 1024
TIME_LIMIT_SECONDS = 0.75
# Bornes du « tour de boucle » simulé après les scripts : microtâches
# (promesses) et minuteries mises en file. Un script qui se relance sans fin
# s'arrête ici au lieu de consommer tout le budget de temps.
MAX_PENDING_JOBS = 2048
MAX_SETTLE_ROUNDS = 32


BOOTSTRAP = r"""
(() => {
  'use strict';
  const candidates = [];
  const seen = new WeakSet();
  const nativeEval = eval;

  function capture(value, depth) {
    if (candidates.length >= 16 || depth > 5 || value == null) return;
    if (typeof value === 'string') {
      const lowered = value.toLowerCase();
      // Le leurre `troll` n'est jamais un candidat : on ne le laisse pas
      // occuper une des 16 places réservées aux vraies URL.
      if (value.length <= 16384 && lowered.includes('.m3u8') && !lowered.includes('troll')) {
        candidates.push(value);
      }
      return;
    }
    if ((typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return;
    seen.add(value);
    let keys = [];
    try { keys = Object.keys(value).slice(0, 64); } catch (_) { return; }
    for (const key of keys) {
      try { capture(value[key], depth + 1); } catch (_) {}
    }
  }

  // Extrait les URL m3u8 d'un fragment HTML (innerHTML, document.write) au
  // lieu de remonter tout le balisage comme candidat.
  function captureMarkup(markup) {
    const text = String(markup);
    if (text.length > 262144) return;
    for (const match of text.matchAll(/https?:\/\/[^\s"'<>`]+?\.m3u8[^\s"'<>`]*/gi)) {
      capture(match[0], 0);
    }
  }

  const chainTarget = function () {};
  const chain = new Proxy(chainTarget, {
    apply(_target, _thisArg, args) {
      for (const arg of args) capture(arg, 0);
      return chain;
    },
    construct(_target, args) {
      for (const arg of args) capture(arg, 0);
      return chain;
    },
    get(_target, property) {
      if (property === 'then') return undefined;
      if (property === Symbol.toPrimitive) return () => '';
      return chain;
    },
    set() { return true; },
  });

  function playerFactory(...args) {
    for (const arg of args) capture(arg, 0);
    return chain;
  }
  playerFactory.addLanguage = function (...args) {
    for (const arg of args) capture(arg, 0);
  };
  playerFactory.getPlayers = () => ({});

  function decodeBase64(input) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const clean = String(input).replace(/[\t\n\f\r ]/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (clean.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(clean)) throw new Error('InvalidCharacterError');
    let output = '';
    let bits = 0;
    let bitCount = 0;
    for (let index = 0; index < clean.length; index++) {
      const character = clean[index];
      if (character === '=') break;
      const value = alphabet.indexOf(character);
      if (value < 0) throw new Error('InvalidCharacterError');
      bits = (bits << 6) | value;
      bitCount += 6;
      if (bitCount >= 8) {
        bitCount -= 8;
        output += String.fromCharCode((bits >> bitCount) & 255);
      }
    }
    return output;
  }

  function encodeBase64(input) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const text = String(input);
    let output = '';
    for (let index = 0; index < text.length; index += 3) {
      const a = text.charCodeAt(index);
      const b = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
      const c = index + 2 < text.length ? text.charCodeAt(index + 2) : 0;
      if (a > 255 || b > 255 || c > 255) throw new Error('InvalidCharacterError');
      const triplet = (a << 16) | (b << 8) | c;
      output += alphabet[(triplet >> 18) & 63];
      output += alphabet[(triplet >> 12) & 63];
      output += index + 1 < text.length ? alphabet[(triplet >> 6) & 63] : '=';
      output += index + 2 < text.length ? alphabet[triplet & 63] : '=';
    }
    return output;
  }

  // -------------------------------------------------------------------
  // Mini DOM avec une vraie (petite) mise en page.
  //
  // Les lecteurs Fsvid/Vidzy dérivent leur clé XOR d'une mesure CSS : un
  // enfant à `width:50%` dans un parent en `calc(1in + 60px)`, attaché au
  // body, puis lu par `offsetWidth`. Plutôt que de deviner cette formule
  // précise, on calcule les largeurs comme Chrome (unités, calc(), %,
  // padding, bordures, box-sizing, display:none, éléments détachés) pour
  // survivre aux prochaines variantes de l'obfuscation.
  // -------------------------------------------------------------------
  const VIEWPORT_WIDTH = 1280;
  const VIEWPORT_HEIGHT = 720;
  const DEFAULT_FONT_SIZE = 16;
  const BOX_SIDES = ['top', 'right', 'bottom', 'left'];
  const BORDER_STYLES = new Set([
    'none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset',
  ]);
  const HIDDEN_TAGS = new Set(['HEAD', 'SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'TEMPLATE', 'NOSCRIPT', 'BASE']);
  const INLINE_TAGS = new Set([
    'SPAN', 'A', 'B', 'I', 'EM', 'STRONG', 'SMALL', 'LABEL', 'CODE', 'SUB', 'SUP', 'U', 'S',
    'ABBR', 'CITE', 'Q', 'MARK', 'BR', 'FONT', 'TIME',
  ]);
  const INLINE_BLOCK_TAGS = new Set([
    'IMG', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT', 'SVG',
  ]);
  // Éléments remplacés : 300 × 150 par défaut, comme dans Chrome.
  const REPLACED_TAGS = new Set(['VIDEO', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT']);
  const BLOCK_DISPLAYS = new Set(['block', 'flex', 'grid', 'list-item', 'flow-root']);
  const ABSOLUTE_UNITS = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, pt: 96 / 72, pc: 16 };
  const FONT_KEYWORDS = new Map([
    ['xx-small', 9], ['x-small', 10], ['small', 13], ['medium', 16],
    ['large', 18], ['x-large', 24], ['xx-large', 32], ['xxx-large', 48],
  ]);

  function splitTopLevel(text, separator) {
    const parts = [];
    let depth = 0;
    let quote = '';
    let current = '';
    for (const character of String(text)) {
      if (quote) {
        current += character;
        if (character === quote) quote = '';
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        current += character;
        continue;
      }
      if (character === '(') depth++;
      else if (character === ')') depth = Math.max(0, depth - 1);
      const isSeparator = separator === ' ' ? /\s/.test(character) : character === separator;
      if (depth === 0 && isSeparator) {
        parts.push(current);
        current = '';
        continue;
      }
      current += character;
    }
    parts.push(current);
    return parts.map((part) => part.trim()).filter(Boolean);
  }

  function toKebab(name) {
    if (name === 'cssFloat') return 'float';
    if (name.startsWith('--')) return name;
    return name.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase()).replace(/^(webkit|moz|ms)-/, '-$1-');
  }

  function expandSides(value) {
    const parts = splitTopLevel(value, ' ');
    const top = parts[0] || '';
    const right = parts.length > 1 ? parts[1] : top;
    const bottom = parts.length > 2 ? parts[2] : top;
    const left = parts.length > 3 ? parts[3] : right;
    return [top, right, bottom, left];
  }

  function parseBorder(value) {
    let width = '';
    let style = '';
    for (const token of splitTopLevel(value, ' ')) {
      const lowered = token.toLowerCase();
      if (BORDER_STYLES.has(lowered)) style = lowered;
      else if (/^(thin|medium|thick)$/.test(lowered) || /^[-+.\d]|^(calc|min|max|clamp)\(/.test(lowered)) width = lowered;
    }
    return { width, style };
  }

  class StyleDeclaration {
    constructor() {
      this.__props = new Map();
    }
    __assign(name, value) {
      const property = String(name).trim().toLowerCase();
      if (!property) return;
      const text = value == null ? '' : String(value).trim().replace(/\s*!important\s*$/i, '');
      if (property === 'padding' || property === 'margin') {
        expandSides(text).forEach((side, index) => this.__assign(property + '-' + BOX_SIDES[index], side));
        return;
      }
      if (property === 'border-width' || property === 'border-style') {
        const kind = property.slice(7);
        expandSides(text).forEach((side, index) => this.__assign('border-' + BOX_SIDES[index] + '-' + kind, side));
        return;
      }
      if (property === 'border' || /^border-(top|right|bottom|left)$/.test(property)) {
        const sides = property === 'border' ? BOX_SIDES : [property.slice(7)];
        const parsed = parseBorder(text);
        for (const side of sides) {
          if (!text) {
            this.__props.delete('border-' + side + '-width');
            this.__props.delete('border-' + side + '-style');
            continue;
          }
          this.__props.set('border-' + side + '-width', parsed.width || 'medium');
          this.__props.set('border-' + side + '-style', parsed.style || 'none');
        }
        return;
      }
      if (!text) this.__props.delete(property);
      else this.__props.set(property, text);
    }
    get cssText() {
      return [...this.__props].map(([key, value]) => key + ': ' + value + ';').join(' ');
    }
    set cssText(value) {
      this.__props.clear();
      for (const declaration of splitTopLevel(value == null ? '' : value, ';')) {
        const colon = declaration.indexOf(':');
        if (colon > 0) this.__assign(declaration.slice(0, colon), declaration.slice(colon + 1));
      }
    }
    get length() { return this.__props.size; }
    item(index) { return [...this.__props.keys()][index] || ''; }
    getPropertyValue(name) { return this.__props.get(String(name).trim().toLowerCase()) || ''; }
    getPropertyPriority() { return ''; }
    setProperty(name, value) { this.__assign(name, value); }
    removeProperty(name) {
      const previous = this.getPropertyValue(name);
      this.__assign(name, '');
      return previous;
    }
  }

  function styleProxy(declaration) {
    return new Proxy(declaration, {
      get(target, property) {
        if (typeof property !== 'string') return target[property];
        if (property in target) {
          const value = target[property];
          return typeof value === 'function' ? value.bind(target) : value;
        }
        if (/^\d+$/.test(property)) return target.item(Number(property));
        return target.__props.get(toKebab(property)) || '';
      },
      set(target, property, value) {
        if (typeof property !== 'string') return true;
        if (property === 'cssText') target.cssText = value;
        else target.__assign(toKebab(property), value);
        return true;
      },
      has(target, property) {
        return typeof property === 'string';
      },
    });
  }

  class FakeEvent {
    constructor(type, init) {
      this.type = String(type == null ? '' : type);
      this.bubbles = !!(init && init.bubbles);
      this.cancelable = !!(init && init.cancelable);
      this.detail = init ? init.detail : undefined;
      this.defaultPrevented = false;
      this.target = null;
      this.currentTarget = null;
      this.timeStamp = 0;
    }
    initEvent(type, bubbles, cancelable) {
      this.type = String(type);
      this.bubbles = !!bubbles;
      this.cancelable = !!cancelable;
    }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() {}
    stopImmediatePropagation() {}
  }
  class FakeCustomEvent extends FakeEvent {}

  const listenerStore = new WeakMap();
  function listenersOf(target, type) {
    let byType = listenerStore.get(target);
    if (!byType) {
      byType = new Map();
      listenerStore.set(target, byType);
    }
    if (!byType.has(type)) byType.set(type, []);
    return byType.get(type);
  }
  const eventTargetMethods = {
    addEventListener(type, listener) {
      if (typeof listener !== 'function' && !(listener && typeof listener.handleEvent === 'function')) return;
      const list = listenersOf(this, String(type));
      if (!list.includes(listener)) list.push(listener);
    },
    removeEventListener(type, listener) {
      const list = listenersOf(this, String(type));
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    },
    dispatchEvent(event) {
      const type = event && event.type ? String(event.type) : '';
      try { event.target = event.target || this; event.currentTarget = this; } catch (_) {}
      for (const listener of listenersOf(this, type).slice()) {
        try {
          if (typeof listener === 'function') listener.call(this, event);
          else listener.handleEvent(event);
        } catch (_) {}
      }
      const handler = this['on' + type];
      if (typeof handler === 'function') {
        try { handler.call(this, event); } catch (_) {}
      }
      return !(event && event.defaultPrevented);
    },
  };

  let documentNode = null;
  let rootElement = null;

  class FakeNode {
    constructor(nodeType, nodeName) {
      this.nodeType = nodeType;
      this.nodeName = nodeName;
      this.parentNode = null;
      this.childNodes = [];
    }
    get ownerDocument() { return this.nodeType === 9 ? null : documentNode; }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
    get nextSibling() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.childNodes;
      return siblings[siblings.indexOf(this) + 1] || null;
    }
    get previousSibling() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.childNodes;
      return siblings[siblings.indexOf(this) - 1] || null;
    }
    get isConnected() {
      for (let node = this; node; node = node.parentNode) {
        if (node === documentNode) return true;
      }
      return false;
    }
    get textContent() {
      return this.childNodes.map((node) => (node.nodeType === 8 ? '' : node.textContent)).join('');
    }
    set textContent(value) {
      for (const child of this.childNodes.slice()) this.removeChild(child);
      if (value != null && String(value) !== '') this.appendChild(new FakeText(value));
    }
    hasChildNodes() { return this.childNodes.length > 0; }
    appendChild(child) { return this.insertBefore(child, null); }
    insertBefore(child, reference) {
      if (!(child instanceof FakeNode)) throw new TypeError("Failed to execute 'insertBefore': parameter 1 is not of type 'Node'.");
      if (child.nodeType === 11) {
        for (const node of child.childNodes.slice()) this.insertBefore(node, reference);
        return child;
      }
      for (let node = this; node; node = node.parentNode) {
        if (node === child) throw new Error('HierarchyRequestError');
      }
      if (child.parentNode) child.parentNode.removeChild(child);
      const index = reference ? this.childNodes.indexOf(reference) : -1;
      if (index < 0) this.childNodes.push(child);
      else this.childNodes.splice(index, 0, child);
      child.parentNode = this;
      return child;
    }
    removeChild(child) {
      const index = this.childNodes.indexOf(child);
      if (index < 0) throw new Error('NotFoundError');
      this.childNodes.splice(index, 1);
      child.parentNode = null;
      return child;
    }
    replaceChild(newChild, oldChild) {
      this.insertBefore(newChild, oldChild);
      return this.removeChild(oldChild);
    }
    append(...nodes) {
      for (const node of nodes) this.appendChild(node instanceof FakeNode ? node : new FakeText(node));
    }
    prepend(...nodes) {
      const reference = this.firstChild;
      for (const node of nodes) this.insertBefore(node instanceof FakeNode ? node : new FakeText(node), reference);
    }
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    }
    contains(node) {
      for (let current = node; current; current = current.parentNode) {
        if (current === this) return true;
      }
      return false;
    }
    cloneNode(deep) {
      const copy = new FakeNode(this.nodeType, this.nodeName);
      if (deep) for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
      return copy;
    }
    getRootNode() {
      let node = this;
      while (node.parentNode) node = node.parentNode;
      return node;
    }
  }
  Object.assign(FakeNode.prototype, eventTargetMethods);

  class FakeText extends FakeNode {
    constructor(data, nodeType) {
      super(nodeType || 3, nodeType === 8 ? '#comment' : '#text');
      this.data = String(data == null ? '' : data);
    }
    get textContent() { return this.data; }
    set textContent(value) { this.data = String(value); }
    get nodeValue() { return this.data; }
    set nodeValue(value) { this.data = String(value); }
    get length() { return this.data.length; }
    cloneNode() { return new FakeText(this.data, this.nodeType); }
  }

  function* descendants(node) {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      yield child;
      yield* descendants(child);
    }
  }

  function parseCompound(text) {
    const compound = { tag: '', id: '', classes: [], attrs: [], valid: true };
    const pattern = /(\*|[a-z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w:-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*)?\]|:{1,2}[\w-]+(?:\([^)]*\))?/iy;
    let index = 0;
    while (index < text.length) {
      pattern.lastIndex = index;
      const match = pattern.exec(text);
      if (!match || !match[0]) {
        compound.valid = false;
        break;
      }
      index = pattern.lastIndex;
      if (match[1]) {
        if (match[1] !== '*') compound.tag = match[1].toUpperCase();
      } else if (match[2]) compound.id = match[2];
      else if (match[3]) compound.classes.push(match[3]);
      else if (match[4]) compound.attrs.push([match[4].toLowerCase(), match[5] ?? match[6] ?? match[7]]);
    }
    return compound;
  }

  function compileSelector(selector) {
    return splitTopLevel(String(selector), ',').map((group) => (
      group.replace(/\s*[>+~]\s*/g, ' ').split(/\s+/).filter(Boolean).map(parseCompound)
    ));
  }

  function matchesCompound(element, compound) {
    if (!compound.valid || element.nodeType !== 1) return false;
    if (compound.tag && element.tagName !== compound.tag) return false;
    if (compound.id && element.id !== compound.id) return false;
    for (const name of compound.classes) {
      if (!element.classList.contains(name)) return false;
    }
    for (const [name, value] of compound.attrs) {
      if (!element.hasAttribute(name)) return false;
      if (value !== undefined && element.getAttribute(name) !== value) return false;
    }
    return true;
  }

  function matchesSelector(element, compiled) {
    return compiled.some((group) => {
      if (!group.length || !matchesCompound(element, group[group.length - 1])) return false;
      let index = group.length - 2;
      for (let node = element.parentNode; node && index >= 0; node = node.parentNode) {
        if (node.nodeType === 1 && matchesCompound(node, group[index])) index--;
      }
      return index < 0;
    });
  }

  function selectAll(root, selector, limit) {
    const compiled = compileSelector(selector);
    const found = [];
    for (const element of descendants(root)) {
      if (matchesSelector(element, compiled)) {
        found.push(element);
        if (found.length >= limit) break;
      }
    }
    return found;
  }

  function nodeList(items) {
    items.item = (index) => items[index] || null;
    return items;
  }

  class ClassList {
    constructor(element) { this.__element = element; }
    __tokens() { return (this.__element.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
    __write(tokens) { this.__element.setAttribute('class', tokens.join(' ')); }
    get length() { return this.__tokens().length; }
    get value() { return this.__tokens().join(' '); }
    item(index) { return this.__tokens()[index] || null; }
    contains(token) { return this.__tokens().includes(String(token)); }
    add(...tokens) {
      const current = this.__tokens();
      for (const token of tokens) if (!current.includes(String(token))) current.push(String(token));
      this.__write(current);
    }
    remove(...tokens) {
      const removed = tokens.map(String);
      this.__write(this.__tokens().filter((token) => !removed.includes(token)));
    }
    toggle(token, force) {
      const present = this.contains(token);
      const wanted = force === undefined ? !present : !!force;
      if (wanted && !present) this.add(token);
      if (!wanted && present) this.remove(token);
      return wanted;
    }
    replace(oldToken, newToken) {
      if (!this.contains(oldToken)) return false;
      this.__write(this.__tokens().map((token) => (token === String(oldToken) ? String(newToken) : token)));
      return true;
    }
    toString() { return this.value; }
  }

  class FakeElement extends FakeNode {
    constructor(tagName, namespaceURI) {
      const name = String(tagName == null ? 'div' : tagName);
      super(1, name.toUpperCase());
      this.tagName = this.nodeName;
      this.localName = name.toLowerCase();
      this.namespaceURI = namespaceURI || 'http://www.w3.org/1999/xhtml';
      this.__attributes = new Map();
      this.__declaration = new StyleDeclaration();
      this.__style = styleProxy(this.__declaration);
      this.classList = new ClassList(this);
      this.dataset = {};
      this.__markup = '';
      this.paused = true;
      this.muted = true;
      this.volume = 0;
      this.currentTime = 0;
      this.duration = NaN;
      this.readyState = 0;
    }
    get style() { return this.__style; }
    // `element.style = "…"` vaut `element.style.cssText = "…"` dans un navigateur.
    set style(value) { this.__declaration.cssText = value; }
    get children() { return nodeList(this.childNodes.filter((node) => node.nodeType === 1)); }
    get childElementCount() { return this.children.length; }
    get firstElementChild() { return this.children[0] || null; }
    get lastElementChild() { const items = this.children; return items[items.length - 1] || null; }
    get nextElementSibling() {
      for (let node = this.nextSibling; node; node = node.nextSibling) if (node.nodeType === 1) return node;
      return null;
    }
    get previousElementSibling() {
      for (let node = this.previousSibling; node; node = node.previousSibling) if (node.nodeType === 1) return node;
      return null;
    }
    get id() { return this.getAttribute('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get className() { return this.getAttribute('class') || ''; }
    set className(value) { this.setAttribute('class', value); }
    get src() { return this.getAttribute('src') || ''; }
    set src(value) { this.setAttribute('src', value); }
    get href() { return this.getAttribute('href') || ''; }
    set href(value) { this.setAttribute('href', value); }
    get hidden() { return this.hasAttribute('hidden'); }
    set hidden(value) {
      if (value) this.setAttribute('hidden', '');
      else this.removeAttribute('hidden');
    }
    get attributes() {
      const list = [...this.__attributes].map(([name, value]) => ({ name, value }));
      if (this.__declaration.length) list.push({ name: 'style', value: this.__declaration.cssText });
      return list;
    }
    setAttribute(name, value) {
      const key = String(name).toLowerCase();
      const text = String(value);
      if (key === 'style') {
        this.__declaration.cssText = text;
        return;
      }
      if (key === 'src' || key === 'href' || key.startsWith('data-')) capture(text, 0);
      if (key.startsWith('data-')) {
        const property = key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        this.dataset[property] = text;
      }
      this.__attributes.set(key, text);
    }
    getAttribute(name) {
      const key = String(name).toLowerCase();
      if (key === 'style') return this.__declaration.length ? this.__declaration.cssText : null;
      return this.__attributes.has(key) ? this.__attributes.get(key) : null;
    }
    hasAttribute(name) { return this.getAttribute(name) !== null; }
    removeAttribute(name) {
      const key = String(name).toLowerCase();
      if (key === 'style') this.__declaration.cssText = '';
      else this.__attributes.delete(key);
    }
    toggleAttribute(name, force) {
      const present = this.hasAttribute(name);
      const wanted = force === undefined ? !present : !!force;
      if (wanted && !present) this.setAttribute(name, '');
      if (!wanted && present) this.removeAttribute(name);
      return wanted;
    }
    getAttributeNames() { return this.attributes.map((attribute) => attribute.name); }
    get innerHTML() { return this.__markup || this.textContent; }
    set innerHTML(value) {
      for (const child of this.childNodes.slice()) this.removeChild(child);
      this.__markup = String(value == null ? '' : value);
      captureMarkup(this.__markup);
    }
    get outerHTML() { return '<' + this.localName + '>' + this.innerHTML + '</' + this.localName + '>'; }
    set outerHTML(value) { captureMarkup(value); }
    get innerText() { return this.textContent; }
    set innerText(value) { this.textContent = value; }
    insertAdjacentHTML(_position, markup) { captureMarkup(markup); }
    insertAdjacentElement(position, element) {
      const where = String(position).toLowerCase();
      if (where === 'beforebegin' && this.parentNode) return this.parentNode.insertBefore(element, this);
      if (where === 'afterend' && this.parentNode) return this.parentNode.insertBefore(element, this.nextSibling);
      if (where === 'afterbegin') return this.insertBefore(element, this.firstChild);
      if (where === 'beforeend') return this.appendChild(element);
      return null;
    }
    cloneNode(deep) {
      const copy = new FakeElement(this.localName, this.namespaceURI);
      for (const [name, value] of this.__attributes) copy.__attributes.set(name, value);
      copy.__declaration.cssText = this.__declaration.cssText;
      Object.assign(copy.dataset, this.dataset);
      if (deep) for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
      return copy;
    }
    querySelector(selector) { return selectAll(this, selector, 1)[0] || null; }
    querySelectorAll(selector) { return nodeList(selectAll(this, selector, 4096)); }
    getElementsByTagName(name) { return this.querySelectorAll(String(name) === '*' ? '*' : String(name)); }
    getElementsByClassName(names) {
      return this.querySelectorAll(String(names).split(/\s+/).filter(Boolean).map((name) => '.' + name).join(''));
    }
    matches(selector) { return matchesSelector(this, compileSelector(selector)); }
    closest(selector) {
      const compiled = compileSelector(selector);
      for (let node = this; node && node.nodeType === 1; node = node.parentNode) {
        if (matchesSelector(node, compiled)) return node;
      }
      return null;
    }

    // Mesures : arrondies comme les propriétés offset*/client* de Chrome.
    get offsetWidth() { return Math.round(widthBox(this).border); }
    get offsetHeight() { return Math.round(heightBox(this).border); }
    get clientWidth() {
      if (this === rootElement) return VIEWPORT_WIDTH;
      return displayOf(this) === 'inline' ? 0 : Math.round(widthBox(this).padding);
    }
    get clientHeight() {
      if (this === rootElement) return VIEWPORT_HEIGHT;
      return displayOf(this) === 'inline' ? 0 : Math.round(heightBox(this).padding);
    }
    get scrollWidth() { return this.clientWidth; }
    get scrollHeight() { return this.clientHeight; }
    get clientLeft() { return isRendered(this) ? Math.round(borderSide(this, 'left')) : 0; }
    get clientTop() { return isRendered(this) ? Math.round(borderSide(this, 'top')) : 0; }
    get offsetLeft() { return 0; }
    get offsetTop() { return 0; }
    get offsetParent() {
      if (!isRendered(this) || positionOf(this) === 'fixed') return null;
      for (let node = this.parentNode; node && node.nodeType === 1; node = node.parentNode) {
        if (node === documentNode.body || positionOf(node) !== 'static') return node;
      }
      return null;
    }
    getBoundingClientRect() {
      const width = widthBox(this).border;
      const height = heightBox(this).border;
      return { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON() { return this; } };
    }
    getClientRects() { return isRendered(this) ? [this.getBoundingClientRect()] : []; }

    focus() {}
    blur() {}
    click() { this.dispatchEvent(new FakeEvent('click', { bubbles: true })); }
    scrollIntoView() {}
    scrollTo() {}
    scroll() {}
    requestFullscreen() { return Promise.resolve(); }
    setPointerCapture() {}
    releasePointerCapture() {}
    attachShadow() {
      const shadow = new FakeNode(11, '#document-fragment');
      shadow.host = this;
      return shadow;
    }
    animate() { return { finished: Promise.resolve(), cancel() {}, play() {}, pause() {} }; }
    getContext() { return null; }
    toDataURL() { return 'data:,'; }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    load() {}
    canPlayType() { return 'maybe'; }
    addTextTrack() { return { mode: 'disabled', cues: [], addCue() {}, removeCue() {} }; }
  }

  function styleOf(element, property) {
    const declared = element.__declaration ? element.__declaration.__props.get(property) : undefined;
    if (declared !== undefined && !/^(inherit|initial|unset|revert)$/i.test(declared)) return declared;
    if (property === 'display') {
      if (element.hasAttribute && element.hasAttribute('hidden')) return 'none';
      if (HIDDEN_TAGS.has(element.tagName)) return 'none';
      if (INLINE_TAGS.has(element.tagName)) return 'inline';
      if (INLINE_BLOCK_TAGS.has(element.tagName)) return 'inline-block';
      return 'block';
    }
    // Marge par défaut du body dans tous les navigateurs.
    if (/^margin-/.test(property) && element.tagName === 'BODY') return '8px';
    return '';
  }

  function displayOf(element) { return String(styleOf(element, 'display')).trim().toLowerCase() || 'block'; }
  function positionOf(element) { return String(styleOf(element, 'position') || 'static').trim().toLowerCase(); }

  // Un élément détaché du document (ou sous un display:none) ne génère
  // aucune boîte : ses mesures valent 0, exactement comme dans Chrome.
  function isRendered(element) {
    for (let node = element; node; node = node.parentNode) {
      if (node === documentNode) return true;
      if (node.nodeType === 1 && displayOf(node) === 'none') return false;
    }
    return false;
  }

  function rootFontSize() {
    if (!rootElement) return DEFAULT_FONT_SIZE;
    const raw = styleOf(rootElement, 'font-size');
    if (!raw) return DEFAULT_FONT_SIZE;
    const keyword = FONT_KEYWORDS.get(raw.toLowerCase());
    if (keyword) return keyword;
    const value = resolveLength(raw, { base: DEFAULT_FONT_SIZE, fontSize: DEFAULT_FONT_SIZE, root: DEFAULT_FONT_SIZE });
    return value == null || value <= 0 ? DEFAULT_FONT_SIZE : value;
  }

  function fontSizeOf(element) {
    if (!element || element.nodeType !== 1) return DEFAULT_FONT_SIZE;
    if (element === rootElement) return rootFontSize();
    const inherited = fontSizeOf(element.parentNode);
    const raw = styleOf(element, 'font-size');
    if (!raw) return inherited;
    const keyword = FONT_KEYWORDS.get(raw.toLowerCase());
    if (keyword) return keyword;
    const value = resolveLength(raw, { base: inherited, fontSize: inherited });
    return value == null || value < 0 ? inherited : value;
  }

  function tokenizeLength(text) {
    const tokens = [];
    const pattern = /\s*(?:([a-z][a-z-]*)\(|(\d*\.?\d+(?:e[+-]?\d+)?)(%|[a-z]+)?|([-+*/(),]))/y;
    let index = 0;
    while (index < text.length) {
      if (!text.slice(index).trim()) break;
      pattern.lastIndex = index;
      const match = pattern.exec(text);
      if (!match) return null;
      index = pattern.lastIndex;
      if (match[1]) tokens.push({ type: 'func', value: match[1] });
      else if (match[2] !== undefined) tokens.push({ type: 'number', value: parseFloat(match[2]), unit: match[3] || '' });
      else tokens.push({ type: 'op', value: match[4] });
    }
    return tokens;
  }

  // Évalue une longueur CSS (unités absolues, em/rem, vw/vh, %, calc(),
  // min(), max(), clamp()). Renvoie des px, ou null pour « auto »/invalide.
  function resolveLength(raw, context) {
    if (raw == null) return null;
    const text = String(raw).trim().toLowerCase();
    if (!text || /^(auto|none|normal|fit-content|max-content|min-content|stretch|-webkit-fill-available)$/.test(text)) return null;
    const tokens = tokenizeLength(text);
    if (!tokens || !tokens.length) return null;
    let position = 0;
    const peek = () => tokens[position];
    const next = () => tokens[position++];
    const fail = () => { throw new Error('invalid_length'); };

    function unitScale(unit) {
      if (!unit) return 1;
      if (Object.prototype.hasOwnProperty.call(ABSOLUTE_UNITS, unit)) return ABSOLUTE_UNITS[unit];
      switch (unit) {
        case '%': return context.base == null ? fail() : context.base / 100;
        case 'em': return context.fontSize;
        case 'rem': return context.root || rootFontSize();
        case 'ex':
        case 'ch': return context.fontSize / 2;
        case 'vw': case 'svw': case 'lvw': case 'dvw': return VIEWPORT_WIDTH / 100;
        case 'vh': case 'svh': case 'lvh': case 'dvh': return VIEWPORT_HEIGHT / 100;
        case 'vmin': return Math.min(VIEWPORT_WIDTH, VIEWPORT_HEIGHT) / 100;
        case 'vmax': return Math.max(VIEWPORT_WIDTH, VIEWPORT_HEIGHT) / 100;
        default: return fail();
      }
    }
    function expect(value) {
      const token = next();
      if (!token || token.value !== value) fail();
    }
    function primary() {
      const token = next();
      if (!token) fail();
      if (token.type === 'number') return { value: token.value * unitScale(token.unit), unitless: !token.unit };
      if (token.type === 'op' && token.value === '(') {
        const inner = sum();
        expect(')');
        return inner;
      }
      if (token.type === 'op' && token.value === '-') {
        const inner = primary();
        return { value: -inner.value, unitless: inner.unitless };
      }
      if (token.type === 'op' && token.value === '+') return primary();
      if (token.type === 'func') {
        const args = [sum()];
        while (peek() && peek().value === ',') {
          next();
          args.push(sum());
        }
        expect(')');
        const values = args.map((arg) => arg.value);
        const unitless = args.every((arg) => arg.unitless);
        switch (token.value) {
          case 'calc': return args.length === 1 ? args[0] : fail();
          case 'min': return { value: Math.min(...values), unitless };
          case 'max': return { value: Math.max(...values), unitless };
          case 'clamp':
            return args.length === 3 ? { value: Math.max(values[0], Math.min(values[1], values[2])), unitless } : fail();
          default: return fail();
        }
      }
      return fail();
    }
    function product() {
      let left = primary();
      while (peek() && (peek().value === '*' || peek().value === '/')) {
        const operator = next().value;
        const right = primary();
        if (operator === '*') {
          if (!left.unitless && !right.unitless) fail();
          left = { value: left.value * right.value, unitless: left.unitless && right.unitless };
        } else {
          if (!right.unitless || right.value === 0) fail();
          left = { value: left.value / right.value, unitless: left.unitless };
        }
      }
      return left;
    }
    function sum() {
      let left = product();
      while (peek() && (peek().value === '+' || peek().value === '-')) {
        const operator = next().value;
        const right = product();
        left = {
          value: operator === '+' ? left.value + right.value : left.value - right.value,
          unitless: left.unitless && right.unitless,
        };
      }
      return left;
    }
    try {
      const result = sum();
      if (position !== tokens.length) return null;
      if (result.unitless && result.value !== 0) return null;
      return Number.isFinite(result.value) ? result.value : null;
    } catch (_) {
      return null;
    }
  }

  function lengthOr(element, property, base, fallback) {
    const value = resolveLength(styleOf(element, property), { base, fontSize: fontSizeOf(element) });
    return value == null ? fallback : value;
  }

  function borderSide(element, side) {
    const style = String(styleOf(element, 'border-' + side + '-style') || 'none').toLowerCase();
    if (style === 'none' || style === 'hidden') return 0;
    const raw = String(styleOf(element, 'border-' + side + '-width') || 'medium').toLowerCase();
    if (raw === 'thin') return 1;
    if (raw === 'medium') return 3;
    if (raw === 'thick') return 5;
    const value = resolveLength(raw, { base: null, fontSize: fontSizeOf(element) });
    return value == null || value < 0 ? 3 : value;
  }

  // Bloc conteneur (largeur, hauteur définie ou null) selon `position`.
  function containingBlock(element) {
    const position = positionOf(element);
    if (position === 'fixed') return { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT };
    if (position === 'absolute') {
      for (let node = element.parentNode; node && node.nodeType === 1; node = node.parentNode) {
        if (node !== rootElement && positionOf(node) !== 'static') {
          return { width: widthBox(node).padding, height: heightBox(node).padding };
        }
      }
      return { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT };
    }
    const parent = element.parentNode;
    if (!parent || parent.nodeType !== 1) return { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT };
    return { width: widthBox(parent).content, height: definiteHeight(parent) };
  }

  const EMPTY_BOX = { border: 0, padding: 0, content: 0 };

  function widthBox(element) {
    if (!isRendered(element)) return EMPTY_BOX;
    if (element === rootElement) return { border: VIEWPORT_WIDTH, padding: VIEWPORT_WIDTH, content: VIEWPORT_WIDTH };
    const block = containingBlock(element).width;
    const context = { base: block, fontSize: fontSizeOf(element) };
    const padding = lengthOr(element, 'padding-left', block, 0) + lengthOr(element, 'padding-right', block, 0);
    const extras = padding + borderSide(element, 'left') + borderSide(element, 'right');
    const display = displayOf(element);
    if (display === 'inline') return { border: extras, padding, content: 0 };
    const borderBoxSizing = String(styleOf(element, 'box-sizing')).toLowerCase() === 'border-box';
    const toContent = (value) => (borderBoxSizing ? Math.max(0, value - extras) : value);
    const position = positionOf(element);
    const floated = String(styleOf(element, 'float') || 'none').toLowerCase() !== 'none';
    const margins = lengthOr(element, 'margin-left', block, 0) + lengthOr(element, 'margin-right', block, 0);
    let content;
    const specified = resolveLength(styleOf(element, 'width'), context);
    if (specified != null && specified >= 0) {
      content = toContent(specified);
    } else if (REPLACED_TAGS.has(element.tagName)) {
      const attribute = parseFloat(element.getAttribute('width'));
      content = Number.isFinite(attribute) && attribute >= 0 ? attribute : 300;
    } else if (position === 'absolute' || position === 'fixed') {
      const left = resolveLength(styleOf(element, 'left'), context);
      const right = resolveLength(styleOf(element, 'right'), context);
      content = left != null && right != null ? Math.max(0, block - left - right - margins - extras) : 0;
    } else if (BLOCK_DISPLAYS.has(display) && !floated) {
      content = Math.max(0, block - margins - extras);
    } else {
      // Contenu vide en shrink-to-fit (inline-block, float, table…).
      content = 0;
    }
    const maximum = resolveLength(styleOf(element, 'max-width'), context);
    if (maximum != null) content = Math.min(content, toContent(maximum));
    const minimum = resolveLength(styleOf(element, 'min-width'), context);
    if (minimum != null) content = Math.max(content, toContent(minimum));
    return { border: content + extras, padding: content + padding, content };
  }

  // Hauteur de contenu « définie » (base des pourcentages), sinon null.
  function definiteHeight(element) {
    if (!element || element.nodeType !== 1 || element === rootElement) return VIEWPORT_HEIGHT;
    if (!isRendered(element)) return null;
    const block = containingBlock(element);
    const context = { base: block.height, fontSize: fontSizeOf(element) };
    const specified = resolveLength(styleOf(element, 'height'), context);
    const padding = lengthOr(element, 'padding-top', block.width, 0) + lengthOr(element, 'padding-bottom', block.width, 0);
    const extras = padding + borderSide(element, 'top') + borderSide(element, 'bottom');
    const borderBoxSizing = String(styleOf(element, 'box-sizing')).toLowerCase() === 'border-box';
    if (specified != null && specified >= 0) return borderBoxSizing ? Math.max(0, specified - extras) : specified;
    const position = positionOf(element);
    if ((position === 'absolute' || position === 'fixed') && block.height != null) {
      const top = resolveLength(styleOf(element, 'top'), context);
      const bottom = resolveLength(styleOf(element, 'bottom'), context);
      if (top != null && bottom != null) {
        const margins = lengthOr(element, 'margin-top', block.width, 0) + lengthOr(element, 'margin-bottom', block.width, 0);
        return Math.max(0, block.height - top - bottom - margins - extras);
      }
    }
    return null;
  }

  function heightBox(element) {
    if (!isRendered(element)) return EMPTY_BOX;
    if (element === rootElement) return { border: VIEWPORT_HEIGHT, padding: VIEWPORT_HEIGHT, content: VIEWPORT_HEIGHT };
    const block = containingBlock(element);
    const padding = lengthOr(element, 'padding-top', block.width, 0) + lengthOr(element, 'padding-bottom', block.width, 0);
    const extras = padding + borderSide(element, 'top') + borderSide(element, 'bottom');
    const display = displayOf(element);
    let content = display === 'inline' ? null : definiteHeight(element);
    if (content == null && REPLACED_TAGS.has(element.tagName)) {
      const attribute = parseFloat(element.getAttribute('height'));
      content = Number.isFinite(attribute) && attribute >= 0 ? attribute : 150;
    }
    if (content == null) {
      content = 0;
      if (display !== 'inline') {
        const row = /flex$/.test(display) && !/^column/.test(String(styleOf(element, 'flex-direction')).toLowerCase());
        const innerWidth = widthBox(element).content;
        let hasText = false;
        for (const child of element.childNodes) {
          if (child.nodeType === 3) {
            if (child.data.trim()) hasText = true;
            continue;
          }
          if (child.nodeType !== 1 || !isRendered(child)) continue;
          const childPosition = positionOf(child);
          if (childPosition === 'absolute' || childPosition === 'fixed') continue;
          if (displayOf(child) === 'inline') {
            hasText = true;
            continue;
          }
          const outer = heightBox(child).border
            + lengthOr(child, 'margin-top', innerWidth, 0)
            + lengthOr(child, 'margin-bottom', innerWidth, 0);
          content = row ? Math.max(content, outer) : content + outer;
        }
        // Une ligne de texte : hauteur de ligne « normal » ≈ 1,2 em.
        if (hasText) content = row ? Math.max(content, fontSizeOf(element) * 1.2) : content + fontSizeOf(element) * 1.2;
      }
      const context = { base: block.height, fontSize: fontSizeOf(element) };
      const maximum = resolveLength(styleOf(element, 'max-height'), context);
      if (maximum != null) content = Math.min(content, maximum);
      const minimum = resolveLength(styleOf(element, 'min-height'), context);
      if (minimum != null) content = Math.max(content, minimum);
    }
    return { border: content + extras, padding: content + padding, content };
  }

  function computedStyle(element) {
    const declaration = new StyleDeclaration();
    if (element && element.__declaration) {
      for (const [key, value] of element.__declaration.__props) declaration.__props.set(key, value);
    }
    if (element && element.nodeType === 1) {
      const rendered = isRendered(element);
      declaration.__props.set('display', displayOf(element));
      declaration.__props.set('position', positionOf(element));
      declaration.__props.set('font-size', fontSizeOf(element) + 'px');
      if (!declaration.__props.has('visibility')) declaration.__props.set('visibility', 'visible');
      if (!declaration.__props.has('opacity')) declaration.__props.set('opacity', '1');
      declaration.__props.set('width', rendered ? widthBox(element).content + 'px' : 'auto');
      declaration.__props.set('height', rendered ? heightBox(element).content + 'px' : 'auto');
      for (const side of BOX_SIDES) {
        const base = rendered ? containingBlock(element).width : null;
        for (const kind of ['padding', 'margin']) {
          declaration.__props.set(kind + '-' + side, lengthOr(element, kind + '-' + side, base, 0) + 'px');
        }
        declaration.__props.set('border-' + side + '-width', borderSide(element, side) + 'px');
      }
    }
    return styleProxy(declaration);
  }

  const cookieJar = new Map();

  class FakeDocument extends FakeNode {
    constructor() {
      super(9, '#document');
      this.readyState = 'loading';
      this.referrer = '';
      this.title = '';
      this.characterSet = 'UTF-8';
      this.charset = 'UTF-8';
      this.contentType = 'text/html';
      this.compatMode = 'CSS1Compat';
      this.visibilityState = 'visible';
      this.hidden = false;
      this.fullscreenElement = null;
      this.pointerLockElement = null;
      this.activeElement = null;
      this.fonts = { ready: Promise.resolve(), check() { return true; }, load() { return Promise.resolve([]); } };
      this.__currentScript = null;
    }
    get documentElement() { return rootElement; }
    get head() { return rootElement.children.find((node) => node.tagName === 'HEAD') || null; }
    get body() { return rootElement.children.find((node) => node.tagName === 'BODY') || null; }
    get defaultView() { return globalThis; }
    get location() { return globalThis.location; }
    set location(_value) {}
    get URL() { return String(globalThis.location && globalThis.location.href || ''); }
    get documentURI() { return this.URL; }
    get domain() { return String(globalThis.location && globalThis.location.hostname || ''); }
    get cookie() { return [...cookieJar].map(([name, value]) => name + '=' + value).join('; '); }
    set cookie(value) {
      const pair = String(value).split(';')[0];
      const equals = pair.indexOf('=');
      if (equals > 0 && cookieJar.size < 64) cookieJar.set(pair.slice(0, equals).trim(), pair.slice(equals + 1).trim());
    }
    get currentScript() {
      if (!this.__currentScript) {
        this.__currentScript = this.createElement('script');
        if (this.head) this.head.appendChild(this.__currentScript);
      }
      return this.__currentScript;
    }
    get children() { return nodeList([rootElement]); }
    createElement(tagName) { return new FakeElement(tagName); }
    createElementNS(namespaceURI, qualifiedName) { return new FakeElement(qualifiedName, namespaceURI); }
    createTextNode(data) { return new FakeText(data); }
    createComment(data) { return new FakeText(data, 8); }
    createDocumentFragment() { return new FakeNode(11, '#document-fragment'); }
    createEvent() { return new FakeEvent(''); }
    createRange() {
      return {
        selectNode() {}, selectNodeContents() {}, setStart() {}, setEnd() {}, collapse() {},
        getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; },
        createContextualFragment(markup) { captureMarkup(markup); return new FakeNode(11, '#document-fragment'); },
      };
    }
    // Indulgent : un id inconnu crée un div attaché au body plutôt que
    // `null`, pour ne pas casser un script qui cible un conteneur de lecteur
    // présent dans le HTML mais absent de notre DOM minimal.
    getElementById(id) {
      const wanted = String(id);
      for (const element of descendants(this)) {
        if (element.id === wanted) return element;
      }
      const created = this.createElement('div');
      created.id = wanted;
      if (this.body) this.body.appendChild(created);
      return created;
    }
    querySelector(selector) {
      const found = selectAll(this, selector, 1)[0];
      if (found) return found;
      const byId = /^\s*#([\w-]+)\s*$/.exec(String(selector));
      return byId ? this.getElementById(byId[1]) : null;
    }
    querySelectorAll(selector) { return nodeList(selectAll(this, selector, 4096)); }
    getElementsByTagName(name) { return this.querySelectorAll(String(name)); }
    getElementsByClassName(names) { return rootElement.getElementsByClassName(names); }
    getElementsByName(name) { return this.querySelectorAll('[name="' + String(name).replace(/"/g, '') + '"]'); }
    elementFromPoint() { return this.body; }
    hasFocus() { return true; }
    write(...parts) { for (const part of parts) captureMarkup(part); }
    writeln(...parts) { for (const part of parts) captureMarkup(part); }
    open() { return this; }
    close() {}
    execCommand() { return false; }
    exitFullscreen() { return Promise.resolve(); }
  }

  documentNode = new FakeDocument();
  rootElement = new FakeElement('html');
  documentNode.appendChild(rootElement);
  rootElement.appendChild(new FakeElement('head'));
  rootElement.appendChild(new FakeElement('body'));
  documentNode.activeElement = documentNode.body;

  // Minuteries : mises en file puis jouées après les scripts, comme la
  // boucle d'événements d'un navigateur (et non en plein milieu du script).
  const timerQueue = [];
  let timerSequence = 0;
  let timerRuns = 0;
  function queueTimer(callback, delay, args) {
    let task = callback;
    if (typeof task === 'string') {
      const code = task;
      task = () => nativeEval(code);
    }
    if (typeof task !== 'function') return 0;
    timerSequence += 1;
    if (timerQueue.length < 256) {
      timerQueue.push({ id: timerSequence, task, delay: Math.max(0, Number(delay) || 0), args });
    }
    return timerSequence;
  }
  function cancelTimer(id) {
    const index = timerQueue.findIndex((timer) => timer.id === id);
    if (index >= 0) timerQueue.splice(index, 1);
  }
  const startedAt = Date.now();
  const now = () => Date.now() - startedAt;

  class InertObserver {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  function memoryStorage() {
    const items = new Map();
    return {
      get length() { return items.size; },
      key(index) { return [...items.keys()][index] ?? null; },
      getItem(key) { return items.has(String(key)) ? items.get(String(key)) : null; },
      setItem(key, value) { if (items.size < 256) items.set(String(key), String(value)); },
      removeItem(key) { items.delete(String(key)); },
      clear() { items.clear(); },
    };
  }

  globalThis.window = globalThis;
  globalThis.self = globalThis;
  globalThis.top = globalThis;
  globalThis.parent = globalThis;
  globalThis.frames = globalThis;
  globalThis.frameElement = null;
  globalThis.opener = null;
  globalThis.name = '';
  globalThis.closed = false;
  for (const [method, implementation] of Object.entries(eventTargetMethods)) {
    globalThis[method] = implementation.bind(globalThis);
  }
  globalThis.navigator = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    appVersion: '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    appName: 'Netscape',
    vendor: 'Google Inc.',
    platform: 'Win32',
    language: 'fr-FR',
    languages: ['fr-FR', 'fr', 'en-US', 'en'],
    cookieEnabled: true,
    onLine: true,
    webdriver: false,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    plugins: [],
    mimeTypes: [],
    doNotTrack: null,
    userAgentData: { brands: [], mobile: false, platform: 'Windows' },
    sendBeacon() { return false; },
    javaEnabled() { return false; },
  };
  // Remplacé juste après le bootstrap par la vraie adresse de l'embed : la
  // clé XOR du lecteur dépend de location.hostname, et un hostname vide lui
  // fait rendre son URL leurre (« troll ») au lieu du média.
  globalThis.location = { protocol: 'https:', host: '', hostname: '', href: '' };
  globalThis.document = documentNode;
  globalThis.innerWidth = VIEWPORT_WIDTH;
  globalThis.innerHeight = VIEWPORT_HEIGHT;
  globalThis.outerWidth = VIEWPORT_WIDTH;
  globalThis.outerHeight = VIEWPORT_HEIGHT + 80;
  globalThis.devicePixelRatio = 1;
  globalThis.scrollX = 0;
  globalThis.scrollY = 0;
  globalThis.pageXOffset = 0;
  globalThis.pageYOffset = 0;
  globalThis.screenX = 0;
  globalThis.screenY = 0;
  globalThis.screen = {
    width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT + 80,
    availWidth: VIEWPORT_WIDTH, availHeight: VIEWPORT_HEIGHT + 40,
    colorDepth: 24, pixelDepth: 24,
    orientation: { type: 'landscape-primary', angle: 0, addEventListener() {}, removeEventListener() {} },
  };
  globalThis.visualViewport = { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT, scale: 1, offsetLeft: 0, offsetTop: 0, addEventListener() {}, removeEventListener() {} };
  globalThis.getComputedStyle = computedStyle;
  globalThis.matchMedia = (query) => ({
    matches: false, media: String(query), onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  });
  globalThis.scrollTo = function () {};
  globalThis.scrollBy = function () {};
  globalThis.focus = function () {};
  globalThis.blur = function () {};
  globalThis.open = function () { return null; };
  globalThis.close = function () {};
  globalThis.alert = function () {};
  globalThis.confirm = function () { return false; };
  globalThis.prompt = function () { return null; };
  globalThis.print = function () {};
  globalThis.postMessage = function () {};
  globalThis.getSelection = function () { return { removeAllRanges() {}, addRange() {}, toString() { return ''; } }; };
  globalThis.history = { length: 1, state: null, pushState() {}, replaceState() {}, back() {}, forward() {}, go() {} };
  globalThis.localStorage = memoryStorage();
  globalThis.sessionStorage = memoryStorage();
  globalThis.performance = { now, timeOrigin: startedAt, mark() {}, measure() {}, getEntriesByType() { return []; }, getEntriesByName() { return []; } };
  globalThis.crypto = {
    getRandomValues(array) {
      for (let index = 0; index < array.length; index++) array[index] = Math.floor(Math.random() * 256);
      return array;
    },
    randomUUID() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
        const random = Math.floor(Math.random() * 16);
        return (character === 'x' ? random : (random & 3) | 8).toString(16);
      });
    },
  };
  globalThis.Node = FakeNode;
  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLDivElement = FakeElement;
  globalThis.HTMLVideoElement = FakeElement;
  globalThis.HTMLMediaElement = FakeElement;
  globalThis.HTMLScriptElement = FakeElement;
  globalThis.HTMLIFrameElement = FakeElement;
  globalThis.HTMLCanvasElement = FakeElement;
  globalThis.Text = FakeText;
  globalThis.Document = FakeDocument;
  globalThis.HTMLDocument = FakeDocument;
  globalThis.CSSStyleDeclaration = StyleDeclaration;
  globalThis.Event = FakeEvent;
  globalThis.CustomEvent = FakeCustomEvent;
  globalThis.MouseEvent = FakeEvent;
  globalThis.KeyboardEvent = FakeEvent;
  globalThis.MessageEvent = FakeEvent;
  globalThis.EventTarget = function EventTarget() {};
  Object.assign(globalThis.EventTarget.prototype, eventTargetMethods);
  globalThis.Image = function Image(width, height) {
    const image = new FakeElement('img');
    if (width !== undefined) image.setAttribute('width', width);
    if (height !== undefined) image.setAttribute('height', height);
    return image;
  };
  globalThis.Audio = function Audio(src) {
    const audio = new FakeElement('audio');
    if (src !== undefined) audio.src = src;
    return audio;
  };
  globalThis.MutationObserver = InertObserver;
  globalThis.ResizeObserver = InertObserver;
  globalThis.IntersectionObserver = InertObserver;
  globalThis.PerformanceObserver = InertObserver;
  globalThis.videojs = playerFactory;
  globalThis.player = playerFactory;
  globalThis.jwplayer = playerFactory;
  globalThis.atob = decodeBase64;
  globalThis.btoa = encodeBase64;
  globalThis.console = { log() {}, warn() {}, error() {}, info() {}, debug() {}, trace() {}, table() {}, dir() {} };
  globalThis.setTimeout = function (callback, delay, ...args) { return queueTimer(callback, delay, args); };
  globalThis.clearTimeout = cancelTimer;
  // Un intervalle n'est joué qu'une fois : assez pour un lecteur qui attend
  // un élément, sans boucle infinie.
  globalThis.setInterval = function (callback, delay, ...args) { return queueTimer(callback, delay, args); };
  globalThis.clearInterval = cancelTimer;
  globalThis.requestAnimationFrame = function (callback) {
    return typeof callback === 'function' ? queueTimer(() => callback(now()), 16, []) : 0;
  };
  globalThis.cancelAnimationFrame = cancelTimer;
  globalThis.requestIdleCallback = function (callback) {
    return typeof callback === 'function' ? queueTimer(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 1, []) : 0;
  };
  globalThis.cancelIdleCallback = cancelTimer;
  globalThis.queueMicrotask = function (callback) {
    if (typeof callback === 'function') Promise.resolve().then(callback);
  };
  globalThis.fetch = undefined;
  globalThis.XMLHttpRequest = undefined;
  globalThis.WebSocket = undefined;
  globalThis.EventSource = undefined;
  globalThis.Worker = undefined;
  globalThis.SharedWorker = undefined;
  globalThis.importScripts = undefined;
  globalThis.RTCPeerConnection = undefined;

  globalThis.__movixRunPlayerScript = function (source) {
    try {
      nativeEval(String(source));
      return null;
    } catch (error) {
      return String(error && error.name ? error.name : 'runtime_error');
    }
  };
  // Fin du chargement : DOMContentLoaded puis load, comme une vraie page.
  globalThis.__movixFinishLoading = function () {
    documentNode.readyState = 'interactive';
    documentNode.dispatchEvent(new FakeEvent('readystatechange'));
    documentNode.dispatchEvent(new FakeEvent('DOMContentLoaded', { bubbles: true }));
    globalThis.dispatchEvent(new FakeEvent('DOMContentLoaded'));
    documentNode.readyState = 'complete';
    documentNode.dispatchEvent(new FakeEvent('readystatechange'));
    globalThis.dispatchEvent(new FakeEvent('load'));
    globalThis.dispatchEvent(new FakeEvent('pageshow'));
  };
  // Joue les minuteries en attente (par délai croissant) ; true si au moins
  // une a tourné.
  globalThis.__movixRunTimers = function () {
    let ran = false;
    while (timerQueue.length && timerRuns < 256 && candidates.length < 16) {
      timerQueue.sort((left, right) => left.delay - right.delay || left.id - right.id);
      const timer = timerQueue.shift();
      timerRuns += 1;
      ran = true;
      try { timer.task(...timer.args); } catch (_) {}
    }
    return ran;
  };
  globalThis.__movixCandidatesJson = function () {
    return JSON.stringify(candidates.slice(0, 16));
  };
})();
"""


def build_location_patch(embed_url: object) -> str:
    """Return the JS that pins `location` to the embed page being replayed.

    Fsvid/Vidzy build their XOR key from the sum of `location.hostname`'s char
    codes. Without the real hostname the decoded bytes are garbage and the
    player falls back to its hardcoded decoy stream, so the sandbox must
    describe the page it is impersonating.
    """
    if not isinstance(embed_url, str) or len(embed_url) > 4096:
        return ''

    try:
        parts = urlsplit(embed_url)
    except ValueError:
        return ''
    if parts.scheme != 'https' or not parts.hostname:
        return ''

    descriptor = {
        'href': embed_url,
        'origin': f'https://{parts.netloc}',
        'protocol': 'https:',
        'host': parts.netloc,
        'hostname': parts.hostname,
        'port': str(parts.port or ''),
        'pathname': parts.path or '/',
        'search': f'?{parts.query}' if parts.query else '',
        'hash': f'#{parts.fragment}' if parts.fragment else '',
    }
    encoded = json.dumps(descriptor, ensure_ascii=True)
    return (
        f'globalThis.location = {encoded};'
        'globalThis.location.toString = function () { return this.href; };'
        'globalThis.location.assign = function () {};'
        'globalThis.location.replace = function () {};'
        'globalThis.location.reload = function () {};'
    )


def emit(payload: dict[str, object], exit_code: int = 0) -> None:
    def encode(candidate_payload: dict[str, object]) -> bytes:
        return json.dumps(candidate_payload, separators=(",", ":")).encode("utf-8")

    encoded = encode(payload)
    if len(encoded) > MAX_RESPONSE_BYTES:
        raw_candidates = payload.get("candidates")
        bounded_candidates: list[object] = []
        if isinstance(raw_candidates, list):
            for candidate in raw_candidates:
                bounded_payload = {**payload, "candidates": [*bounded_candidates, candidate]}
                bounded_encoded = encode(bounded_payload)
                if len(bounded_encoded) <= MAX_RESPONSE_BYTES:
                    bounded_candidates.append(candidate)
                    encoded = bounded_encoded

        if not bounded_candidates:
            encoded = encode(
                {"candidates": [], "error": "sandbox_output_too_large"}
            )

    sys.stdout.buffer.write(encoded)
    raise SystemExit(exit_code)


def _drain_pending_jobs(context: object, budget: list[int]) -> bool:
    """Run queued promise reactions; `budget` is shared across calls."""
    ran = False
    while budget[0] > 0 and context.execute_pending_job():
        budget[0] -= 1
        ran = True
    return ran


def main() -> None:
    raw_request = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(raw_request) > MAX_REQUEST_BYTES:
        emit({"candidates": [], "error": "sandbox_input_too_large"}, 2)

    try:
        request = json.loads(raw_request.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        emit({"candidates": [], "error": "sandbox_invalid_request"}, 2)

    scripts = request.get("scripts") if isinstance(request, dict) else None
    if not isinstance(scripts, list) or not scripts:
        emit({"candidates": [], "error": "no_player_script"}, 2)
    if any(not isinstance(script, str) for script in scripts):
        emit({"candidates": [], "error": "sandbox_invalid_request"}, 2)

    try:
        import quickjs
    except (ImportError, OSError):
        emit({"candidates": [], "error": "sandbox_unavailable"}, 1)

    try:
        context = quickjs.Context()
        context.set_memory_limit(MEMORY_LIMIT_BYTES)
        context.set_max_stack_size(STACK_LIMIT_BYTES)
        context.set_time_limit(TIME_LIMIT_SECONDS)
        context.eval(BOOTSTRAP)
        location_patch = build_location_patch(
            request.get("embedUrl") if isinstance(request, dict) else None
        )
        if location_patch:
            context.eval(location_patch)
        run_script = context.get("__movixRunPlayerScript")
        job_budget = [MAX_PENDING_JOBS]
        runtime_error = None
        for script in scripts:
            error = run_script(script)
            if error:
                runtime_error = str(error)
            _drain_pending_jobs(context, job_budget)
        context.get("__movixFinishLoading")()
        _drain_pending_jobs(context, job_budget)
        run_timers = context.get("__movixRunTimers")
        for _ in range(MAX_SETTLE_ROUNDS):
            progressed = bool(run_timers())
            progressed = _drain_pending_jobs(context, job_budget) or progressed
            if not progressed:
                break
        candidates_json = context.get("__movixCandidatesJson")()
        candidates = json.loads(candidates_json)
    except Exception as error:
        error_text = str(error).lower()
        reason = "sandbox_timeout" if "interrupted" in error_text else "sandbox_runtime_error"
        emit({"candidates": [], "error": reason}, 1)

    emit(
        {
            "candidates": candidates if isinstance(candidates, list) else [],
            "error": None if candidates else (runtime_error or "no_valid_candidate"),
        }
    )


if __name__ == "__main__":
    main()
