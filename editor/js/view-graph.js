/*!
 * editor/js/view-graph.js — 节点图视图：HTML 节点卡片 + SVG 连线
 * 依赖：StoryEngine、Util、Model、Store   挂载于 window.ViewGraph
 *
 * 拖拽期间只操作 DOM，松开时才写回 store（避免每帧重绘丢指针状态）。
 */
(function (global) {
  'use strict';

  var Engine = global.StoryEngine;
  var Util = global.Util;
  var Model = global.Model;
  var Store = global.Store;
  var ViewGraph = {};

  var CARD_W = 200;
  var PORT_Y = 22; // 连线接入点相对节点顶部的偏移
  var MIN_ZOOM = 0.35;
  var MAX_ZOOM = 1.8;

  var root = null;
  var viewport = null;
  var world = null;
  var svg = null;
  var nodesLayer = null;
  var view = { zoom: 1, pan: { x: 20, y: 20 } };

  /* ----------------------------------------------------------- 挂载 */
  ViewGraph.mount = function (container) {
    root = container;
    root.innerHTML =
      '<div class="graph-wrap">' +
      '<div class="graph-toolbar">' +
      '<button type="button" class="btn small" data-gact="layout">自动布局</button>' +
      '<button type="button" class="btn small" data-gact="fit">适应窗口</button>' +
      '<button type="button" class="btn small" data-gact="reset">重置视图</button>' +
      '<span class="spacer"></span>' +
      '<span class="muted">拖节点移动 · 拖空白平移 · 滚轮缩放 · 双击节点进入编辑</span>' +
      '</div>' +
      '<div class="graph-viewport">' +
      '<div class="graph-world">' +
      '<svg class="graph-links" width="1" height="1"></svg>' +
      '<div class="graph-nodes"></div>' +
      '</div>' +
      '</div>' +
      '</div>';
    viewport = Util.qs(root, '.graph-viewport');
    world = Util.qs(root, '.graph-world');
    svg = Util.qs(root, '.graph-links');
    nodesLayer = Util.qs(root, '.graph-nodes');

    Util.on(root, 'click', '[data-gact]', onToolbarClick);
    Util.on(root, 'click', '[data-nact]', onNodeAction);
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('dblclick', onDoubleClick);
  };

  /* ----------------------------------------------------------- 渲染 */
  function applyTransform() {
    world.style.transform = 'translate(' + view.pan.x + 'px,' + view.pan.y + 'px) scale(' + view.zoom + ')';
  }

  function nodeHtml(project, node) {
    var summary = Model.nodeSummary(project, node);
    var cls = 'graph-node';
    if (node.id === Store.getUi().selectedNodeId) cls += ' selected';
    if (summary.isStart) cls += ' is-start';
    if (summary.isEnding) cls += ' is-ending';
    var meta = [];
    if (summary.choiceCount) meta.push('选项 ' + summary.choiceCount);
    if (summary.ruleCount) meta.push('↳ 自动跳转 ' + summary.ruleCount);
    if (summary.isEnding) meta.push('◼ 结局');
    return '<div class="' + cls + '" data-gnode="' + Util.esc(node.id) + '" style="left:' + node.x + 'px;top:' + node.y + 'px">' +
      '<div class="gn-title">' + (summary.isStart ? '★ ' : '') + Util.esc(node.title || '未命名') + '</div>' +
      '<div class="gn-text">' + Util.esc(Util.truncate(node.text, 46) || '（空正文）') + '</div>' +
      '<div class="gn-meta">' + meta.map(function (t) { return '<span>' + Util.esc(t) + '</span>'; }).join('') + '</div>' +
      '<div class="gn-tools">' +
      '<button type="button" class="mini" data-nact="edit" data-node="' + Util.esc(node.id) + '">编辑</button>' +
      '<button type="button" class="mini" data-nact="dup" data-node="' + Util.esc(node.id) + '">复制</button>' +
      '<button type="button" class="mini" data-nact="start" data-node="' + Util.esc(node.id) + '">起点</button>' +
      '<button type="button" class="mini danger" data-nact="del" data-node="' + Util.esc(node.id) + '">删除</button>' +
      '</div>' +
      '</div>';
  }

  function edgePath(x1, y1, x2, y2) {
    var dx = Math.max(40, Math.abs(x2 - x1) * 0.45);
    return 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2;
  }

  function linksHtml(project) {
    var index = {};
    var i;
    for (i = 0; i < project.nodes.length; i++) index[project.nodes[i].id] = project.nodes[i];
    var defs = '<defs>' +
      '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="#5c646f"></path></marker>' +
      '<marker id="arrow-cond" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="#d9a13b"></path></marker>' +
      '<marker id="arrow-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="#d9605a"></path></marker>' +
      '</defs>';
    var labels = '';
    var paths = '';

    function drawEdge(from, to, kind, label) {
      var color = kind === 'cond' ? '#d9a13b' : '#5c646f';
      var marker = kind === 'cond' ? 'arrow-cond' : 'arrow';
      var dash = kind === 'cond' ? ' stroke-dasharray="5 4"' : '';
      var x1 = from.x + CARD_W;
      var y1 = from.y + PORT_Y;
      var x2 = to.x;
      var y2 = to.y + PORT_Y;
      if (to.x < from.x + CARD_W + 20) {
        // 目标是左侧节点（回边）：从底部绕行
        paths += '<path d="M ' + (from.x + CARD_W / 2) + ' ' + (from.y + 66) + ' C ' +
          (from.x + CARD_W / 2 + 70) + ' ' + (from.y + 170) + ', ' + (to.x + CARD_W / 2 - 70) + ' ' + (to.y + 170) + ', ' +
          (to.x + CARD_W / 2) + ' ' + (to.y + 66) + '" fill="none" stroke="' + color + '" stroke-width="1.6"' + dash +
          ' marker-end="url(#' + marker + ')"></path>';
        return;
      }
      paths += '<path d="' + edgePath(x1, y1, x2, y2) + '" fill="none" stroke="' + color + '" stroke-width="1.6"' + dash +
        ' marker-end="url(#' + marker + ')"></path>';
      if (label) {
        labels += '<text x="' + ((x1 + x2) / 2) + '" y="' + ((y1 + y2) / 2 - 5) + '" fill="#7b8494" ' +
          'font-size="10" text-anchor="middle">' + Util.esc(label) + '</text>';
      }
    }

    function drawDangling(from, label) {
      var x1 = from.x + CARD_W;
      var y1 = from.y + PORT_Y;
      paths += '<path d="' + edgePath(x1, y1, x1 + 70, y1 + 40) + '" fill="none" stroke="#d9605a" ' +
        'stroke-width="1.6" stroke-dasharray="4 4" marker-end="url(#arrow-bad)"></path>';
      labels += '<text x="' + (x1 + 78) + '" y="' + (y1 + 46) + '" fill="#d9605a" font-size="11">⚠ ' +
        Util.esc(label || '目标缺失') + '</text>';
    }

    for (i = 0; i < project.nodes.length; i++) {
      var node = project.nodes[i];
      var b;
      for (b = 0; b < node.branches.length; b++) {
        var branch = node.branches[b];
        var target = index[branch.target];
        if (!branch.target || !target) {
          drawDangling(node, branch.text ? Util.truncate(branch.text, 10) : '选项未设目标');
        } else {
          drawEdge(node, target, branch.condition ? 'cond' : 'plain', Util.truncate(branch.text, 12));
        }
      }
      for (var r = 0; r < node.autoRules.length; r++) {
        var rule = node.autoRules[r];
        var ruleTarget = index[rule.target];
        if (!rule.target || !ruleTarget) {
          drawDangling(node, '自动跳转目标缺失');
        } else {
          var ruleLabel = rule.condition ? Util.truncate(Engine.describeCondition(rule.condition, project), 14) : '否则';
          drawEdge(node, ruleTarget, 'cond', ruleLabel);
        }
      }
    }
    return defs + paths + labels;
  }

  ViewGraph.render = function () {
    if (!root) return;
    var project = Store.getProject();
    var ui = Store.getUi();

    if (ui.graph) {
      view.zoom = ui.graph.zoom;
      view.pan.x = ui.graph.pan.x;
      view.pan.y = ui.graph.pan.y;
    }
    if (ui.focusNodeId) {
      var focus = Model.findNode(project, ui.focusNodeId);
      if (focus) {
        var rect = viewport.getBoundingClientRect();
        view.pan.x = rect.width / 2 - (focus.x + CARD_W / 2) * view.zoom;
        view.pan.y = rect.height / 2 - (focus.y + 40) * view.zoom;
      }
      Store.setUi({ focusNodeId: null, graph: { zoom: view.zoom, pan: { x: view.pan.x, y: view.pan.y } } }, { silent: true });
    }
    applyTransform();

    var html = '';
    for (var i = 0; i < project.nodes.length; i++) html += nodeHtml(project, project.nodes[i]);
    nodesLayer.innerHTML = html;
    svg.innerHTML = linksHtml(project);
  };

  /* --------------------------------------------------------- 交互逻辑 */
  function commitView() {
    Store.setUi({ graph: { zoom: view.zoom, pan: { x: view.pan.x, y: view.pan.y } } });
  }
  var commitViewLazy = Util.debounce(commitView, 350);

  function fitToWindow() {
    var project = Store.getProject();
    var rect = viewport.getBoundingClientRect();
    var t = Model.fitTransform(project, rect.width, rect.height);
    view.zoom = t.zoom;
    view.pan.x = t.pan.x;
    view.pan.y = t.pan.y;
    applyTransform();
    commitView();
  }

  function onToolbarClick(el) {
    var act = el.getAttribute('data-gact');
    if (act === 'layout') {
      Store.update(function (project) { Model.autoLayout(project); });
      fitToWindow();
      return;
    }
    if (act === 'fit') {
      fitToWindow();
      return;
    }
    if (act === 'reset') {
      view.zoom = 1;
      view.pan.x = 20;
      view.pan.y = 20;
      applyTransform();
      commitView();
    }
  }

  function onNodeAction(el) {
    var act = el.getAttribute('data-nact');
    var nodeId = el.getAttribute('data-node');
    var project = Store.getProject();
    var node = Model.findNode(project, nodeId);
    if (!node) return;

    if (act === 'edit') {
      Store.setUi({ selectedNodeId: nodeId, view: 'list' });
      return;
    }
    if (act === 'dup') {
      Store.update(function (p, ui) {
        var copy = Model.duplicateNode(p, nodeId);
        if (copy) ui.selectedNodeId = copy.id;
      });
      return;
    }
    if (act === 'start') {
      Store.update(function (p) { Model.setStartNode(p, nodeId); });
      return;
    }
    if (act === 'del') {
      if (project.nodes.length <= 1) {
        global.alert('至少要保留一个节点。');
        return;
      }
      if (!global.confirm('确定删除节点「' + (node.title || '未命名') + '」吗？\n指向它的跳转会被清空。')) return;
      Store.update(function (p, ui) {
        Model.removeNode(p, nodeId);
        if (ui.selectedNodeId === nodeId) ui.selectedNodeId = p.meta.startNodeId;
      });
    }
  }

  var drag = null;

  function onPointerDown(e) {
    if (e.button !== 0) return;
    if (Util.closest(e.target, '[data-nact]')) return; // 让按钮自己处理点击

    var nodeEl = Util.closest(e.target, '[data-gnode]');
    if (nodeEl) {
      var nodeId = nodeEl.getAttribute('data-gnode');
      var node = Model.findNode(Store.getProject(), nodeId);
      if (!node) return;
      drag = { kind: 'node', el: nodeEl, nodeId: nodeId, startX: e.clientX, startY: e.clientY, x0: node.x, y0: node.y, moved: false };
    } else {
      drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, panX: view.pan.x, panY: view.pan.y, moved: false };
      viewport.classList.add('dragging');
    }
    if (e.pointerId !== undefined && viewport.setPointerCapture) {
      try { viewport.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    }
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(e) {
    if (!drag) return;
    var dx = e.clientX - drag.startX;
    var dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    drag.moved = true;
    if (drag.kind === 'pan') {
      view.pan.x = drag.panX + dx;
      view.pan.y = drag.panY + dy;
      applyTransform();
      return;
    }
    var wx = Math.round(drag.x0 + dx / view.zoom);
    var wy = Math.round(drag.y0 + dy / view.zoom);
    drag.wx = wx;
    drag.wy = wy;
    drag.el.style.left = wx + 'px';
    drag.el.style.top = wy + 'px';
  }

  function onPointerUp() {
    viewport.removeEventListener('pointermove', onPointerMove);
    viewport.removeEventListener('pointerup', onPointerUp);
    viewport.removeEventListener('pointercancel', onPointerUp);
    viewport.classList.remove('dragging');
    if (!drag) return;
    var info = drag;
    drag = null;

    if (!info.moved) {
      if (info.kind === 'node') Store.selectNode(info.nodeId);
      return;
    }
    if (info.kind === 'pan') {
      commitView();
      return;
    }
    Store.update(function (project) {
      var node = Model.findNode(project, info.nodeId);
      if (node) {
        node.x = info.wx;
        node.y = info.wy;
      }
    });
  }

  function onWheel(e) {
    e.preventDefault();
    var rect = viewport.getBoundingClientRect();
    var cx = e.clientX - rect.left;
    var cy = e.clientY - rect.top;
    var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    var next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
    if (Math.abs(next - view.zoom) < 0.0001) return;
    var wx = (cx - view.pan.x) / view.zoom;
    var wy = (cy - view.pan.y) / view.zoom;
    view.zoom = next;
    view.pan.x = cx - wx * next;
    view.pan.y = cy - wy * next;
    applyTransform();
    commitViewLazy();
  }

  function onDoubleClick(e) {
    var nodeEl = Util.closest(e.target, '[data-gnode]');
    if (!nodeEl) return;
    Store.setUi({ selectedNodeId: nodeEl.getAttribute('data-gnode'), view: 'list' });
  }

  global.ViewGraph = ViewGraph;
})(typeof window !== 'undefined' ? window : globalThis);
