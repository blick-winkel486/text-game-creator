/*!
 * editor/js/store.js — 唯一数据源 + LocalStorage 自动保存 + 事件通知
 * 依赖：window.StoryEngine、window.Util   挂载于 window.Store
 *
 * 约定：
 *   Store.update(fn)        修改项目数据（会触发视图重绘与自动保存）
 *   Store.update(fn, {silent:true})  只改数据不重绘（输入框逐字输入时用，避免打断输入法）
 *   Store.setUi(patch)      修改界面状态（视图/选中节点/搜索词…），重绘但不保存项目
 */
(function (global) {
  'use strict';

  var Engine = global.StoryEngine;
  var Util = global.Util;
  var Store = {};

  var STORAGE_KEY = 'story-editor:project:v1';
  var SAVE_DELAY = 400;

  var handlers = {};
  var saveTimer = null;

  var state = {
    project: null,
    notes: [],
    ui: {
      view: 'list',
      selectedNodeId: '',
      search: '',
      previewOpen: false,
      graph: { zoom: 1, pan: { x: 20, y: 20 } }
    }
  };

  /* --------------------------------------------------------------- 事件 */
  Store.on = function (type, fn) {
    if (typeof fn !== 'function') return;
    (handlers[type] = handlers[type] || []).push(fn);
  };

  function emit(type, payload) {
    var list = handlers[type];
    if (!list) return;
    var copy = list.slice();
    for (var i = 0; i < copy.length; i++) copy[i](payload);
  }
  Store.emit = emit;

  /* --------------------------------------------------------------- 读取 */
  Store.getProject = function () { return state.project; };
  Store.getUi = function () { return state.ui; };
  Store.getNotes = function () { return state.notes.slice(); };
  Store.getIssues = function () { return Engine.validateProject(state.project); };

  /* --------------------------------------------------------------- 写入 */
  function touch() {
    if (state.project && state.project.meta) state.project.meta.updatedAt = Util.now();
  }

  Store.init = function (project, notes) {
    state.project = project;
    state.notes = notes || [];
    if (!state.ui.selectedNodeId || !global.Model.findNode(project, state.ui.selectedNodeId)) {
      state.ui.selectedNodeId = project.meta.startNodeId || (project.nodes[0] && project.nodes[0].id) || '';
    }
    emit('change');
  };

  /** 修改项目数据；opts.silent = true 时不重绘（输入中） */
  Store.update = function (mutator, opts) {
    opts = opts || {};
    var result;
    try {
      result = mutator(state.project, state.ui);
    } catch (e) {
      // 修改过程中出错：不落盘、不重绘，把问题显示出来，避免把坏数据写进存档
      if (global.console && global.console.error) global.console.error('[editor] 操作未完成：', e);
      emit('status', '⚠ 这次操作未能完成：' + (e && e.message ? e.message : e) + '（详情见浏览器控制台）');
      return undefined;
    }
    touch();
    scheduleSave();
    if (!opts.silent) emit('change');
    return result;
  };

  /** 修改界面状态 */
  Store.setUi = function (patch, opts) {
    opts = opts || {};
    for (var key in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) state.ui[key] = patch[key];
    }
    if (!opts.silent) emit('change');
  };

  Store.selectNode = function (nodeId, opts) {
    Store.setUi({ selectedNodeId: nodeId }, opts);
  };

  /* ----------------------------------------------------------- 持久化 */
  function save(quiet) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.project));
      if (!quiet) emit('status', '已保存到浏览器（LocalStorage）');
      return true;
    } catch (e) {
      emit('status', '自动保存失败：' + (e && e.message ? e.message : e) + '（请手动导出 JSON）');
      return false;
    }
  }

  function scheduleSave() {
    if (saveTimer) global.clearTimeout(saveTimer);
    saveTimer = global.setTimeout(function () {
      saveTimer = null;
      save(true);
      emit('saved');
    }, SAVE_DELAY);
  }

  Store.saveNow = function () {
    if (saveTimer) {
      global.clearTimeout(saveTimer);
      saveTimer = null;
    }
    return save(false);
  };

  Store.loadFromStorage = function () {
    var raw = null;
    try {
      raw = global.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
    if (!raw) return null;
    try {
      return Engine.normalizeProject(raw);
    } catch (e) {
      emit('status', '本地存档已损坏，已忽略：' + e.message);
      return null;
    }
  };

  Store.clearStorage = function () {
    try {
      global.localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* 忽略 */ }
  };

  /** 用新项目替换当前项目（新建 / 导入） */
  Store.replaceProject = function (project, notes) {
    state.project = project;
    state.notes = notes || [];
    state.ui.selectedNodeId = project.meta.startNodeId || (project.nodes[0] && project.nodes[0].id) || '';
    state.ui.search = '';
    state.ui.graph = { zoom: 1, pan: { x: 20, y: 20 } };
    emit('change');
    scheduleSave();
  };

  Store.toJSON = function () {
    return JSON.stringify(state.project, null, 2);
  };

  /* --------------------------------------------------------------- 校验 */
  /** 按 level 汇总 issue 数量 */
  Store.countIssues = function () {
    var issues = Store.getIssues();
    var errors = 0;
    var warns = 0;
    for (var i = 0; i < issues.length; i++) {
      if (issues[i].level === 'error') errors++;
      else warns++;
    }
    return { errors: errors, warns: warns, total: issues.length };
  };

  global.Store = Store;
})(typeof window !== 'undefined' ? window : globalThis);
