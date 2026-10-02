/*!
 * tests/test-export.js — 导出物测试（Node 环境，无第三方依赖）
 *  1) 结构断言：三段内联、JSON 可解析、特殊字符已转义
 *  2) 用提取出的引擎源码跑真实数据，验证三条不同路径的结局与变量
 *  3) 用极简 DOM 桩执行提取出的阅读器脚本，模拟点击验证界面流转
 * 运行：node tests/test-export.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const Engine = require('../core/story-engine.js');
const Exporter = require('../editor/js/exporter.js');
const ReaderTemplate = require('../editor/js/reader-template.js');

const ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \u2714 ' + name);
  } catch (e) {
    failed++;
    failures.push({ name: name, error: e });
    console.log('  \u2718 ' + name);
    console.log('      ' + String(e && e.message ? e.message : e).replace(/\n/g, '\n      '));
  }
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error((msg || '值不相等') + '\n实际: ' + a + '\n期望: ' + b);
}

/* ======================================================================
 * 素材
 * ==================================================================== */
const engineSource = (function () {
  const holder = {};
  new Function('window', fs.readFileSync(path.join(ROOT, 'core', 'engine-source.js'), 'utf8'))(holder);
  return holder.STORY_ENGINE_SOURCE;
})();

const demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples', 'demo-story.json'), 'utf8'));
const html = Exporter.buildStoryHtml(demo, engineSource);

function extract(id, source) {
  const re = new RegExp('<script id="' + id + '"[^>]*>([\\s\\S]*?)</scr' + 'ipt>');
  const m = re.exec(source);
  if (!m) throw new Error('导出物里找不到脚本段：' + id);
  return m[1];
}

const CLOSE_TAG = '</scr' + 'ipt>';

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

const embeddedEngine = extract('engine-js', html);
const embeddedData = extract('story-data', html);
const embeddedReader = extract('reader-js', html);

/** 用导出的引擎源码在 Node 里独立求值一份引擎实例（与项目里的引擎同一份源码） */
const EmbeddedEngine = (function () {
  new Function(embeddedEngine)(); // UMD：无 module 时挂到 globalThis
  return globalThis.StoryEngine;
})();

/* ======================================================================
 * 1. 导出物结构
 * ==================================================================== */
console.log('\n导出物结构');

test('包含引擎 / 数据 / 阅读器三段脚本', function () {
  ok(embeddedEngine.length > 1000, '引擎源码应有实质内容');
  ok(embeddedData.length > 100, '数据段应有内容');
  ok(embeddedReader.length > 500, '阅读器脚本应有内容');
  ok(html.indexOf('id="reader-css"') > 0, '应有内联样式');
});

test('没有未替换的占位符，script 标签配对', function () {
  ok(html.indexOf('{{') < 0, '不应残留 {{ 占位符');
  ok(html.indexOf('<title>undefined</title>') < 0, '标题不应是 undefined');
  const opens = count(html, '<script');
  eq(opens, 3, '<script 开标签数量');
  eq(count(html, CLOSE_TAG), 3, '</script> 闭标签数量');
});

test('标题被正确写入', function () {
  ok(html.indexOf('<title>深夜的灯塔</title>') > 0, '标题应写入 <title>');
  ok(html.indexOf('id="story-title">深夜的灯塔') > 0, '标题应写入阅读器头部');
});

test('数据段可 JSON.parse，且 < 已被转义', function () {
  eq(embeddedData.indexOf('<'), -1, '数据段里不应有裸 <');
  const data = JSON.parse(embeddedData);
  eq(data.meta.title, '深夜的灯塔');
  eq(data.nodes.length, 7);
  eq(data.variables.length, 3);
});

test('中文与换行被保留', function () {
  const data = JSON.parse(embeddedData);
  const start = data.nodes.filter(function (n) { return n.id === 'n_start01'; })[0];
  ok(start.text.indexOf('\n') > 0, '正文换行应保留');
  ok(start.text.indexOf('灯塔') > 0, '中文应保留');
});

test('含有 script 结束标签的正文也会被安全转义', function () {
  const evil = Engine.createProject('注入测试');
  evil.nodes[0].text = '危险的 ' + CLOSE_TAG + ' 文本 <b>加粗</b>';
  const out = Exporter.buildStoryHtml(evil, engineSource);
  eq(count(out, CLOSE_TAG), 3, '闭标签仍应只有三段');
  const dataJson = extract('story-data', out);
  eq(JSON.parse(dataJson).nodes[0].text, '危险的 ' + CLOSE_TAG + ' 文本 <b>加粗</b>');
});

test('示例剧情本身是干净的（无校验问题）', function () {
  const issues = Engine.validateProject(Engine.normalizeProject(demo).project);
  eq(issues, [], '示例剧情不应有校验问题');
});

/* ======================================================================
 * 2. 用内联引擎跑真实数据
 * ==================================================================== */
console.log('\n内联引擎跑通剧情');

test('内联引擎与应用中的引擎版本一致', function () {
  eq(EmbeddedEngine.VERSION, Engine.VERSION);
  eq(typeof EmbeddedEngine.createSession, 'function');
});

test('路径 A：打招呼 → 帮点灯 → 搜工具柜 → 用钥匙开门 = 秘密结局', function () {
  const s = EmbeddedEngine.createSession(JSON.parse(embeddedData));
  eq(s.nodeId, 'n_start01');
  s.choose(0); // 打招呼
  eq(s.nodeId, 'n_talk01');
  s.choose(0); // 我帮你把灯点上
  eq(s.nodeId, 'n_lamp001');
  s.choose(1); // 搜工具柜
  eq(s.nodeId, 'n_door001');
  eq(s.choices.length, 1, '拿到钥匙且信任足够时应出现开门选项');
  s.choose(0);
  eq(s.nodeId, 'n_secret1');
  eq(s.status, 'ended');
  eq(s.vars.v_trust01, 3);
  eq(s.vars.v_lamp001, true);
  eq(s.vars.v_key0001, true);
});

test('路径 B：径直走向塔门 = 冷清结局（条件跳转兜底）', function () {
  const s = EmbeddedEngine.createSession(JSON.parse(embeddedData));
  s.choose(1); // 径直走向塔门
  eq(s.nodeId, 'n_endcold');
  eq(s.status, 'ended');
  eq(s.vars.v_lamp001, false);
});

test('路径 C：点好灯但没拿钥匙 = 温暖结局（条件跳转命中第一条规则）', function () {
  const s = EmbeddedEngine.createSession(JSON.parse(embeddedData));
  s.choose(0); // 打招呼
  s.choose(0); // 帮忙点灯
  s.choose(0); // 点好灯下楼
  eq(s.nodeId, 'n_endwarm');
  eq(s.status, 'ended');
  eq(s.vars.v_lamp001, true);
  eq(s.vars.v_key0001, false);
});

test('回溯可以退回上一步', function () {
  const s = EmbeddedEngine.createSession(JSON.parse(embeddedData));
  s.choose(0);
  s.choose(0);
  eq(s.nodeId, 'n_lamp001');
  s.back();
  eq(s.nodeId, 'n_talk01');
  eq(s.stepCount, 1);
});

/* ======================================================================
 * 3. 极简 DOM 桩：真实执行阅读器脚本
 * ==================================================================== */
console.log('\n阅读器脚本（DOM 桩）');

/** 生成一个能跑阅读器的最简 document/window 环境 */
function makeDom(dataJson) {
  const registry = {};

  function makeEl(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      handlers: {},
      children: [],
      textContent: '',
      className: '',
      type: '',
      disabled: false,
      hidden: false,
      style: {},
      addEventListener: function (type, fn) {
        (this.handlers[type] = this.handlers[type] || []).push(fn);
      },
      appendChild: function (child) {
        this.children.push(child);
        return child;
      },
      removeChild: function (child) {
        const i = this.children.indexOf(child);
        if (i >= 0) this.children.splice(i, 1);
        return child;
      },
      click: function () {
        const list = (this.handlers.click || []).slice();
        for (let i = 0; i < list.length; i++) list[i]({ target: this });
      }
    };
    Object.defineProperty(el, 'firstChild', {
      get: function () { return this.children.length ? this.children[0] : null; }
    });
    return el;
  }

  ['story-data', 'text', 'choice-box', 'ending-box', 'ending-text', 'warn-box',
    'btn-back', 'btn-restart', 'btn-restart-2', 'progress'].forEach(function (id) {
    registry[id] = makeEl(id === 'story-data' ? 'script' : 'div');
  });
  registry['story-data'].textContent = dataJson;

  const doc = {
    readyState: 'complete',
    getElementById: function (id) { return registry[id] || null; },
    createElement: function (tag) { return makeEl(tag); },
    addEventListener: function () {}
  };
  return { doc: doc, registry: registry };
}

/** 执行导出的阅读器脚本 */
function runReader() {
  const dom = makeDom(embeddedData);
  const fakeWindow = { StoryEngine: EmbeddedEngine };
  new Function('window', 'document', embeddedReader)(fakeWindow, dom.doc);
  return dom;
}

function choicesOf(dom) {
  return dom.registry['choice-box'].children.map(function (b) { return b.textContent; });
}

function clickChoice(dom, index) {
  const btn = dom.registry['choice-box'].children[index];
  ok(btn, '找不到第 ' + index + ' 个选项，当前：' + JSON.stringify(choicesOf(dom)));
  btn.click();
}

function nodeText(id) {
  return JSON.parse(embeddedData).nodes.filter(function (n) { return n.id === id; })[0].text;
}

test('打开即显示起始节点与全部可用选项', function () {
  const dom = runReader();
  eq(dom.registry['text'].textContent, nodeText('n_start01'));
  eq(choicesOf(dom), ['向老人打招呼', '径直走向塔门']);
  eq(dom.registry['btn-back'].disabled, true);
  eq(dom.registry['ending-box'].hidden, true);
  eq(dom.registry['progress'].textContent, '第 1 步');
});

test('点击选项后正文推进、返回按钮启用', function () {
  const dom = runReader();
  clickChoice(dom, 0);
  eq(dom.registry['text'].textContent, nodeText('n_talk01'));
  eq(choicesOf(dom), ['「我帮你把灯点上。」', '「今晚就到这里吧。」']);
  eq(dom.registry['btn-back'].disabled, false);
  eq(dom.registry['progress'].textContent, '第 2 步');
});

test('走完一条路径后显示结局界面', function () {
  const dom = runReader();
  clickChoice(dom, 0); // 打招呼
  clickChoice(dom, 0); // 我帮你把灯点上
  clickChoice(dom, 1); // 搜工具柜
  eq(choicesOf(dom), ['用钥匙打开铁门']);
  clickChoice(dom, 0); // 用钥匙打开铁门
  eq(dom.registry['text'].textContent, nodeText('n_secret1'));
  eq(dom.registry['ending-box'].hidden, false);
  eq(dom.registry['ending-text'].textContent, '— 完 —');
  eq(dom.registry['progress'].textContent, '已结束');
  eq(choicesOf(dom), []);
});

test('自动跳转会在没有选项时静默转场', function () {
  const dom = runReader();
  clickChoice(dom, 1); // 径直走向塔门 → 门节点没有可用选项 → 自动跳到冷清结局
  eq(dom.registry['text'].textContent, nodeText('n_endcold'));
  eq(dom.registry['ending-box'].hidden, false);
});

test('返回上一步可以退回', function () {
  const dom = runReader();
  clickChoice(dom, 0);
  clickChoice(dom, 0);
  eq(dom.registry['text'].textContent, nodeText('n_lamp001'));
  dom.registry['btn-back'].click();
  eq(dom.registry['text'].textContent, nodeText('n_talk01'));
  eq(dom.registry['progress'].textContent, '第 2 步');
});

test('重新开始按钮（顶部与结局页）都能回到开头', function () {
  const dom = runReader();
  clickChoice(dom, 1);
  eq(dom.registry['ending-text'].textContent, '— 完 —');
  dom.registry['btn-restart-2'].click();
  eq(dom.registry['text'].textContent, nodeText('n_start01'));
  eq(choicesOf(dom), ['向老人打招呼', '径直走向塔门']);
  eq(dom.registry['ending-box'].hidden, true);
  eq(dom.registry['progress'].textContent, '第 1 步');

  clickChoice(dom, 0);
  dom.registry['btn-restart'].click();
  eq(dom.registry['text'].textContent, nodeText('n_start01'));
  eq(dom.registry['btn-back'].disabled, true);
});

/* ======================================================================
 * 汇总
 * ==================================================================== */
console.log('\n' + '='.repeat(56));
if (failed) {
  console.log('失败 ' + failed + ' 项，通过 ' + passed + ' 项');
  failures.forEach(function (f) {
    console.log('\n[' + f.name + ']\n' + (f.error && f.error.stack ? f.error.stack : f.error));
  });
  process.exitCode = 1;
} else {
  console.log('全部通过：' + passed + ' 项测试');
}
