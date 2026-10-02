/*!
 * editor/js/view-list.js — 列表视图：左侧节点列表 + 右侧节点编辑（选项/条件/效果/自动跳转）
 * 依赖：StoryEngine、Util、Model、CondUI、Store   挂载于 window.ViewList
 *
 * 交互约定：
 *   文本类字段用 data-field + input 事件 → 静默写数据（不重绘，避免打断中文输入法），
 *   失焦（change）时再重绘一次，用于刷新摘要与校验信息。
 *   结构化操作（增删选项、改条件、改下拉框）走 data-act / data-cact / data-eact，立即重绘。
 */
(function (global) {
  'use strict';

  var Engine = global.StoryEngine;
  var Util = global.Util;
  var Model = global.Model;
  var CondUI = global.CondUI;
  var Store = global.Store;
  var ViewList = {};

  var root = null;

  /* ----------------------------------------------------------- 挂载 */
  ViewList.mount = function (container) {
    root = container;
    Util.on(root, 'click', '[data-act]', onActionClick);
    Util.on(root, 'change', '[data-act]', onActionChange);
    Util.on(root, 'click', '[data-cact]', onConditionClick);
    Util.on(root, 'change', '[data-cact]', onConditionChange);
    Util.on(root, 'click', '[data-eact]', onEffectClick);
    Util.on(root, 'change', '[data-eact]', onEffectChange);
    Util.on(root, 'input', '[data-field]', onFieldInput);
    Util.on(root, 'change', '[data-field]', onFieldCommit);
  };

  function currentProject() { return Store.getProject(); }

  function targetLabel(project, nodeId) {
    var node = Model.findNode(project, nodeId);
    if (!node) return '（已失效的节点）';
    return '→ ' + (node.title || '未命名');
  }

  /* --------------------------------------------------------- 选项卡片 */
  function branchHtml(project, node, branch, index) {
    var ref = { loc: 'branch', nodeId: node.id, branchId: branch.id };
    var targetMissing = branch.target && !Model.findNode(project, branch.target);
    var condText = Engine.describeCondition(branch.condition, project);
    var effText = Engine.describeEffects(branch.effects, project);
    return '<div class="branch-card" data-loc="branch" data-node="' + Util.esc(node.id) +
      '" data-branch="' + Util.esc(branch.id) + '">' +
      '<div class="branch-head"><span>选项 ' + (index + 1) + '</span>' +
      '<span class="muted">' + Util.esc(branch.target ? targetLabel(project, branch.target) : '（未设置目标）') + '</span>' +
      '<span class="spacer"></span>' +
      '<button type="button" class="mini" title="上移" data-act="branch.up" data-branch="' + Util.esc(branch.id) + '">↑</button>' +
      '<button type="button" class="mini" title="下移" data-act="branch.down" data-branch="' + Util.esc(branch.id) + '">↓</button>' +
      '<button type="button" class="mini" title="复制该选项" data-act="branch.dup" data-branch="' + Util.esc(branch.id) + '">复制</button>' +
      '<button type="button" class="mini danger" title="删除该选项" data-act="branch.del" data-branch="' + Util.esc(branch.id) + '">删除</button>' +
      '</div>' +
      '<div class="grid2">' +
      '<input class="field" type="text" placeholder="玩家看到的选项文字" data-field="branch.text" data-focus="branch-text-' +
      Util.esc(branch.id) + '" data-branch="' + Util.esc(branch.id) + '" value="' + Util.esc(branch.text) + '">' +
      '<select class="field target-select' + (targetMissing ? ' dangling' : '') + '" data-act="branch.target" data-branch="' +
      Util.esc(branch.id) + '">' + Model.targetOptionsHtml(project, branch.target) + '</select>' +
      '</div>' +
      '<div class="logic-line">条件：<b>' + Util.esc(condText) + '</b> ｜ 效果：<b>' + Util.esc(effText || '无') + '</b>' +
      (targetMissing ? ' ｜ <b class="warn">目标节点已失效</b>' : '') + '</div>' +
      '<div class="sub"><div class="sub-title">显示条件</div>' + CondUI.conditionHtml(project, branch.condition, ref) + '</div>' +
      '<div class="sub"><div class="sub-title">执行效果</div>' + CondUI.effectsHtml(project, branch.effects, ref) + '</div>' +
      '</div>';
  }

  /* --------------------------------------------------------- 规则卡片 */
  function ruleHtml(project, node, rule, index) {
    var ref = { loc: 'rule', nodeId: node.id, ruleId: rule.id };
    var targetMissing = rule.target && !Model.findNode(project, rule.target);
    return '<div class="branch-card" data-loc="rule" data-node="' + Util.esc(node.id) +
      '" data-rule="' + Util.esc(rule.id) + '">' +
      '<div class="branch-head"><span>规则 ' + (index + 1) + '</span>' +
      '<span class="muted">' + (rule.condition ? '条件成立时跳转' : '否则（兜底）') + '</span>' +
      '<span class="spacer"></span>' +
      '<button type="button" class="mini" title="上移" data-act="rule.up" data-rule="' + Util.esc(rule.id) + '">↑</button>' +
      '<button type="button" class="mini" title="下移" data-act="rule.down" data-rule="' + Util.esc(rule.id) + '">↓</button>' +
      '<button type="button" class="mini danger" title="删除该规则" data-act="rule.del" data-rule="' + Util.esc(rule.id) + '">删除</button>' +
      '</div>' +
      '<div class="grid2">' +
      '<div class="muted">条件：' + Util.esc(rule.condition ? Engine.describeCondition(rule.condition, project) : '否则（无条件）') + '</div>' +
      '<select class="field target-select' + (targetMissing ? ' dangling' : '') + '" data-act="rule.target" data-rule="' +
      Util.esc(rule.id) + '">' + Model.targetOptionsHtml(project, rule.target) + '</select>' +
      '</div>' +
      '<div class="sub"><div class="sub-title">跳转条件</div>' + CondUI.conditionHtml(project, rule.condition, ref) + '</div>' +
      '</div>';
  }

  function renderNodeForm(project, node) {
    var idx = Model.findNodeIndex(project, node.id) + 1;
    var isStart = project.meta.startNodeId === node.id;
    var summary = Model.nodeSummary(project, node);
    var i;
    var html = '<div class="panel node-editor">';

    html += '<h2>节点编辑 <span class="muted">（第 ' + idx + ' / ' + project.nodes.length + ' 个）</span></h2>' +
      '<div class="hint">标题只在编辑器里用于管理，玩家看不到；正文支持换行，会原样出现在阅读器中。</div>';

    html += '<div class="card"><div class="row title-row">' +
      '<input class="field" type="text" placeholder="节点标题" data-field="node.title" data-focus="node-title" value="' +
      Util.esc(node.title) + '">' +
      (isStart
        ? '<span class="tag">★ 起始节点</span>'
        : '<button type="button" class="btn small" data-act="node.setStart">设为起始节点</button>') +
      '<span class="spacer"></span>' +
      '<span class="muted">' + node.text.length + ' 字</span>' +
      '</div>' +
      '<div class="row"><textarea class="field" rows="8" placeholder="正文内容…" data-field="node.text" data-focus="node-text">' +
      Util.esc(node.text) + '</textarea></div>' +
      '<div class="row">' +
      '<button type="button" class="btn small" data-act="node.preview">▶ 从这个节点试玩</button>' +
      '<button type="button" class="btn small" data-act="node.gotoGraph">在节点图中查看</button>' +
      '<button type="button" class="btn small" data-act="node.duplicate">复制节点</button>' +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn small danger" data-act="node.delete">删除节点</button>' +
      '</div>' +
      (summary.isEnding ? '<div class="logic-line">当前节点没有任何后继，因此它就是<b>结局节点</b>。</div>' : '') +
      '</div>';

    html += '<div class="card"><div class="card-head">' +
      '<span class="name">选项（' + node.branches.length + '）</span>' +
      '<span class="muted">条件不满足的选项对玩家隐藏；全部不满足时才走「自动跳转」</span>' +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn small" data-act="branch.add">+ 添加选项</button>' +
      '</div>';
    if (!node.branches.length) html += '<div class="empty">没有选项。若同时没有自动跳转，本节点就是结局。</div>';
    for (i = 0; i < node.branches.length; i++) html += branchHtml(project, node, node.branches[i], i);
    html += '</div>';

    html += '<div class="card"><div class="card-head">' +
      '<span class="name">自动跳转（' + node.autoRules.length + '）</span>' +
      '<span class="muted">仅当没有任何选项可用时才生效；按顺序取第一条命中的规则，条件留空表示「否则」</span>' +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn small" data-act="rule.add">+ 添加自动跳转</button>' +
      '</div>';
    if (!node.autoRules.length) html += '<div class="empty">没有自动跳转规则（需要「条件跳转」时在这里添加）。</div>';
    for (i = 0; i < node.autoRules.length; i++) html += ruleHtml(project, node, node.autoRules[i], i);
    html += '</div>';

    html += '</div>';
    return html;
  }

  ViewList.render = function () {
    if (!root) return;
    var project = currentProject();
    var ui = Store.getUi();
    var node = Model.findNode(project, ui.selectedNodeId);
    Util.withFocus(root, function () {
      if (!node) {
        root.innerHTML = '<div class="panel"><div class="empty">请先在左侧选择一个节点，或点击「+ 新建节点」。</div></div>';
        return;
      }
      root.innerHTML = renderNodeForm(project, node);
    });
    autoGrowAll();
  };

  function autoGrowAll() {
    var areas = Util.qsa(root, 'textarea');
    for (var i = 0; i < areas.length; i++) {
      areas[i].style.height = 'auto';
      areas[i].style.height = (areas[i].scrollHeight + 2) + 'px';
    }
  }

  /* --------------------------------------------------------- 事件处理 */
  function selectedNode(project) {
    return Model.findNode(project, Store.getUi().selectedNodeId);
  }

  function onActionClick(el) {
    var act = el.getAttribute('data-act');
    var branchId = el.getAttribute('data-branch');
    var ruleId = el.getAttribute('data-rule');

    if (act === 'node.setStart') {
      Store.update(function (project, ui) { Model.setStartNode(project, ui.selectedNodeId); });
      return;
    }
    if (act === 'node.duplicate') {
      Store.update(function (project, ui) {
        var copy = Model.duplicateNode(project, ui.selectedNodeId);
        if (copy) ui.selectedNodeId = copy.id;
      });
      return;
    }
    if (act === 'node.delete') {
      var project = currentProject();
      var node = selectedNode(project);
      if (!node) return;
      if (project.nodes.length <= 1) {
        global.alert('至少要保留一个节点。');
        return;
      }
      if (!global.confirm('确定删除节点「' + (node.title || '未命名') + '」吗？\n指向它的跳转会被清空。')) return;
      Store.update(function (p, ui) {
        Model.removeNode(p, node.id);
        ui.selectedNodeId = p.meta.startNodeId;
      });
      return;
    }
    if (act === 'node.gotoGraph') {
      Store.setUi({ view: 'graph' });
      return;
    }
    if (act === 'node.preview') {
      var current = selectedNode(currentProject());
      if (current) global.ViewPreview.open(current.id);
      return;
    }

    if (act === 'branch.add') {
      Store.update(function (p, ui) {
        var target = selectedNode(p);
        if (target) Model.addBranch(p, target);
      });
      return;
    }
    if (act === 'branch.up' || act === 'branch.down') {
      var delta = act === 'branch.up' ? -1 : 1;
      Store.update(function (p, ui) {
        var target = selectedNode(p);
        if (target) Model.moveItemById(target.branches, branchId, delta);
      });
      return;
    }
    if (act === 'branch.dup') {
      Store.update(function (p, ui) {
        var target = selectedNode(p);
        if (target) Model.duplicateBranch(target, branchId);
      });
      return;
    }
    if (act === 'branch.del') {
      if (!global.confirm('确定删除这个选项吗？')) return;
      Store.update(function (p, ui) {
        var target = selectedNode(p);
        if (target) Model.removeBranch(target, branchId);
      });
      return;
    }

    if (act === 'rule.add') {
      Store.update(function (p, ui) {
        var target = selectedNode(p);
        if (target) Model.addRule(p, target);
      });
      return;
    }
    if (act === 'rule.up' || act === 'rule.down') {
      var rdelta = act === 'rule.up' ? -1 : 1;
      Store.update(function (p, ui) {
        var target = selectedNode(p);
        if (target) Model.moveItemById(target.autoRules, ruleId, rdelta);
      });
      return;
    }
    if (act === 'rule.del') {
      if (!global.confirm('确定删除这条自动跳转吗？')) return;
      Store.update(function (p, ui) {
        var target = selectedNode(p);
        if (target) Model.removeRule(target, ruleId);
      });
    }
  }

  function onActionChange(el) {
    var act = el.getAttribute('data-act');
    var branchId = el.getAttribute('data-branch');
    var ruleId = el.getAttribute('data-rule');
    if (act === 'branch.target') {
      Store.update(function (p, ui) {
        var node = selectedNode(p);
        if (!node) return;
        var branch = Model.findBranch(p, node.id, branchId);
        if (branch) branch.target = el.value;
      });
      return;
    }
    if (act === 'rule.target') {
      Store.update(function (p, ui) {
        var node = selectedNode(p);
        if (!node) return;
        for (var i = 0; i < node.autoRules.length; i++) {
          if (node.autoRules[i].id === ruleId) node.autoRules[i].target = el.value;
        }
      });
    }
  }

  function onConditionClick(el) { applyCondition(el); }
  function onConditionChange(el) { applyCondition(el); }

  function applyCondition(el) {
    var ref = CondUI.refFrom(el);
    if (!ref) return;
    Store.update(function (p) { CondUI.applyConditionAction(p, ref, el); });
  }

  function onEffectClick(el) { applyEffect(el); }
  function onEffectChange(el) { applyEffect(el); }

  function applyEffect(el) {
    var ref = CondUI.refFrom(el);
    if (!ref) return;
    Store.update(function (p) { CondUI.applyEffectAction(p, ref, el); });
  }

  /* 文本字段：静默更新（不重绘），避免打断中文输入法 */
  function onFieldInput(el) {
    var spec = el.getAttribute('data-field');
    var branchId = el.getAttribute('data-branch');
    Store.update(function (p, ui) {
      var node = selectedNode(p);
      if (!node) return;
      if (spec === 'node.title') {
        node.title = el.value;
        updateSidebarLabel(node.id, el.value);
      } else if (spec === 'node.text') {
        node.text = el.value;
        Util.autoGrow(el);
      } else if (spec === 'branch.text') {
        var branch = Model.findBranch(p, node.id, branchId);
        if (branch) branch.text = el.value;
      }
    }, { silent: true });
  }

  /* 失焦时重绘一次，刷新摘要、校验与侧栏 */
  function onFieldCommit() {
    Store.update(function () { /* 仅触发重绘与保存 */ });
  }

  /* ----------------------------------------------------------- 侧栏列表 */
  var listEl = null;
  var countEl = null;
  /* 一次最多渲染的节点数：上千节点时避免整表重绘卡顿，超出部分靠搜索过滤 */
  var MAX_SIDEBAR_ITEMS = 300;

  ViewList.mountSidebar = function (nodeListEl, nodeCountEl) {
    listEl = nodeListEl;
    countEl = nodeCountEl;
    Util.on(listEl, 'click', '[data-sact]', onSidebarAction);
    Util.on(listEl, 'click', '.node-item', onSidebarSelect);
  };

  function sidebarItemHtml(project, node, ui) {
    var summary = Model.nodeSummary(project, node);
    var cls = 'node-item';
    if (node.id === ui.selectedNodeId) cls += ' active';
    if (summary.isStart) cls += ' is-start';
    if (summary.isEnding) cls += ' is-ending';
    var meta = [];
    if (summary.choiceCount) meta.push('选项 ' + summary.choiceCount);
    if (summary.ruleCount) meta.push('↳ 自动跳转 ' + summary.ruleCount);
    if (summary.isEnding) meta.push('◼ 结局');
    if (!meta.length) meta.push('无后继');
    return '<div class="' + cls + '" data-sid="' + Util.esc(node.id) + '">' +
      '<div class="row1">' +
      '<span class="title" data-node-label="' + Util.esc(node.id) + '">' + Util.esc(node.title || '未命名') + '</span>' +
      (summary.isStart ? '<span class="star" title="起始节点">★</span>' : '') +
      '<span class="spacer"></span>' +
      '<span class="item-tools">' +
      '<button type="button" class="mini" title="设为起始节点" data-sact="start" data-sid="' + Util.esc(node.id) + '">★</button>' +
      '<button type="button" class="mini" title="复制节点" data-sact="dup" data-sid="' + Util.esc(node.id) + '">复制</button>' +
      '<button type="button" class="mini" title="在节点图中定位" data-sact="graph" data-sid="' + Util.esc(node.id) + '">图</button>' +
      '<button type="button" class="mini danger" title="删除节点" data-sact="del" data-sid="' + Util.esc(node.id) + '">×</button>' +
      '</span>' +
      '</div>' +
      '<div class="excerpt">' + Util.esc(Util.truncate(node.text, 40) || '（空正文）') + '</div>' +
      '<div class="meta">' + meta.map(function (t) { return '<span>' + Util.esc(t) + '</span>'; }).join('') + '</div>' +
      '</div>';
  }

  ViewList.renderSidebar = function () {
    if (!listEl) return;
    var project = currentProject();
    var ui = Store.getUi();
    var matched = Model.filterNodes(project, ui.search);

    var visible = matched;
    var hidden = 0;
    if (matched.length > MAX_SIDEBAR_ITEMS) {
      visible = matched.slice(0, MAX_SIDEBAR_ITEMS);
      hidden = matched.length - visible.length;
      // 保证当前选中的节点一定出现在列表里（即使它落在被截断的区间）
      for (var h = MAX_SIDEBAR_ITEMS; h < matched.length; h++) {
        if (matched[h].id !== ui.selectedNodeId) continue;
        visible.unshift(matched[h]);
        hidden--;
        break;
      }
    }

    var html = '';
    for (var i = 0; i < visible.length; i++) html += sidebarItemHtml(project, visible[i], ui);
    if (!matched.length) {
      html = '<div class="empty">没有匹配的节点。</div>';
    } else if (hidden > 0) {
      html += '<div class="empty">为保持流畅，这里只列出前 ' + MAX_SIDEBAR_ITEMS + ' 个节点，' +
        '还有 ' + hidden + ' 个未显示，请用上方搜索框过滤。</div>';
    }
    listEl.innerHTML = html;
    if (countEl) {
      countEl.textContent = '共 ' + project.nodes.length + ' 个节点' +
        (ui.search ? '，匹配 ' + matched.length + ' 个' : '');
    }
  };

  function updateSidebarLabel(nodeId, title) {
    if (!listEl) return;
    var el = listEl.querySelector('[data-node-label="' + nodeId.replace(/"/g, '\\"') + '"]');
    if (el) el.textContent = title || '未命名';
  }

  function onSidebarSelect(el, e) {
    if (Util.closest(e.target, '[data-sact]')) return;
    Store.selectNode(el.getAttribute('data-sid'));
  }

  function onSidebarAction(el) {
    var act = el.getAttribute('data-sact');
    var nodeId = el.getAttribute('data-sid');
    var project = currentProject();
    var node = Model.findNode(project, nodeId);
    if (!node) return;

    if (act === 'start') {
      Store.update(function (p) { Model.setStartNode(p, nodeId); });
      return;
    }
    if (act === 'dup') {
      Store.update(function (p, ui) {
        var copy = Model.duplicateNode(p, nodeId);
        if (copy) ui.selectedNodeId = copy.id;
      });
      return;
    }
    if (act === 'graph') {
      Store.setUi({ selectedNodeId: nodeId, view: 'graph', focusNodeId: nodeId });
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

  global.ViewList = ViewList;
})(typeof window !== 'undefined' ? window : globalThis);
