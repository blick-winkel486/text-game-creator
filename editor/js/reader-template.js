/*!
 * editor/js/reader-template.js — 导出用阅读器的 HTML / CSS / JS 三段模板（纯函数）
 * 浏览器：window.ReaderTemplate    Node：require('./reader-template.js')
 *
 * 三段内容会被 exporter 原样拼进导出的单个 HTML 文件。
 * 阅读器脚本内的字符串不会出现 </script>，因此可以安全内联。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ReaderTemplate = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ReaderTemplate = {};

  ReaderTemplate.css = function () {
    return [
      '/* 浅色主题、移动优先 */',
      '* { box-sizing: border-box; }',
      'html, body { margin: 0; padding: 0; }',
      'body {',
      '  background: #f6f6f3;',
      '  color: #2b2b2b;',
      '  font: 17px/1.9 -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;',
      '  -webkit-text-size-adjust: 100%;',
      '  overflow-x: hidden;',
      '}',
      '#app { display: flex; flex-direction: column; min-height: 100vh; max-width: 720px; margin: 0 auto; }',
      '#topbar {',
      '  position: sticky; top: 0; z-index: 2;',
      '  display: flex; align-items: center; gap: 10px;',
      '  padding: 10px 18px;',
      '  background: #fffefb; border-bottom: 1px solid #e3e2dc;',
      '  font-size: 14px;',
      '}',
      '#story-title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '#stage { flex: 1 1 auto; padding: 20px 18px 96px; }',
      '#text { margin: 0 0 20px; white-space: pre-wrap; word-break: break-word; }',
      '.r-choice {',
      '  display: block; width: 100%; margin: 0 0 12px; padding: 14px 16px;',
      '  text-align: left; font: inherit; font-size: 16px; line-height: 1.5;',
      '  color: #234a37; background: #fffefb;',
      '  border: 1px solid #cfd8d1; border-radius: 10px;',
      '  cursor: pointer; -webkit-tap-highlight-color: transparent;',
      '}',
      '.r-choice:active { background: #e9efe9; }',
      '#ending-box { padding: 30px 0; text-align: center; color: #6a7069; }',
      '#ending-text { margin: 0; }',
      '#ending-box button {',
      '  margin-top: 14px; padding: 12px 24px; font: inherit; font-size: 16px;',
      '  color: #234a37; background: #fffefb;',
      '  border: 1px solid #cfd8d1; border-radius: 10px; cursor: pointer;',
      '}',
      '#warn-box { margin-top: 16px; font-size: 13px; color: #b07b2a; }',
      '#bottombar {',
      '  position: fixed; left: 0; right: 0; bottom: 0;',
      '  padding: 10px 18px calc(10px + env(safe-area-inset-bottom));',
      '  background: rgba(255, 254, 251, .96); border-top: 1px solid #e3e2dc;',
      '  font-size: 13px; color: #6a7069;',
      '}',
      '#bottombar .inner { display: flex; align-items: center; gap: 12px; max-width: 720px; margin: 0 auto; }',
      '#bottombar .grow { flex: 1; }',
      '#btn-back, #btn-restart {',
      '  padding: 6px 12px; font: inherit; font-size: 13px;',
      '  color: #234a37; background: #fff;',
      '  border: 1px solid #cfd8d1; border-radius: 8px; cursor: pointer;',
      '}',
      '#btn-back:disabled { opacity: .45; cursor: default; }',
      '@media (min-width: 721px) {',
      '  #topbar { padding: 12px 24px; }',
      '  #stage { padding: 28px 24px 100px; }',
      '  #bottombar { padding: 12px 24px calc(12px + env(safe-area-inset-bottom)); }',
      '}'
    ].join('\n');
  };

  ReaderTemplate.html = function (title) {
    var safeTitle = String(title === null || title === undefined ? '' : title)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return [
      '<div id="app">',
      '  <header id="topbar">',
      '    <span id="story-title">' + safeTitle + '</span>',
      '    <button id="btn-restart" type="button">重新开始</button>',
      '  </header>',
      '  <main id="stage">',
      '    <p id="text"></p>',
      '    <div id="choice-box"></div>',
      '    <div id="ending-box" hidden>',
      '      <p id="ending-text">— 完 —</p>',
      '      <button id="btn-restart-2" type="button">重新开始</button>',
      '    </div>',
      '    <div id="warn-box" hidden></div>',
      '  </main>',
      '  <footer id="bottombar">',
      '    <div class="inner">',
      '      <button id="btn-back" type="button">← 返回上一步</button>',
      '      <span class="grow"></span>',
      '      <span id="progress"></span>',
      '    </div>',
      '  </footer>',
      '</div>'
    ].join('\n');
  };

  /**
   * 阅读器逻辑本体。
   * 说明：写成普通函数再用 toString() 内联，这样可以由编辑器/Node 直接解析本文件，
   * 语法错误会在开发期就暴露，而不必等到导出后才发现。
   */
  function readerMain(win, doc) {
    'use strict';
    var Engine = win.StoryEngine;
    var dataEl = doc.getElementById('story-data');
    if (!Engine || !dataEl) return;

    var project;
    try {
      project = JSON.parse(dataEl.textContent || dataEl.innerText || '{}');
    } catch (e) {
      return;
    }

    var els = {
      text: doc.getElementById('text'),
      choices: doc.getElementById('choice-box'),
      ending: doc.getElementById('ending-box'),
      endingText: doc.getElementById('ending-text'),
      warn: doc.getElementById('warn-box'),
      back: doc.getElementById('btn-back'),
      restart: doc.getElementById('btn-restart'),
      restart2: doc.getElementById('btn-restart-2'),
      progress: doc.getElementById('progress')
    };

    var session = Engine.createSession(project);

    function clearChoices() {
      while (els.choices.firstChild) els.choices.removeChild(els.choices.firstChild);
    }

    function render() {
      els.text.textContent = session.text;
      clearChoices();

      var choices = session.choices;
      for (var i = 0; i < choices.length; i++) {
        (function (index) {
          var button = doc.createElement('button');
          button.type = 'button';
          button.className = 'r-choice';
          button.textContent = choices[index].text || '（未命名的选项）';
          button.addEventListener('click', function () { session.choose(index); });
          els.choices.appendChild(button);
        })(i);
      }

      var ended = session.status === 'ended';
      var errored = session.status === 'error';
      els.ending.hidden = !(ended || errored);
      if (ended) els.endingText.textContent = '— 完 —';
      if (errored) els.endingText.textContent = session.lastError || '剧情数据有误，无法继续。';

      els.back.disabled = !session.canGoBack;
      els.progress.textContent = ended ? '已结束' : (errored ? '出错' : '第 ' + (session.stepCount + 1) + ' 步');

      var warnings = session.warnings;
      if (warnings.length) {
        els.warn.hidden = false;
        els.warn.textContent = '提示：' + warnings.join('；');
      } else {
        els.warn.hidden = true;
      }
      if (typeof win.scrollTo === 'function') win.scrollTo(0, 0);
    }

    function restart() {
      session.restart();
      if (typeof win.scrollTo === 'function') win.scrollTo(0, 0);
    }

    session.on('change', render);
    session.on('warning', render);
    els.restart.addEventListener('click', restart);
    els.restart2.addEventListener('click', restart);
    els.back.addEventListener('click', function () { session.back(); });
    render();
  }

  /** 阅读器脚本源码（内联进导出物） */
  ReaderTemplate.js = function () {
    return [
      '(function () {',
      '  "use strict";',
      '  var startStoryReader = ' + readerMain.toString() + ';',
      '  if (typeof window !== "undefined") window.__startStoryReader = startStoryReader;',
      '  if (typeof document !== "undefined" && typeof window !== "undefined") {',
      '    if (document.readyState === "loading" && document.addEventListener) {',
      '      document.addEventListener("DOMContentLoaded", function () { startStoryReader(window, document); });',
      '    } else {',
      '      startStoryReader(window, document);',
      '    }',
      '  }',
      '})();'
    ].join('\n');
  };

  return ReaderTemplate;
});
