/*!
 * editor/js/view-preview.js — 试玩预览：手机尺寸画框 + 变量监视 + 回溯
 * 依赖：StoryEngine、Util、Model、Store   挂载于 window.ViewPreview
 *
 * 预览用与导出物同一份引擎（core/story-engine.js）驱动，所见即所得。
 * 选项上会额外显示条件文案（导出物不显示），方便调试。
 */
(function (global) {
  'use strict';

  var Engine = global.StoryEngine;
  var Util = global.Util;
  var Model = global.Model;
  var Store = global.Store;
  var ViewPreview = {};

  var overlay = null;
  var session = null;
  var lastVars = {};
  var flashTimers = {};

  /* ----------------------------------------------------------- 挂载 */
  ViewPreview.mount = function (overlayEl) {
    overlay = overlayEl;
    Util.on(overlay, 'click', '[data-pact]', onAction);
    Util.on(overlay, 'change', '[data-pfield]', onFieldChange);
  };

  function isOpen() { return overlay && !overlay.hidden; }

  ViewPreview.toggle = function () {
    if (isOpen()) ViewPreview.close();
    else ViewPreview.open();
  };

  /* ----------------------------------------------------------- 开关 */
  ViewPreview.open = function (nodeId) {
    var project = Store.getProject();
    var ui = Store.getUi();
    var targetNodeId = nodeId || ui.selectedNodeId || project.meta.startNodeId;
    if (!Model.findNode(project, targetNodeId)) targetNodeId = project.meta.startNodeId;

    overlay.hidden = false;
    Store.setUi({ previewOpen: true }, { silent: true });
    overlay.innerHTML = shellHtml(project);
    startSession(targetNodeId);
    var select = overlay.querySelector('[data-pfield="start"]');
    if (select) select.value = targetNodeId;
  };

  ViewPreview.close = function () {
    if (session) {
      session.off('change');
      session.off('warning');
      session = null;
    }
    overlay.hidden = true;
    overlay.innerHTML = '';
    Store.setUi({ previewOpen: false }, { silent: true });
  };

  function shellHtml(project) {
    var options = '';
    for (var i = 0; i < project.nodes.length; i++) {
      var node = project.nodes[i];
      options += '<option value="' + Util.esc(node.id) + '">' +
        Util.esc((i + 1) + '. ' + (node.title || '未命名')) + '</option>';
    }
    return '<div class="preview-box">' +
      '<div class="phone">' +
      '<div class="r-topbar"><span class="r-title" data-p="title">' + Util.esc(project.meta.title) + '</span>' +
      '<button type="button" class="r-btn" data-pact="restart">重新开始</button></div>' +
      '<div class="r-stage">' +
      '<p class="r-text" data-p="text"></p>' +
      '<div data-p="choices"></div>' +
      '<div class="r-ending" data-p="ending" hidden><div>— 完 —</div>' +
      '<button type="button" data-pact="restart">重新开始</button></div>' +
      '<div class="r-warn" data-p="warn" hidden></div>' +
      '</div>' +
      '<div class="r-bottombar">' +
      '<button type="button" class="r-btn" data-pact="back">← 返回上一步</button>' +
      '<span class="spacer"></span><span data-p="progress"></span>' +
      '</div>' +
      '</div>' +
      '<div class="preview-side">' +
      '<div class="row">' +
      '<select class="field grow" data-pfield="start">' + options + '</select>' +
      '<button type="button" class="btn small" data-pact="startFrom">从这里开始</button>' +
      '<button type="button" class="btn small" data-pact="close">关闭</button>' +
      '</div>' +
      '<div class="debug">' +
      '<h3>变量监视</h3><table class="var-watch" data-p="vars"></table>' +
      '<h3>历史（点击回退到该步）</h3><div class="history-list" data-p="history"></div>' +
      '<h3>运行时警告</h3><div class="warn-list" data-p="warnings"></div>' +
      '</div>' +
      '<div class="muted">提示：预览里的选项会额外显示条件文案，导出的阅读器不会显示。</div>' +
      '</div>' +
      '</div>';
  }

  /* --------------------------------------------------------- 会话控制 */
  function startSession(startNodeId) {
    var project = Store.getProject();
    if (session) {
      session.off('change');
      session.off('warning');
    }
    lastVars = {};
    session = Engine.createSession(project, { startNodeId: startNodeId });
    session.on('change', renderState);
    session.on('warning', renderWarnings);
    renderState();
  }

  function onAction(el) {
    var act = el.getAttribute('data-pact');
    if (!session && act !== 'close') return;

    if (act === 'choose') {
      session.choose(parseInt(el.getAttribute('data-idx'), 10));
      return;
    }
    if (act === 'back') {
      session.back();
      return;
    }
    if (act === 'restart') {
      var select = overlay.querySelector('[data-pfield="start"]');
      session.restart(select ? select.value : undefined);
      return;
    }
    if (act === 'startFrom') {
      session.restart(overlay.querySelector('[data-pfield="start"]').value);
      return;
    }
    if (act === 'rewind') {
      var target = parseInt(el.getAttribute('data-idx'), 10);
      var guard = 0;
      while (session.stepCount > target && guard++ < 500) session.back();
      return;
    }
    if (act === 'close') ViewPreview.close();
  }

  function onFieldChange(el) {
    if (el.getAttribute('data-pfield') !== 'start' || !session) return;
    session.restart(el.value);
  }

  /* ----------------------------------------------------------- 渲染 */
  function renderState() {
    if (!session || !overlay || overlay.hidden) return;
    var stage = overlay.querySelector('.r-stage');
    var scrollTop = stage ? stage.scrollTop : 0;

    overlay.querySelector('[data-p="text"]').textContent = session.text;

    var html = '';
    var choices = session.choices;
    for (var i = 0; i < choices.length; i++) {
      var hint = choices[i].description && choices[i].description !== '无条件'
        ? '<span class="r-cond">条件：' + Util.esc(choices[i].description) + '</span>'
        : '';
      html += '<button type="button" class="r-choice" data-pact="choose" data-idx="' + i + '">' +
        Util.esc(choices[i].text || '（未命名的选项）') + hint + '</button>';
    }
    overlay.querySelector('[data-p="choices"]').innerHTML = html;

    var ended = session.status === 'ended';
    var errored = session.status === 'error';
    var endingBox = overlay.querySelector('[data-p="ending"]');
    endingBox.hidden = !(ended || errored);
    if (ended || errored) {
      endingBox.firstChild.textContent = errored ? '⚠ ' + session.lastError : '— 完 —';
    }

    overlay.querySelector('[data-pact="back"]').disabled = !session.canGoBack;
    overlay.querySelector('[data-p="progress"]').textContent = errored
      ? '出错'
      : (ended ? '已结束' : '第 ' + (session.stepCount + 1) + ' 步');

    renderVars();
    renderHistory();
    renderWarnings();

    if (stage && (ended || errored)) stage.scrollTop = 0;
    else if (stage) stage.scrollTop = scrollTop;
  }

  function renderVars() {
    var table = overlay.querySelector('[data-p="vars"]');
    var html = '';
    var project = session.project;
    for (var i = 0; i < project.variables.length; i++) {
      var def = project.variables[i];
      var value = session.vars[def.id];
      var flash = lastVars[def.id] !== undefined && lastVars[def.id] !== value;
      html += '<tr class="' + (flash ? 'flash' : '') + '" data-var-row="' + Util.esc(def.id) + '">' +
        '<td>' + Util.esc(def.name) + '</td>' +
        '<td class="muted">' + (def.type === 'bool' ? '布尔' : '数字') + '</td>' +
        '<td class="v">' + Util.esc(Util.displayVar(value, def.type)) + '</td>' +
        '</tr>';
    }
    if (!project.variables.length) html = '<tr><td class="muted">（没有变量）</td></tr>';
    table.innerHTML = html;
    lastVars = Util.clone(session.vars);

    var flashed = overlay.querySelectorAll('tr.flash');
    for (var f = 0; f < flashed.length; f++) {
      (function (row) {
        var id = row.getAttribute('data-var-row');
        if (flashTimers[id]) global.clearTimeout(flashTimers[id]);
        flashTimers[id] = global.setTimeout(function () { row.classList.remove('flash'); }, 600);
      })(flashed[f]);
    }
  }

  function renderHistory() {
    var box = overlay.querySelector('[data-p="history"]');
    var history = session.history;
    if (!history.length) {
      box.innerHTML = '<div class="muted">（还没有走过任何一步）</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < history.length; i++) {
      var node = Model.findNode(session.project, history[i].nodeId);
      html += '<div data-pact="rewind" data-idx="' + i + '" title="点击回退到这里">' +
        (i + 1) + '. ' + Util.esc(node ? (node.title || '未命名') : history[i].nodeId) + '</div>';
    }
    box.innerHTML = html;
  }

  function renderWarnings() {
    var box = overlay.querySelector('[data-p="warnings"]');
    var sideWarn = overlay.querySelector('[data-p="warn"]');
    if (!box || !sideWarn || !session) return;
    var warnings = session.warnings;
    if (!warnings.length) {
      box.innerHTML = '<div class="muted">（无）</div>';
      sideWarn.hidden = true;
      return;
    }
    var html = '';
    for (var i = 0; i < warnings.length; i++) html += '<div>· ' + Util.esc(warnings[i]) + '</div>';
    box.innerHTML = html;
    sideWarn.hidden = false;
    sideWarn.textContent = '⚠ 运行时警告：' + warnings.join('；');
  }

  global.ViewPreview = ViewPreview;
})(typeof window !== 'undefined' ? window : globalThis);
