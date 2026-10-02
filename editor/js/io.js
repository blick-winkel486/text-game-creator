/*!
 * editor/js/io.js — 新建 / 导入 / 导出 JSON / 导出 HTML
 * 依赖：StoryEngine、Util、Store、Exporter   挂载于 window.IO
 */
(function (global) {
  'use strict';

  var Engine = global.StoryEngine;
  var Util = global.Util;
  var Store = global.Store;
  var Exporter = global.Exporter;
  var IO = {};

  var fileInput = null;

  IO.mount = function (inputEl) {
    fileInput = inputEl;
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        IO.importText(String(reader.result || ''), file.name);
        fileInput.value = '';
      };
      reader.onerror = function () {
        global.alert('读取文件失败，请重试。');
        fileInput.value = '';
      };
      reader.readAsText(file, 'utf-8');
    });
  };

  /** 从文本导入（也供测试与拖拽使用） */
  IO.importText = function (text, sourceName) {
    var result;
    try {
      result = Engine.normalizeProject(text);
    } catch (e) {
      global.alert('导入失败：' + e.message);
      return false;
    }
    Store.replaceProject(result.project, result.notes);
    if (result.notes.length) {
      Store.emit('status', '导入完成，但有 ' + result.notes.length + ' 处自动修正：' + result.notes.slice(0, 2).join('；'));
    } else {
      Store.emit('status', '已导入 ' + (sourceName || '项目') + '（' + result.project.nodes.length + ' 个节点）');
    }
    return true;
  };

  IO.newProject = function () {
    if (!global.confirm('新建会清空当前项目（本地自动存档也会被覆盖），确定继续吗？')) return;
    Store.replaceProject(Engine.createProject('未命名故事'), []);
    Store.saveNow();
    Store.emit('status', '已新建空白项目');
  };

  IO.exportJson = function () {
    var project = Store.getProject();
    Util.download(Exporter.filename(project, 'json'), Exporter.buildJson(project), 'application/json;charset=utf-8');
    Store.emit('status', '已导出 JSON，可用于备份或换电脑继续编辑');
  };

  IO.exportHtml = function () {
    var project = Store.getProject();
    var counts = Store.countIssues();
    if (counts.errors > 0) {
      var go = global.confirm('检测到 ' + counts.errors + ' 个错误（例如悬空跳转），导出的故事可能走不通。\n仍然要导出吗？');
      if (!go) return;
    }
    var source = global.STORY_ENGINE_SOURCE;
    if (!source) {
      global.alert('缺少引擎源码：请运行 python tools/build_engine_source.py 生成 core/engine-source.js 后刷新页面。');
      return;
    }
    var html;
    try {
      html = Exporter.buildStoryHtml(project, source);
    } catch (e) {
      global.alert('导出失败：' + e.message);
      return;
    }
    Util.download(Exporter.filename(project, 'html'), html, 'text/html;charset=utf-8');
    Store.emit('status', '已导出单文件 HTML（约 ' + Math.round(html.length / 1024) + ' KB），传到手机浏览器打开即可游玩');
  };

  /** 启动时载入：优先本地自动存档，否则新建空白项目 */
  IO.loadInitial = function () {
    var stored = Store.loadFromStorage();
    if (stored) return stored;
    return {
      project: Engine.createProject('未命名故事'),
      notes: ['本地没有自动存档，已为你创建空白项目']
    };
  };

  global.IO = IO;
})(typeof window !== 'undefined' ? window : globalThis);
