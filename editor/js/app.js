/*!
 * editor/js/app.js — 启动、视图路由、工具栏、校验面板、快捷键
 * 依赖：StoryEngine、Util、Model、Store、各视图、IO
 */
(function (global) {
  'use strict';

  var Util = global.Util;
  var Model = global.Model;
  var Store = global.Store;
  var App = {};

  var toastTimer = null;

  function el(id) { return document.getElementById(id); }

  /* --------------------------------------------------- 错误兜底（error boundary）
   * 所有事件绑定都在 mount 阶段一次性完成，因此渲染阶段抛错不应该让界面“半残”。
   * 这里统一捕获：把错误显示在状态栏 + 控制台，其余视图继续正常渲染。
   * 同类错误只提示一次，避免每次重绘都刷屏。 */
  var lastErrorMessage = '';

  function reportError(label, err) {
    var message = err && err.message ? err.message : String(err);
    if (message === lastErrorMessage) return;
    lastErrorMessage = message;
    if (global.console && global.console.error) global.console.error('[editor] ' + label + '：', err);
    try { showStatus('⚠ ' + label + '：' + message + '（详情见浏览器控制台）'); } catch (ignored) { /* 忽略 */ }
  }

  function safeCall(label, fn) {
    if (typeof fn !== 'function') return false;
    try {
      fn();
      return true;
    } catch (err) {
      reportError(label, err);
      return false;
    }
  }

  /* ------------------------------------------------------------- 启动 */
  App.boot = function () {
    try {
      bootEditor();
    } catch (err) {
      // 启动即失败（例如本地存档结构异常）时给出可见提示，而不是留下一片空白
      lastErrorMessage = '';
      reportError('编辑器启动失败', err);
      var holder = document.getElementById('view-list');
      if (holder) {
        holder.innerHTML = '<div class="panel"><div class="empty">编辑器启动失败：' +
          Util.esc(err && err.message ? err.message : String(err)) +
          '<br>请按 F12 打开控制台查看详情；也可以导入之前导出的 JSON 备份继续编辑。</div></div>';
      }
    }
  };

  function bootEditor() {
    // 兜底：任何未捕获异常都在状态栏提示，避免“点了没反应却不知道原因”
    global.addEventListener('error', function (e) {
      reportError('发生未捕获的错误', e.error || { message: e.message });
    });

    var initial = global.IO.loadInitial();

    global.IO.mount(el('file-input'));
    global.ViewList.mount(el('view-list'));
    global.ViewList.mountSidebar(el('node-list'), el('node-count'));
    global.ViewGraph.mount(el('view-graph'));
    global.ViewVariables.mount(el('view-variables'));
    global.ViewPreview.mount(el('preview-overlay'));

    Store.on('change', renderAll);
    Store.on('status', showStatus);
    Store.on('saved', function () {
      el('save-state').textContent = '已自动保存 ' + timeText();
    });

    bindToolbar();
    bindKeys();

    Store.init(initial.project, initial.notes);
    renderAll();
    if (initial.notes.length) showStatus('提示：' + initial.notes.join('；'));
    global.addEventListener('beforeunload', function () { Store.saveNow(); });
  }

  function timeText() {
    var d = new Date();
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /* ------------------------------------------------------------- 渲染 */
  function renderAll() {
    var ui = Store.getUi();
    var project = Store.getProject();
    if (!project) return;

    var titleInput = el('project-title');
    if (document.activeElement !== titleInput) titleInput.value = project.meta.title;

    safeCall('侧栏节点列表渲染失败', global.ViewList.renderSidebar);

    var views = { list: el('view-list'), graph: el('view-graph'), variables: el('view-variables') };
    for (var key in views) {
      if (Object.prototype.hasOwnProperty.call(views, key)) views[key].hidden = key !== ui.view;
    }
    var buttons = Util.qsa(el('view-switch'), 'button');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].getAttribute('data-view') === ui.view);
    }

    if (ui.view === 'list') safeCall('节点编辑区渲染失败', global.ViewList.render);
    else if (ui.view === 'graph') safeCall('节点图渲染失败', global.ViewGraph.render);
    else safeCall('变量面板渲染失败', global.ViewVariables.render);

    safeCall('校验面板渲染失败', renderIssues);
  }

  function renderIssues() {
    var issues = Store.getIssues();
    var errors = 0;
    var warns = 0;
    for (var i = 0; i < issues.length; i++) {
      if (issues[i].level === 'error') errors++;
      else warns++;
    }
    var btn = el('btn-issues');
    btn.innerHTML = '校验：<span class="err-count">' + errors + ' 错误</span> / <span class="warn-count">' + warns + ' 警告</span>';

    var panel = el('issues-panel');
    if (panel.hidden) return;
    var html = '';
    if (!issues.length) {
      html = '<div class="issue ok"><span class="lv">✔</span><span>没有发现问题，剧情结构看起来是通的。</span></div>';
    } else {
      for (var k = 0; k < issues.length; k++) {
        var issue = issues[k];
        html += '<div class="issue ' + (issue.level === 'error' ? 'error' : 'warn') + '"' +
          (issue.nodeId ? ' data-issue-node="' + Util.esc(issue.nodeId) + '"' : '') + '>' +
          '<span class="lv">' + (issue.level === 'error' ? '✖' : '!') + '</span>' +
          '<span>' + Util.esc(issue.message) + '</span>' +
          '</div>';
      }
    }
    panel.innerHTML = html;
  }

  function showStatus(text) {
    el('status-text').textContent = text;
    var toast = el('toast');
    toast.textContent = text;
    toast.hidden = false;
    if (toastTimer) global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(function () { toast.hidden = true; }, 2600);
  }

  /* --------------------------------------------------------- 工具栏绑定 */
  function bindToolbar() {
    el('btn-new').addEventListener('click', function () { global.IO.newProject(); });
    el('btn-import').addEventListener('click', function () { el('file-input').click(); });
    el('btn-export-json').addEventListener('click', function () { global.IO.exportJson(); });
    el('btn-export-html').addEventListener('click', function () { global.IO.exportHtml(); });
    el('btn-preview').addEventListener('click', function () { global.ViewPreview.toggle(); });

    Util.on(el('view-switch'), 'click', 'button[data-view]', function (button) {
      Store.setUi({ view: button.getAttribute('data-view') });
    });

    el('btn-add-node').addEventListener('click', function () {
      Store.update(function (project, ui) {
        var node = Model.addNode(project);
        ui.selectedNodeId = node.id;
        ui.focusNodeId = node.id;
      });
    });

    // 搜索框：输入停顿 180ms 后才重绘，避免中文输入法逐字触发全量重绘
    var applySearch = Util.debounce(function (value) {
      Store.setUi({ search: value });
    }, 180);
    el('node-search').addEventListener('input', function () {
      applySearch(el('node-search').value);
    });

    el('project-title').addEventListener('input', function () {
      var value = el('project-title').value;
      Store.update(function (project) { project.meta.title = value; }, { silent: true });
    });
    el('project-title').addEventListener('change', function () {
      Store.update(function () { /* 触发保存与重绘 */ });
    });

    el('btn-issues').addEventListener('click', function () {
      var panel = el('issues-panel');
      panel.hidden = !panel.hidden;
      renderIssues();
    });

    Util.on(el('issues-panel'), 'click', '[data-issue-node]', function (item) {
      el('issues-panel').hidden = true;
      Store.setUi({ view: 'list', selectedNodeId: item.getAttribute('data-issue-node') });
    });

    // 点击预览遮罩的空白处关闭预览
    el('preview-overlay').addEventListener('pointerdown', function (e) {
      if (e.target === el('preview-overlay')) global.ViewPreview.close();
    });
  }

  /* ----------------------------------------------------------- 快捷键 */
  function isTyping() {
    var active = document.activeElement;
    if (!active) return false;
    var tag = active.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable;
  }

  function deleteSelectedNode() {
    var project = Store.getProject();
    var ui = Store.getUi();
    var node = Model.findNode(project, ui.selectedNodeId);
    if (!node) return;
    if (project.nodes.length <= 1) {
      global.alert('至少要保留一个节点。');
      return;
    }
    if (!global.confirm('确定删除节点「' + (node.title || '未命名') + '」吗？')) return;
    Store.update(function (p, u) {
      Model.removeNode(p, node.id);
      u.selectedNodeId = p.meta.startNodeId;
    });
  }

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      var key = e.key ? e.key.toLowerCase() : '';

      if (mod && key === 's') {
        e.preventDefault();
        Store.saveNow();
        return;
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        global.ViewPreview.toggle();
        return;
      }
      if (mod && (e.key === '1' || e.key === '2' || e.key === '3')) {
        e.preventDefault();
        var map = { '1': 'list', '2': 'graph', '3': 'variables' };
        Store.setUi({ view: map[e.key] });
        return;
      }
      if (e.key === 'Escape' && !el('preview-overlay').hidden) {
        global.ViewPreview.close();
        return;
      }
      if (isTyping()) return;
      if (mod && key === 'd') {
        e.preventDefault();
        Store.update(function (project, ui) {
          var copy = Model.duplicateNode(project, ui.selectedNodeId);
          if (copy) ui.selectedNodeId = copy.id;
        });
        return;
      }
      if (e.key === 'Delete') {
        e.preventDefault();
        deleteSelectedNode();
      }
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', App.boot);
    else App.boot();
  }

  global.App = App;
})(typeof window !== 'undefined' ? window : globalThis);
