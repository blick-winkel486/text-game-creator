/*!
 * editor/js/condition-ui.js — 条件（AST）与效果的结构化编辑控件
 * 依赖：window.StoryEngine、window.Util、window.Model   挂载于 window.CondUI
 *
 * 控件通过 data-* 属性描述动作，由视图层委托处理：
 *   data-cact="..." / data-eact="..."  动作名
 *   data-path="[0,1]"                  条件在 AST 中的位置（根为 []）
 *   data-val / data-op / data-idx      参数
 * 引用信息（loc/node/branch/rule）放在包含它的卡片元素上，由 CondUI.refFrom 读取。
 */
(function (global) {
  'use strict';

  var Engine = global.StoryEngine;
  var Util = global.Util;
  var Model = global.Model;
  var CondUI = {};

  var MAX_DEPTH = 3; // 条件嵌套层数上限，避免结构过深难以阅读
  var CMP_OPS = ['==', '!=', '>', '>=', '<', '<='];

  /* ---------------------------------------------------- 引用（loc/ref） */
  CondUI.refFrom = function (el) {
    var card = Util.closest(el, '[data-loc]');
    if (!card) return null;
    return {
      loc: card.getAttribute('data-loc'),
      nodeId: card.getAttribute('data-node'),
      branchId: card.getAttribute('data-branch'),
      ruleId: card.getAttribute('data-rule')
    };
  };

  CondUI.refAttrs = function (ref) {
    return ' data-loc="' + Util.esc(ref.loc) + '" data-node="' + Util.esc(ref.nodeId) + '"' +
      (ref.branchId ? ' data-branch="' + Util.esc(ref.branchId) + '"' : '') +
      (ref.ruleId ? ' data-rule="' + Util.esc(ref.ruleId) + '"' : '');
  };

  function getConditionRoot(project, ref) {
    if (!ref) return null;
    if (ref.loc === 'branch') {
      var branch = Model.findBranch(project, ref.nodeId, ref.branchId);
      return branch ? { owner: branch, key: 'condition' } : null;
    }
    var node = Model.findNode(project, ref.nodeId);
    if (!node) return null;
    for (var i = 0; i < node.autoRules.length; i++) {
      if (node.autoRules[i].id === ref.ruleId) return { owner: node.autoRules[i], key: 'condition' };
    }
    return null;
  }

  function getEffectsRoot(project, ref) {
    if (!ref || ref.loc !== 'branch') return null;
    var branch = Model.findBranch(project, ref.nodeId, ref.branchId);
    return branch ? branch.effects : null;
  }

  function parsePath(pathText) {
    if (!pathText) return [];
    try {
      var arr = JSON.parse(pathText);
      return Object.prototype.toString.call(arr) === '[object Array]' ? arr : [];
    } catch (e) {
      return [];
    }
  }

  /** 根据路径取出 { parent, node, key }；path 为空表示根节点 */
  function locate(root, path) {
    var node = root;
    var parent = null;
    var key = null;
    for (var i = 0; i < path.length; i++) {
      if (!node || !node.items) return { parent: null, node: null, key: null };
      parent = node;
      key = path[i];
      node = node.items[key];
    }
    return { parent: parent, node: node, key: key };
  }

  /** 组里只剩一项时去掉多余层级；空了则视为无条件 */
  function normGroup(group) {
    if (!group || !group.items) return group;
    if (group.items.length === 1) return group.items[0];
    if (group.items.length === 0) return null;
    return group;
  }

  function childPathText(pathText, index) {
    if (pathText === '[]') return '[' + index + ']';
    return pathText.slice(0, -1) + ',' + index + ']';
  }

  /* --------------------------------------------------------- 条件渲染 */
  function valueControlHtml(project, cond, pathText) {
    var def = Model.findVariable(project, cond.varId);
    if (def && def.type === 'bool') {
      return '<select class="field" style="width:120px" data-cact="set-value" data-path="' + Util.esc(pathText) + '">' +
        '<option value="true"' + (cond.value === true ? ' selected' : '') + '>true（真）</option>' +
        '<option value="false"' + (cond.value !== true ? ' selected' : '') + '>false（假）</option>' +
        '</select>';
    }
    return '<input class="field" type="number" step="any" style="width:110px" data-cact="set-value" data-path="' +
      Util.esc(pathText) + '" value="' + Util.esc(String(Number(cond.value) || 0)) + '">';
  }

  function cmpHtml(project, cond, pathText) {
    var def = Model.findVariable(project, cond.varId);
    var ops = def && def.type === 'bool' ? ['==', '!='] : CMP_OPS;
    var opHtml = '';
    for (var i = 0; i < ops.length; i++) {
      opHtml += '<option value="' + ops[i] + '"' + (cond.op === ops[i] ? ' selected' : '') + '>' + ops[i] + '</option>';
    }
    return '<div class="cond cond-cmp"><div class="cond-head">' +
      '<select class="field" data-cact="set-var" data-path="' + Util.esc(pathText) + '">' +
      Model.variableOptionsHtml(project, cond.varId) +
      '</select>' +
      '<select class="field" style="width:80px" data-cact="set-op" data-path="' + Util.esc(pathText) + '">' + opHtml + '</select>' +
      valueControlHtml(project, cond, pathText) +
      '<span class="spacer"></span>' +
      '<button type="button" class="mini danger" title="删除该条件" data-cact="del" data-path="' + Util.esc(pathText) + '">×</button>' +
      '</div></div>';
  }

  function groupHtml(project, group, pathText, depth) {
    var isAny = group.op === 'any';
    var html = '<div class="cond cond-group"><div class="cond-head">' +
      '<span class="op-badge">' + (isAny ? '或' : '且') + '</span>' +
      '<select class="field" style="width:100px" data-cact="set-group-op" data-path="' + Util.esc(pathText) + '">' +
      '<option value="all"' + (isAny ? '' : ' selected') + '>满足全部</option>' +
      '<option value="any"' + (isAny ? ' selected' : '') + '>满足任一</option>' +
      '</select>' +
      '<button type="button" class="mini" data-cact="add-cmp" data-path="' + Util.esc(pathText) + '">+ 条件</button>' +
      (depth < MAX_DEPTH
        ? '<button type="button" class="mini" data-cact="add-group" data-path="' + Util.esc(pathText) + '">+ 子组</button>'
        : '') +
      '<span class="spacer"></span>' +
      '<button type="button" class="mini danger" title="删除该条件组" data-cact="del" data-path="' + Util.esc(pathText) + '">×</button>' +
      '</div><div class="cond-items">';
    if (!group.items.length) html += '<div class="empty">（空条件组 = 无条件通过）</div>';
    for (var i = 0; i < group.items.length; i++) {
      html += nodeHtml(project, group.items[i], childPathText(pathText, i), depth + 1);
    }
    html += '</div></div>';
    return html;
  }

  function nodeHtml(project, cond, pathText, depth) {
    if (!cond) return '';
    if (cond.type === 'group') return groupHtml(project, cond, pathText, depth);
    return cmpHtml(project, cond, pathText);
  }

  /** 条件的编辑界面；condition 为 null 时显示「无条件 + 添加条件」 */
  CondUI.conditionHtml = function (project, condition, ref) {
    var attrs = CondUI.refAttrs(ref);
    if (!project.variables.length) {
      return '<div class="empty"' + attrs + '>还没有变量，无法设置条件。请先到「变量」面板添加变量。</div>';
    }
    if (!condition) {
      return '<div class="row"' + attrs + '>' +
        '<span class="muted">无条件（总是可用）</span><span class="spacer"></span>' +
        '<button type="button" class="mini" data-cact="add-cmp" data-path="[]">+ 添加条件</button>' +
        '</div>';
    }
    return '<div' + attrs + '>' + nodeHtml(project, condition, '[]', 1) + '</div>';
  };

  /* --------------------------------------------------------- 效果渲染 */
  function effectRowHtml(project, effect, index) {
    var def = Model.findVariable(project, effect.varId);
    var isBool = def && def.type === 'bool';
    var opHtml;
    if (isBool) {
      opHtml = '<option value="set" selected>设为</option>';
    } else {
      opHtml = '<option value="set"' + (effect.op === 'set' ? ' selected' : '') + '>设为</option>' +
        '<option value="add"' + (effect.op === 'add' ? ' selected' : '') + '>加上</option>' +
        '<option value="sub"' + (effect.op === 'sub' ? ' selected' : '') + '>减去</option>';
    }
    var valueHtml;
    if (isBool) {
      valueHtml = '<select class="field" style="width:96px" data-eact="set-value" data-idx="' + index + '">' +
        '<option value="true"' + (effect.value === true ? ' selected' : '') + '>真</option>' +
        '<option value="false"' + (effect.value !== true ? ' selected' : '') + '>假</option>' +
        '</select>';
    } else {
      valueHtml = '<input class="field" type="number" step="any" style="width:96px" data-eact="set-value" data-idx="' +
        index + '" value="' + Util.esc(String(Number(effect.value) || 0)) + '">';
    }
    return '<div class="eff"><div class="cond-head">' +
      '<select class="field" data-eact="set-var" data-idx="' + index + '">' +
      Model.variableOptionsHtml(project, effect.varId) +
      '</select>' +
      '<select class="field" style="width:80px" data-eact="set-op" data-idx="' + index + '">' + opHtml + '</select>' +
      valueHtml +
      '<span class="spacer"></span>' +
      '<button type="button" class="mini danger" title="删除该操作" data-eact="del" data-idx="' + index + '">×</button>' +
      '</div></div>';
  }

  CondUI.effectsHtml = function (project, effects, ref) {
    var html = '<div' + CondUI.refAttrs(ref) + '>';
    if (!project.variables.length) {
      html += '<div class="empty">还没有变量，无法设置效果。请先到「变量」面板添加变量。</div>';
    } else {
      for (var i = 0; i < effects.length; i++) html += effectRowHtml(project, effects[i], i);
      html += '<div class="row"><button type="button" class="mini" data-eact="add">+ 添加变量操作</button></div>';
    }
    html += '</div>';
    return html;
  };

  /* ------------------------------------------------------ 动作处理 */
  /** 条件动作；返回 true 表示数据被修改 */
  CondUI.applyConditionAction = function (project, ref, el) {
    var act = el.getAttribute('data-cact');
    var root = getConditionRoot(project, ref);
    if (!act || !root) return false;

    var path = parsePath(el.getAttribute('data-path'));
    var found = locate(root.owner[root.key], path);
    var node = found.node;
    var parent = found.parent;
    var key = found.key;

    if (act === 'add-cmp') {
      var first = project.variables[0];
      if (!first) return false; // 还没有变量：界面上不会显示这个按钮，这里再兜一道底
      var fresh = Engine.createCondition(first.id, '==', first.type === 'bool' ? true : 0);
      if (!node) {
        if (path.length !== 0) return false;
        root.owner[root.key] = fresh;
      } else if (node.type === 'group') {
        node.items.push(fresh);
      } else if (path.length === 0) {
        root.owner[root.key] = { type: 'group', op: 'all', items: [node, fresh] };
      } else {
        return false;
      }
      return true;
    }

    if (act === 'add-group') {
      if (node && node.type === 'group') {
        node.items.push({ type: 'group', op: 'all', items: [] });
        return true;
      }
      return false;
    }

    if (!node) return false;

    if (act === 'set-var') {
      var def = Model.findVariable(project, el.value);
      node.varId = el.value;
      if (def && def.type === 'bool') {
        node.op = '==';
        node.value = true;
      } else {
        if (CMP_OPS.indexOf(node.op) < 0) node.op = '==';
        node.value = Number(node.value) || 0;
      }
      return true;
    }
    if (act === 'set-op') {
      node.op = el.value;
      return true;
    }
    if (act === 'set-value') {
      var variable = Model.findVariable(project, node.varId);
      node.value = variable && variable.type === 'bool' ? el.value === 'true' : Number(el.value) || 0;
      return true;
    }
    if (act === 'set-group-op') {
      if (node.type === 'group') node.op = el.value === 'any' ? 'any' : 'all';
      return true;
    }
    if (act === 'del') {
      if (path.length === 0) {
        root.owner[root.key] = null;
      } else if (parent && parent.items) {
        parent.items.splice(key, 1);
        root.owner[root.key] = normGroup(root.owner[root.key]);
      }
      return true;
    }
    return false;
  };

  /** 效果动作；返回 true 表示数据被修改 */
  CondUI.applyEffectAction = function (project, ref, el) {
    var act = el.getAttribute('data-eact');
    var effects = getEffectsRoot(project, ref);
    if (!act || !effects) return false;

    if (act === 'add') {
      var first = project.variables[0];
      if (!first) return false; // 同上：没有变量时不加效果
      effects.push(Engine.createEffect(first.id, 'set', first.type === 'bool' ? true : 0));
      return true;
    }

    var index = parseInt(el.getAttribute('data-idx'), 10);
    if (isNaN(index) || index < 0 || index >= effects.length) return false;
    var effect = effects[index];

    if (act === 'set-var') {
      var def = Model.findVariable(project, el.value);
      effect.varId = el.value;
      effect.op = 'set';
      effect.value = def && def.type === 'bool' ? true : 0;
      return true;
    }
    if (act === 'set-op') {
      effect.op = el.value;
      return true;
    }
    if (act === 'set-value') {
      var variable = Model.findVariable(project, effect.varId);
      effect.value = variable && variable.type === 'bool' ? el.value === 'true' : Number(el.value) || 0;
      return true;
    }
    if (act === 'del') {
      effects.splice(index, 1);
      return true;
    }
    return false;
  };

  global.CondUI = CondUI;
})(typeof window !== 'undefined' ? window : globalThis);
