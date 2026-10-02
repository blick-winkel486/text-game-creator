/*!
 * editor/js/view-variables.js — 变量面板：全局变量表
 * 依赖：StoryEngine、Util、Model、Store   挂载于 window.ViewVariables
 */
(function (global) {
  'use strict';

  var Engine = global.StoryEngine;
  var Util = global.Util;
  var Model = global.Model;
  var Store = global.Store;
  var ViewVariables = {};

  var root = null;

  ViewVariables.mount = function (container) {
    root = container;
    Util.on(root, 'click', '[data-act]', onAction);
    Util.on(root, 'change', '[data-field]', onFieldChange);
  };

  function rowHtml(project, variable) {
    var usage = Engine.countVariableUsage(project, variable.id);
    var dup = Model.isDuplicateName(project, variable.id, variable.name);
    var nameMissing = !String(variable.name).trim();
    var initialControl;
    if (variable.type === 'bool') {
      initialControl = '<select class="field" data-field="var.initial" data-var="' + Util.esc(variable.id) + '">' +
        '<option value="true"' + (variable.initial === true ? ' selected' : '') + '>真</option>' +
        '<option value="false"' + (variable.initial !== true ? ' selected' : '') + '>假</option>' +
        '</select>';
    } else {
      initialControl = '<input class="field" type="number" step="any" data-field="var.initial" data-var="' +
        Util.esc(variable.id) + '" value="' + Util.esc(String(Number(variable.initial) || 0)) + '">';
    }
    return '<tr class="' + (dup || nameMissing ? 'dup' : '') + '">' +
      '<td><input class="field" type="text" data-field="var.name" data-var="' + Util.esc(variable.id) +
      '" value="' + Util.esc(variable.name) + '"></td>' +
      '<td><select class="field" data-field="var.type" data-var="' + Util.esc(variable.id) + '">' +
      '<option value="number"' + (variable.type === 'number' ? ' selected' : '') + '>数字</option>' +
      '<option value="bool"' + (variable.type === 'bool' ? ' selected' : '') + '>布尔</option>' +
      '</select></td>' +
      '<td>' + initialControl + '</td>' +
      '<td><input class="field" type="text" data-field="var.desc" data-var="' + Util.esc(variable.id) +
      '" value="' + Util.esc(variable.desc) + '"></td>' +
      '<td class="muted">' + usage + ' 处</td>' +
      '<td><button type="button" class="mini danger" data-act="var.del" data-var="' + Util.esc(variable.id) +
      '">删除</button></td>' +
      '</tr>' +
      ((dup || nameMissing)
        ? '<tr class="dup"><td colspan="6" class="muted">' + (nameMissing ? '变量名不能为空。' : '变量名重复，请改名。') + '</td></tr>'
        : '');
  }

  ViewVariables.render = function () {
    if (!root) return;
    var project = Store.getProject();
    var html = '<div class="panel">' +
      '<h2>变量</h2>' +
      '<div class="hint">变量的「名称」用于在条件与效果里显示；改动名称不会影响已经配置好的逻辑。' +
      '删除变量时，引用它的条件与效果会一起清理。</div>' +
      '<div class="card">' +
      '<table class="var-table"><thead><tr>' +
      '<th style="width:150px">名称</th><th style="width:90px">类型</th><th style="width:110px">初始值</th>' +
      '<th>备注</th><th style="width:70px">被引用</th><th style="width:60px"></th>' +
      '</tr></thead><tbody>';
    if (!project.variables.length) {
      html += '<tr><td colspan="6" class="empty">还没有变量。添加后就可以在选项条件里做判断了。</td></tr>';
    }
    for (var i = 0; i < project.variables.length; i++) html += rowHtml(project, project.variables[i]);
    html += '</tbody></table>' +
      '<div class="row" style="margin-top:10px"><button type="button" class="btn small" data-act="var.add">+ 添加变量</button></div>' +
      '</div></div>';
    Util.withFocus(root, function () { root.innerHTML = html; });
  };

  function onAction(el) {
    var act = el.getAttribute('data-act');
    if (act === 'var.add') {
      Store.update(function (project) { Model.addVariable(project); });
      return;
    }
    if (act === 'var.del') {
      var varId = el.getAttribute('data-var');
      var project = Store.getProject();
      var variable = Model.findVariable(project, varId);
      if (!variable) return;
      var usage = Engine.countVariableUsage(project, varId);
      var message = '确定删除变量「' + variable.name + '」吗？';
      if (usage) message += '\n它被引用了 ' + usage + ' 处，这些条件与效果会一起被清理。';
      if (!global.confirm(message)) return;
      Store.update(function (p) { Model.removeVariable(p, varId); });
    }
  }

  function onFieldChange(el) {
    var spec = el.getAttribute('data-field');
    var varId = el.getAttribute('data-var');
    Store.update(function (project) {
      var variable = Model.findVariable(project, varId);
      if (!variable) return;
      if (spec === 'var.name') {
        variable.name = el.value;
      } else if (spec === 'var.type') {
        Model.retypeVariable(project, varId, el.value);
      } else if (spec === 'var.initial') {
        variable.initial = variable.type === 'bool' ? el.value === 'true' : Number(el.value) || 0;
      } else if (spec === 'var.desc') {
        variable.desc = el.value;
      }
    });
  }

  global.ViewVariables = ViewVariables;
})(typeof window !== 'undefined' ? window : globalThis);
