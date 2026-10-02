/*!
 * editor/js/util.js — 通用小工具（DOM / 文本 / 下载 / 焦点保持）
 * 挂在 window.Util
 */
(function (global) {
  'use strict';

  var Util = {};

  /* ---------------------------------------------------------------- DOM */
  Util.qs = function (root, sel) { return root.querySelector(sel); };
  Util.qsa = function (root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

  /** HTML 转义，所有用户文本输出到 innerHTML 前必须经过它 */
  Util.esc = function (text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /** 事件委托：在 root 上监听 type，命中 selector 时调用 handler(el, event) */
  Util.on = function (root, type, selector, handler) {
    root.addEventListener(type, function (e) {
      var el = e.target;
      while (el && el !== root) {
        if (el.matches && el.matches(selector)) {
          handler(el, e);
          return;
        }
        el = el.parentNode;
      }
    });
  };

  Util.closest = function (el, selector) {
    while (el && el.nodeType === 1) {
      if (el.matches && el.matches(selector)) return el;
      el = el.parentNode;
    }
    return null;
  };

  /**
   * 在重绘前记住焦点元素与光标位置，重绘后恢复。
   * 约定：需要保持焦点的元素带 data-focus="唯一键"。
   */
  Util.withFocus = function (root, render) {
    var active = document.activeElement;
    var key = null;
    var start = 0;
    var end = 0;
    if (active && root.contains(active) && active.getAttribute) {
      key = active.getAttribute('data-focus');
      if (key && typeof active.selectionStart === 'number') {
        start = active.selectionStart;
        end = active.selectionEnd;
      }
    }
    render();
    if (!key) return;
    var next = root.querySelector('[data-focus="' + key.replace(/"/g, '\\"') + '"]');
    if (!next) return;
    next.focus();
    if (typeof next.setSelectionRange === 'function' && typeof next.selectionStart === 'number') {
      try { next.setSelectionRange(start, end); } catch (e) { /* number 类型输入框不支持 */ }
    }
  };

  /** 让 textarea 高度跟随内容 */
  Util.autoGrow = function (textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = (textarea.scrollHeight + 2) + 'px';
  };

  /* --------------------------------------------------------------- 文本 */
  Util.truncate = function (text, max) {
    var s = String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  };

  Util.slug = function (name, fallback) {
    var s = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\s+|\s+$/g, '');
    if (!s) s = fallback || 'story';
    return s.slice(0, 60);
  };

  Util.yesNo = function (value) { return value ? '真' : '假'; };

  /** 显示值：数字保留最多 2 位小数；布尔显示 真/假 */
  Util.displayVar = function (value, type) {
    if (type === 'bool') return Util.yesNo(!!value);
    var n = Number(value);
    if (!isFinite(n)) return String(value);
    return String(Math.round(n * 100) / 100);
  };

  /* --------------------------------------------------------------- 其他 */
  Util.clone = function (value) { return JSON.parse(JSON.stringify(value)); };

  Util.debounce = function (fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        fn.apply(self, args);
      }, wait);
    };
  };

  Util.moveItem = function (list, index, delta) {
    var to = index + delta;
    if (index < 0 || index >= list.length || to < 0 || to >= list.length) return false;
    var tmp = list[index];
    list[index] = list[to];
    list[to] = tmp;
    return true;
  };

  /** 触发浏览器下载 */
  Util.download = function (filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  };

  Util.now = function () { return new Date().toISOString(); };

  global.Util = Util;
})(typeof window !== 'undefined' ? window : globalThis);
