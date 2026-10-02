/*!
 * editor/js/model.js — 编辑器侧的数据操作（节点增删改、自动布局、变量维护）
 * 依赖：window.StoryEngine、window.Util   挂载于 window.Model
 */
(function (global) {
  'use strict';

  var Engine = global.StoryEngine;
  var Util = global.Util;
  var Model = {};

  var GAP_X = 280;
  var GAP_Y = 150;
  var ORIGIN_X = 60;
  var ORIGIN_Y = 60;

  /* ------------------------------------------------------------ 查询工具 */
  Model.findNode = function (project, nodeId) {
    for (var i = 0; i < project.nodes.length; i++) {
      if (project.nodes[i].id === nodeId) return project.nodes[i];
    }
    return null;
  };

  Model.findNodeIndex = function (project, nodeId) {
    for (var i = 0; i < project.nodes.length; i++) {
      if (project.nodes[i].id === nodeId) return i;
    }
    return -1;
  };

  Model.findBranch = function (project, nodeId, branchId) {
    var node = Model.findNode(project, nodeId);
    if (!node) return null;
    for (var i = 0; i < node.branches.length; i++) {
      if (node.branches[i].id === branchId) return node.branches[i];
    }
    return null;
  };

  Model.findVariable = function (project, varId) {
    for (var i = 0; i < project.variables.length; i++) {
      if (project.variables[i].id === varId) return project.variables[i];
    }
    return null;
  };

  /** 节点摘要，用于列表与图视图的徽标 */
  Model.nodeSummary = function (project, node) {
    return {
      isStart: project.meta.startNodeId === node.id,
      isEnding: node.branches.length === 0 && node.autoRules.length === 0,
      choiceCount: node.branches.length,
      ruleCount: node.autoRules.length
    };
  };

  /* ------------------------------------------------------------ 节点操作 */
  /** 找一个不与现有节点重叠的坐标（网格排布） */
  Model.nextPosition = function (project) {
    var n = project.nodes.length;
    var perRow = 4;
    return {
      x: ORIGIN_X + (n % perRow) * GAP_X,
      y: ORIGIN_Y + Math.floor(n / perRow) * GAP_Y
    };
  };

  Model.addNode = function (project, opts) {
    opts = opts || {};
    var pos = Model.nextPosition(project);
    var node = Engine.createNode({
      title: opts.title || '新节点',
      text: '',
      x: pos.x,
      y: pos.y
    });
    project.nodes.push(node);
    return node;
  };

  /** 复制节点（含全部选项与自动跳转，全部重新生成 id） */
  Model.duplicateNode = function (project, nodeId) {
    var src = Model.findNode(project, nodeId);
    if (!src) return null;
    var copy = Engine.createNode({
      title: (src.title || '未命名') + ' 副本',
      text: src.text,
      x: src.x + 40,
      y: src.y + 40
    });
    for (var b = 0; b < src.branches.length; b++) {
      copy.branches.push(Engine.createBranch({
        text: src.branches[b].text,
        target: src.branches[b].target,
        condition: Util.clone(src.branches[b].condition),
        effects: Util.clone(src.branches[b].effects)
      }));
    }
    for (var r = 0; r < src.autoRules.length; r++) {
      copy.autoRules.push(Engine.createAutoRule({
        condition: Util.clone(src.autoRules[r].condition),
        target: src.autoRules[r].target
      }));
    }
    project.nodes.splice(Model.findNodeIndex(project, nodeId) + 1, 0, copy);
    return copy;
  };

  /** 删除节点，并把指向它的跳转清空（避免出现悬空跳转） */
  Model.removeNode = function (project, nodeId) {
    var idx = Model.findNodeIndex(project, nodeId);
    if (idx < 0 || project.nodes.length <= 1) return false;
    project.nodes.splice(idx, 1);
    for (var i = 0; i < project.nodes.length; i++) {
      var node = project.nodes[i];
      for (var b = 0; b < node.branches.length; b++) {
        if (node.branches[b].target === nodeId) node.branches[b].target = '';
      }
      for (var r = 0; r < node.autoRules.length; r++) {
        if (node.autoRules[r].target === nodeId) node.autoRules[r].target = '';
      }
    }
    if (project.meta.startNodeId === nodeId) project.meta.startNodeId = project.nodes[0].id;
    return true;
  };

  Model.setStartNode = function (project, nodeId) {
    if (!Model.findNode(project, nodeId)) return false;
    project.meta.startNodeId = nodeId;
    return true;
  };

  /** 统计有多少条跳转指向该节点 */
  Model.countIncoming = function (project, nodeId) {
    var count = 0;
    for (var i = 0; i < project.nodes.length; i++) {
      var node = project.nodes[i];
      for (var b = 0; b < node.branches.length; b++) if (node.branches[b].target === nodeId) count++;
      for (var r = 0; r < node.autoRules.length; r++) if (node.autoRules[r].target === nodeId) count++;
    }
    return count;
  };

  /* ------------------------------------------------------------ 自动布局 */
  /** BFS 分层自动布局：起点在左，后继在右 */
  Model.autoLayout = function (project) {
    var index = {};
    var i;
    for (i = 0; i < project.nodes.length; i++) index[project.nodes[i].id] = project.nodes[i];

    var level = {};
    var order = [];
    var queue = [];
    var startId = project.meta.startNodeId;
    if (index[startId]) {
      level[startId] = 0;
      queue.push(startId);
    } else if (project.nodes.length) {
      level[project.nodes[0].id] = 0;
      queue.push(project.nodes[0].id);
    }
    while (queue.length) {
      var curId = queue.shift();
      var cur = index[curId];
      order.push(curId);
      var targets = [];
      for (i = 0; i < cur.branches.length; i++) targets.push(cur.branches[i].target);
      for (i = 0; i < cur.autoRules.length; i++) targets.push(cur.autoRules[i].target);
      for (i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!t || !index[t] || level[t] !== undefined) continue;
        level[t] = (level[curId] || 0) + 1;
        queue.push(t);
      }
    }

    // 不可达节点放到最后一列
    var maxLevel = 0;
    for (i = 0; i < order.length; i++) maxLevel = Math.max(maxLevel, level[order[i]] || 0);
    var orphans = [];
    for (i = 0; i < project.nodes.length; i++) {
      if (level[project.nodes[i].id] === undefined) orphans.push(project.nodes[i].id);
    }
    for (i = 0; i < orphans.length; i++) level[orphans[i]] = maxLevel + 1 + Math.floor(i / 4);

    var sequence = order.concat(orphans);
    for (i = 0; i < project.nodes.length; i++) {
      var id = project.nodes[i].id;
      if (sequence.indexOf(id) < 0) sequence.push(id);
    }
    var cursor = {};
    for (i = 0; i < sequence.length; i++) {
      var node = index[sequence[i]];
      if (!node) continue;
      var lv = level[sequence[i]] || 0;
      cursor[lv] = cursor[lv] === undefined ? 0 : cursor[lv] + 1;
      node.x = ORIGIN_X + lv * GAP_X;
      node.y = ORIGIN_Y + cursor[lv] * GAP_Y;
    }
    return project;
  };

  /** 计算「适应窗口」的缩放与平移 */
  Model.fitTransform = function (project, viewportWidth, viewportHeight) {
    if (!project.nodes.length) return { zoom: 1, pan: { x: 0, y: 0 } };
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    var CARD_W = 200;
    var CARD_H = 90;
    for (var i = 0; i < project.nodes.length; i++) {
      var n = project.nodes[i];
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + CARD_W);
      maxY = Math.max(maxY, n.y + CARD_H);
    }
    var pad = 40;
    var w = Math.max(1, maxX - minX);
    var h = Math.max(1, maxY - minY);
    var zoom = Math.min(1.2, Math.max(0.35, Math.min((viewportWidth - pad * 2) / w, (viewportHeight - pad * 2) / h)));
    return { zoom: zoom, pan: { x: pad - minX * zoom, y: pad - minY * zoom } };
  };

  /* ------------------------------------------------------- 选项 / 自动跳转 */
  Model.addBranch = function (project, node, targetId) {
    var branch = Engine.createBranch({ text: '新选项', target: targetId || '' });
    node.branches.push(branch);
    return branch;
  };

  Model.addRule = function (project, node, targetId) {
    var rule = Engine.createAutoRule({ condition: null, target: targetId || '' });
    node.autoRules.push(rule);
    return rule;
  };

  Model.duplicateBranch = function (node, branchId) {
    for (var i = 0; i < node.branches.length; i++) {
      if (node.branches[i].id !== branchId) continue;
      var src = node.branches[i];
      var copy = Engine.createBranch({
        text: src.text,
        target: src.target,
        condition: Util.clone(src.condition),
        effects: Util.clone(src.effects)
      });
      node.branches.splice(i + 1, 0, copy);
      return copy;
    }
    return null;
  };

  Model.removeBranch = function (node, branchId) {
    for (var i = 0; i < node.branches.length; i++) {
      if (node.branches[i].id === branchId) {
        node.branches.splice(i, 1);
        return true;
      }
    }
    return false;
  };

  Model.removeRule = function (node, ruleId) {
    for (var i = 0; i < node.autoRules.length; i++) {
      if (node.autoRules[i].id === ruleId) {
        node.autoRules.splice(i, 1);
        return true;
      }
    }
    return false;
  };

  Model.moveItemById = function (list, id, delta) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return Util.moveItem(list, i, delta);
    }
    return false;
  };

  /* ------------------------------------------------------------ 变量维护 */
  Model.addVariable = function (project) {
    var seq = project.variables.length + 1;
    var exists = {};
    var i;
    for (i = 0; i < project.variables.length; i++) exists[project.variables[i].name] = true;
    var name = '变量' + seq;
    while (exists[name]) name = '变量' + (++seq);
    var variable = Engine.createVariable({ name: name, type: 'number', initial: 0 });
    project.variables.push(variable);
    return variable;
  };

  function cleanCondition(cond, varId) {
    if (!cond) return cond;
    if (cond.type === 'group') {
      var items = [];
      for (var i = 0; i < cond.items.length; i++) {
        var next = cleanCondition(cond.items[i], varId);
        if (next) items.push(next);
      }
      cond.items = items;
      return cond;
    }
    return cond.varId === varId ? null : cond;
  }

  /** 删除变量，并清理所有引用它的条件与效果（避免脏数据） */
  Model.removeVariable = function (project, varId) {
    var idx = -1;
    var i;
    for (i = 0; i < project.variables.length; i++) {
      if (project.variables[i].id === varId) idx = i;
    }
    if (idx < 0) return false;
    project.variables.splice(idx, 1);
    for (var n = 0; n < project.nodes.length; n++) {
      var node = project.nodes[n];
      for (var b = 0; b < node.branches.length; b++) {
        node.branches[b].condition = cleanCondition(node.branches[b].condition, varId);
        var effects = [];
        for (var e = 0; e < node.branches[b].effects.length; e++) {
          if (node.branches[b].effects[e].varId !== varId) effects.push(node.branches[b].effects[e]);
        }
        node.branches[b].effects = effects;
      }
      for (var r = 0; r < node.autoRules.length; r++) {
        node.autoRules[r].condition = cleanCondition(node.autoRules[r].condition, varId);
      }
    }
    return true;
  };

  /** 改变变量类型时同步修正相关条件与效果，避免出现无效运算符 */
  Model.retypeVariable = function (project, varId, type) {
    var variable = Model.findVariable(project, varId);
    if (!variable) return;
    variable.type = type === 'bool' ? 'bool' : 'number';
    variable.initial = variable.type === 'bool' ? !!variable.initial : Number(variable.initial) || 0;

    function fixCondition(cond) {
      if (!cond) return;
      if (cond.type === 'group') {
        for (var i = 0; i < cond.items.length; i++) fixCondition(cond.items[i]);
        return;
      }
      if (cond.varId !== varId) return;
      if (variable.type === 'bool') {
        if (cond.op !== '==' && cond.op !== '!=') cond.op = '==';
        cond.value = cond.value === true || cond.value === 'true' || cond.value === 1;
      } else {
        cond.value = Number(cond.value) || 0;
      }
    }

    for (var n = 0; n < project.nodes.length; n++) {
      var node = project.nodes[n];
      for (var b = 0; b < node.branches.length; b++) {
        fixCondition(node.branches[b].condition);
        for (var e = 0; e < node.branches[b].effects.length; e++) {
          var effect = node.branches[b].effects[e];
          if (effect.varId !== varId) continue;
          if (variable.type === 'bool') {
            effect.op = 'set';
            effect.value = !!effect.value;
          } else {
            effect.value = Number(effect.value) || 0;
          }
        }
      }
      for (var r = 0; r < node.autoRules.length; r++) fixCondition(node.autoRules[r].condition);
    }
  };

  /** 变量名是否与其它变量重复 */
  Model.isDuplicateName = function (project, varId, name) {
    var target = String(name || '').trim();
    for (var i = 0; i < project.variables.length; i++) {
      if (project.variables[i].id !== varId && String(project.variables[i].name).trim() === target) return true;
    }
    return false;
  };

  /* ------------------------------------------------------------ 搜索过滤 */
  Model.filterNodes = function (project, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return project.nodes.slice();
    var out = [];
    for (var i = 0; i < project.nodes.length; i++) {
      var node = project.nodes[i];
      var branchText = '';
      for (var b = 0; b < node.branches.length; b++) branchText += node.branches[b].text + '\n';
      var hay = (node.title + '\n' + node.text + '\n' + branchText).toLowerCase();
      if (hay.indexOf(q) >= 0) out.push(node);
    }
    return out;
  };

  /* -------------------------------------------------------- 下拉框 HTML */
  /** 目标节点下拉框（含「未设置」选项） */
  Model.targetOptionsHtml = function (project, selectedId) {
    var html = '<option value="">（未设置目标）</option>';
    for (var i = 0; i < project.nodes.length; i++) {
      var node = project.nodes[i];
      var label = (i + 1) + '. ' + (node.title || '未命名');
      html += '<option value="' + Util.esc(node.id) + '"' + (node.id === selectedId ? ' selected' : '') + '>' +
        Util.esc(label) + '</option>';
    }
    if (selectedId && !Model.findNode(project, selectedId)) {
      html += '<option value="' + Util.esc(selectedId) + '" selected>（已失效的节点）</option>';
    }
    return html;
  };

  Model.variableOptionsHtml = function (project, selectedId) {
    var html = '';
    for (var i = 0; i < project.variables.length; i++) {
      var v = project.variables[i];
      html += '<option value="' + Util.esc(v.id) + '"' + (v.id === selectedId ? ' selected' : '') + '>' +
        Util.esc(v.name) + '（' + (v.type === 'bool' ? '布尔' : '数字') + '）</option>';
    }
    if (!project.variables.length) html = '<option value="">（还没有变量）</option>';
    return html;
  };

  global.Model = Model;
})(typeof window !== 'undefined' ? window : globalThis);
