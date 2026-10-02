/*!
 * editor/js/exporter.js — 导出物拼装（纯函数，浏览器与 Node 均可用）
 * 浏览器：window.Exporter    Node：require('./exporter.js')
 *
 * 导出物 = 阅读器模板（HTML/CSS/JS） + 引擎源码 + 项目 JSON，全部内联，单文件可直接双击/手机打开。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../../core/story-engine.js'), require('./reader-template.js'));
  } else {
    root.Exporter = factory(root.StoryEngine, root.ReaderTemplate);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Engine, ReaderTemplate) {
  'use strict';

  var Exporter = {};

  function escHtml(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** JSON 内联进 <script> 时的转义：把 < 转成 \u003c，并处理行分隔符 */
  function escapeInlineJson(json) {
    return String(json)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  /** 双保险：万一脚本源码里出现 </script，也让它无法提前闭合脚本块 */
  function guardScript(code) {
    return String(code).replace(/<\/(script)/gi, '<\\/$1');
  }

  /** 把项目名清洗成安全的文件名 */
  function safeName(name, fallback) {
    var s = String(name === null || name === undefined ? '' : name)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/^\s+|\s+$/g, '');
    if (!s) s = fallback || 'story';
    return s.slice(0, 60);
  }

  Exporter.filename = function (project, ext) {
    var title = project && project.meta ? project.meta.title : '';
    return safeName(title, 'story') + '.' + (ext || 'html');
  };

  /** 导出用的项目 JSON（先归一化，保证字段完整） */
  Exporter.buildJson = function (project) {
    return JSON.stringify(Engine.normalizeProject(project).project, null, 2);
  };

  /**
   * 生成单文件 HTML。
   * @param {Object} project      项目数据
   * @param {string} engineSource 引擎源码（window.STORY_ENGINE_SOURCE）
   * @returns {string}
   */
  Exporter.buildStoryHtml = function (project, engineSource) {
    var data = Engine.normalizeProject(project).project;
    var title = data.meta.title || '互动故事';
    var engine = String(engineSource || '');
    if (!engine) {
      throw new Error('缺少引擎源码，请先运行 python tools/build_engine_source.py 生成 core/engine-source.js');
    }
    var json = escapeInlineJson(JSON.stringify(data));

    return [
      '<!doctype html>',
      '<html lang="zh-CN">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      '<meta name="color-scheme" content="light">',
      '<meta name="generator" content="story-editor (visual narrative editor)">',
      '<title>' + escHtml(title) + '</title>',
      '<style id="reader-css">',
      ReaderTemplate.css(),
      '</style>',
      '</head>',
      '<body>',
      ReaderTemplate.html(title),
      '<script id="engine-js">',
      guardScript(engine),
      '</' + 'script>',
      '<script id="story-data" type="application/json">',
      json,
      '</' + 'script>',
      '<script id="reader-js">',
      guardScript(ReaderTemplate.js()),
      '</' + 'script>',
      '</body>',
      '</html>'
    ].join('\n');
  };

  return Exporter;
});
