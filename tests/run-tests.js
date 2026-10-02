/*!
 * tests/run-tests.js — 运行时引擎单元测试（Node 环境，无第三方依赖）
 * 运行：node tests/run-tests.js
 */
'use strict';

const Engine = require('../core/story-engine.js');

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

function group(name, fn) {
  console.log('\n' + name);
  fn();
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error((msg || '值不相等') + '\n实际: ' + a + '\n期望: ' + b);
  }
}

function includes(list, text, msg) {
  const hit = list.some(function (item) { return String(item).indexOf(text) >= 0; });
  if (!hit) throw new Error((msg || '未找到包含指定文本的项') + '\n期望包含: ' + text + '\n实际: ' + JSON.stringify(list));
}

/* ======================================================================
 * 测试用项目
 * ----------------------------------------------------------------------
 * n_start ──打招呼(+1好感)──▶ n_talk ──继续聊(+1好感)──▶ n_chat
 *    │                            └──离开──▶ 结局 n_good
 *    ├──无视──▶ 结局 n_bad
 *    └──[好感度>=5 且 hasKey==true]──▶ n_secret（结局）
 * n_chat 无选项：好感度>=5 → n_secret，否则 → n_good
 * ==================================================================== */
function fixture(options) {
  options = options || {};
  const favInit = options.fav === undefined ? 0 : options.fav;
  const keyInit = !!options.hasKey;
  return {
    format: 'story-editor',
    version: 1,
    meta: {
      title: '测试故事',
      author: '',
      startNodeId: 'n_start',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    variables: [
      { id: 'v_fav', name: '好感度', type: 'number', initial: favInit, desc: '' },
      { id: 'v_key', name: 'hasKey', type: 'bool', initial: keyInit, desc: '' }
    ],
    nodes: [
      {
        id: 'n_start',
        title: '开场',
        text: '门口站着一个人。',
        x: 0, y: 0,
        branches: [
          { id: 'b_hi', text: '打招呼', target: 'n_talk', condition: null, effects: [{ varId: 'v_fav', op: 'add', value: 1 }] },
          { id: 'b_skip', text: '无视', target: 'n_bad', condition: null, effects: [] },
          {
            id: 'b_secret',
            text: '用钥匙开门',
            target: 'n_secret',
            condition: {
              type: 'group',
              op: 'all',
              items: [
                { type: 'cmp', varId: 'v_fav', op: '>=', value: 5 },
                { type: 'cmp', varId: 'v_key', op: '==', value: true }
              ]
            },
            effects: []
          }
        ],
        autoRules: []
      },
      {
        id: 'n_talk',
        title: '交谈',
        text: '你们聊了起来。',
        x: 0, y: 0,
        branches: [
          { id: 'b_more', text: '继续聊', target: 'n_chat', condition: null, effects: [{ varId: 'v_fav', op: 'add', value: 1 }] },
          { id: 'b_leave', text: '离开', target: 'n_good', condition: null, effects: [] }
        ],
        autoRules: []
      },
      {
        id: 'n_chat',
        title: '判断',
        text: '对方看着你。',
        x: 0, y: 0,
        branches: [],
        autoRules: [
          { id: 'a_good_fav', condition: { type: 'cmp', varId: 'v_fav', op: '>=', value: 5 }, target: 'n_secret' },
          { id: 'a_else', condition: null, target: 'n_good' }
        ]
      },
      { id: 'n_secret', title: '密室', text: '你打开了密室。', x: 0, y: 0, branches: [], autoRules: [] },
      { id: 'n_good', title: '好结局', text: '你满意地离开了。', x: 0, y: 0, branches: [], autoRules: [] },
      { id: 'n_bad', title: '坏结局', text: '你什么都没做。', x: 0, y: 0, branches: [], autoRules: [] }
    ]
  };
}

function normalized(options) {
  return Engine.normalizeProject(fixture(options)).project;
}

/* ======================================================================
 * 1. 归一化
 * ==================================================================== */
group('归一化 normalizeProject', function () {
  test('完整数据归一化后无 notes', function () {
    const r = Engine.normalizeProject(fixture());
    eq(r.notes, []);
    eq(r.project.format, 'story-editor');
    eq(r.project.nodes.length, 6);
    eq(r.project.meta.startNodeId, 'n_start');
  });

  test('createProject 生成的空项目可用', function () {
    const p = Engine.createProject('我的故事');
    const r = Engine.normalizeProject(p);
    eq(r.notes, []);
    eq(r.project.meta.title, '我的故事');
    eq(r.project.nodes.length, 1);
    eq(r.project.meta.startNodeId, r.project.nodes[0].id);
    ok(r.project.variables.length >= 1, '应带示例变量');
  });

  test('缺字段自动补默认值', function () {
    const r = Engine.normalizeProject({ nodes: [{ id: 'n_1' }] });
    const node = r.project.nodes[0];
    eq(node.title, '');
    eq(node.text, '');
    eq(node.branches, []);
    eq(node.autoRules, []);
    eq(typeof node.x, 'number');
    eq(r.project.meta.startNodeId, 'n_1');
    eq(r.project.variables, []);
  });

  test('数字/布尔类型被归一化', function () {
    const r = Engine.normalizeProject({
      variables: [
        { id: 'v_a', name: 'a', type: 'number', initial: '5' },
        { id: 'v_b', name: 'b', type: 'bool', initial: 'true' }
      ],
      nodes: [{ id: 'n_1', text: 'x' }]
    });
    eq(r.project.variables[0].initial, 5);
    eq(r.project.variables[1].initial, true);
  });

  test('引用不存在的变量的条件与效果被丢弃', function () {
    const r = Engine.normalizeProject({
      variables: [],
      nodes: [{
        id: 'n_1',
        text: 'x',
        branches: [{
          id: 'b_1', text: '去', target: 'n_1',
          condition: { type: 'cmp', varId: 'v_none', op: '==', value: 1 },
          effects: [{ varId: 'v_none', op: 'set', value: 2 }]
        }]
      }]
    });
    const br = r.project.nodes[0].branches[0];
    eq(br.condition, null);
    eq(br.effects, []);
    includes(r.notes, '不存在的变量', '应给出 notes');
  });

  test('布尔变量的加减效果被改为赋值', function () {
    const r = Engine.normalizeProject({
      variables: [{ id: 'v_b', name: 'flag', type: 'bool', initial: false }],
      nodes: [{
        id: 'n_1', text: 'x',
        branches: [{ id: 'b_1', text: 'a', target: 'n_1', effects: [{ varId: 'v_b', op: 'add', value: 1 }] }]
      }]
    });
    eq(r.project.nodes[0].branches[0].effects[0].op, 'set');
    eq(r.project.nodes[0].branches[0].effects[0].value, true); // 值按布尔归一化：1 → true
  });

  test('起始节点无效时回退到第一个节点', function () {
    const r = Engine.normalizeProject({ meta: { startNodeId: 'n_nope' }, nodes: [{ id: 'n_1', text: 'x' }] });
    eq(r.project.meta.startNodeId, 'n_1');
    includes(r.notes, '起始节点无效', '应给出 notes');
  });

  test('没有节点时自动创建起始节点', function () {
    const r = Engine.normalizeProject({ nodes: [] });
    eq(r.project.nodes.length, 1);
    includes(r.notes, '自动创建起始节点', '应给出 notes');
  });

  test('format 不匹配时抛错', function () {
    let err = null;
    try { Engine.normalizeProject({ format: 'other' }); } catch (e) { err = e; }
    ok(err, '应抛出异常');
    includes([err.message], '不是本编辑器的项目文件');
  });

  test('字符串 JSON 输入可直接解析', function () {
    const r = Engine.normalizeProject(JSON.stringify(fixture()));
    eq(r.project.nodes.length, 6);
  });

  test('重名变量被自动改名', function () {
    const r = Engine.normalizeProject({
      variables: [
        { id: 'v_1', name: '好感度', type: 'number', initial: 0 },
        { id: 'v_2', name: '好感度', type: 'number', initial: 0 }
      ],
      nodes: [{ id: 'n_1', text: 'x' }]
    });
    eq(r.project.variables[1].name, '好感度2');
    includes(r.notes, '变量名重复');
  });
});

/* ======================================================================
 * 2. 条件求值
 * ==================================================================== */
group('条件求值 evaluateCondition', function () {
  const project = normalized();
  const vars = { v_fav: 5, v_key: true };

  test('null 与空组恒真', function () {
    eq(Engine.evaluateCondition(null, vars, project), true);
    eq(Engine.evaluateCondition({ type: 'group', op: 'all', items: [] }, vars, project), true);
    eq(Engine.evaluateCondition({ type: 'group', op: 'any', items: [] }, vars, project), true);
  });

  test('六种比较运算符', function () {
    function cmp(op, value, current) {
      return Engine.evaluateCondition({ type: 'cmp', varId: 'v_fav', op: op, value: value }, { v_fav: current }, project);
    }
    eq(cmp('==', 5, 5), true);
    eq(cmp('!=', 5, 5), false);
    eq(cmp('>', 4, 5), true);
    eq(cmp('>=', 5, 5), true);
    eq(cmp('<', 6, 5), true);
    eq(cmp('<=', 5, 5), true);
    eq(cmp('>', 5, 5), false);
  });

  test('布尔变量比较', function () {
    eq(Engine.evaluateCondition({ type: 'cmp', varId: 'v_key', op: '==', value: true }, vars, project), true);
    eq(Engine.evaluateCondition({ type: 'cmp', varId: 'v_key', op: '!=', value: false }, vars, project), true);
    eq(Engine.evaluateCondition({ type: 'cmp', varId: 'v_key', op: '==', value: false }, vars, project), false);
  });

  test('布尔变量配 > 返回 false 并给出警告', function () {
    const warns = [];
    const r = Engine.evaluateCondition({ type: 'cmp', varId: 'v_key', op: '>', value: 0 }, vars, project, function (m) { warns.push(m); });
    eq(r, false);
    includes(warns, '不支持');
  });

  test('复合条件：且 / 或 嵌套', function () {
    const cond = {
      type: 'group', op: 'all', items: [
        { type: 'cmp', varId: 'v_fav', op: '>=', value: 5 },
        {
          type: 'group', op: 'any', items: [
            { type: 'cmp', varId: 'v_key', op: '==', value: true },
            { type: 'cmp', varId: 'v_fav', op: '>', value: 99 }
          ]
        }
      ]
    };
    eq(Engine.evaluateCondition(cond, { v_fav: 5, v_key: true }, project), true);
    eq(Engine.evaluateCondition(cond, { v_fav: 5, v_key: false }, project), false);
    eq(Engine.evaluateCondition(cond, { v_fav: 4, v_key: true }, project), false);
    eq(Engine.evaluateCondition(cond, { v_fav: 100, v_key: false }, project), true);
  });

  test('引用不存在的变量返回 false 并有警告', function () {
    const warns = [];
    const r = Engine.evaluateCondition({ type: 'cmp', varId: 'v_none', op: '==', value: 1 }, vars, project, function (m) { warns.push(m); });
    eq(r, false);
    includes(warns, '不存在的变量');
  });

  test('字符串数值按数字比较', function () {
    eq(Engine.evaluateCondition({ type: 'cmp', varId: 'v_fav', op: '>=', value: '5' }, { v_fav: '5' }, project), true);
  });
});

/* ======================================================================
 * 3. 效果执行
 * ==================================================================== */
group('效果执行 applyEffects', function () {
  const project = normalized();

  test('set / add / sub 与连续叠加', function () {
    const vars = { v_fav: 0, v_key: false };
    Engine.applyEffects([{ varId: 'v_fav', op: 'add', value: 3 }], vars, project);
    eq(vars.v_fav, 3);
    Engine.applyEffects([{ varId: 'v_fav', op: 'sub', value: 1 }], vars, project);
    eq(vars.v_fav, 2);
    Engine.applyEffects([{ varId: 'v_fav', op: 'set', value: 10 }], vars, project);
    eq(vars.v_fav, 10);
    Engine.applyEffects([
      { varId: 'v_fav', op: 'add', value: 1 },
      { varId: 'v_fav', op: 'add', value: 2 }
    ], vars, project);
    eq(vars.v_fav, 13);
  });

  test('布尔变量只能赋值', function () {
    const vars = { v_key: false };
    Engine.applyEffects([{ varId: 'v_key', op: 'set', value: true }], vars, project);
    eq(vars.v_key, true);
    const warns = [];
    Engine.applyEffects([{ varId: 'v_key', op: 'add', value: 1 }], vars, project, function (m) { warns.push(m); });
    eq(vars.v_key, true); // add 被转成赋值，值按布尔归一化（1 → true）
    includes(warns, '不支持');
  });

  test('引用未知变量只警告不抛错', function () {
    const vars = { v_fav: 1 };
    const warns = [];
    Engine.applyEffects([{ varId: 'v_none', op: 'set', value: 9 }], vars, project, function (m) { warns.push(m); });
    eq(vars, { v_fav: 1 });
    includes(warns, '不存在的变量');
  });
});

/* ======================================================================
 * 4. 节点推进判定
 * ==================================================================== */
group('节点推进判定 evaluateNode', function () {
  const project = normalized();
  const startNode = project.nodes.filter(function (n) { return n.id === 'n_start'; })[0];

  test('有可用选项时返回 choices', function () {
    const r = Engine.evaluateNode(project, startNode, { v_fav: 0, v_key: false }, function () {});
    eq(r.kind, 'choices');
    eq(r.choices.length, 2); // 第三个选项条件不满足
    eq(r.choices[0].text, '打招呼');
    eq(r.choices[1].target, 'n_bad');
  });

  test('条件满足时隐藏选项被放出', function () {
    const r = Engine.evaluateNode(project, startNode, { v_fav: 5, v_key: true }, function () {});
    eq(r.choices.length, 3);
    eq(r.choices[2].text, '用钥匙开门');
    eq(r.choices[2].description, '好感度 >= 5 且 hasKey == true');
  });

  test('没有可用选项时按顺序取第一条命中的自动跳转', function () {
    const chat = project.nodes.filter(function (n) { return n.id === 'n_chat'; })[0];
    eq(Engine.evaluateNode(project, chat, { v_fav: 5, v_key: false }, function () {}).target, 'n_secret');
    eq(Engine.evaluateNode(project, chat, { v_fav: 1, v_key: true }, function () {}).target, 'n_good');
  });

  test('没有后继时返回 ending', function () {
    const end = project.nodes.filter(function (n) { return n.id === 'n_good'; })[0];
    eq(Engine.evaluateNode(project, end, {}, function () {}).kind, 'ending');
  });

  test('自动跳转目标不存在时跳过该规则', function () {
    const broken = Engine.normalizeProject({
      nodes: [{
        id: 'n_a', text: 'a', branches: [],
        autoRules: [
          { id: 'a_1', condition: null, target: 'n_missing' },
          { id: 'a_2', condition: null, target: 'n_b' }
        ]
      }, { id: 'n_b', text: 'b' }]
    }).project;
    const warns = [];
    const r = Engine.evaluateNode(broken, broken.nodes[0], {}, function (m) { warns.push(m); });
    eq(r.kind, 'jump');
    eq(r.target, 'n_b');
    includes(warns, '目标节点不存在');
  });
});

/* ======================================================================
 * 5. 会话（状态机 / 回溯 / 循环保护）
 * ==================================================================== */
group('会话 createSession', function () {
  test('起始节点与可见选项', function () {
    const s = Engine.createSession(fixture());
    eq(s.nodeId, 'n_start');
    eq(s.status, 'playing');
    eq(s.choices.length, 2);
    eq(s.stepCount, 0);
    eq(s.canGoBack, false);
    eq(s.vars.v_fav, 0);
    eq(s.text, '门口站着一个人。');
  });

  test('选择选项：执行效果并跳转', function () {
    const s = Engine.createSession(fixture());
    s.choose(0);
    eq(s.nodeId, 'n_talk');
    eq(s.vars.v_fav, 1);
    eq(s.stepCount, 1);
    eq(s.choices.length, 2);
  });

  test('条件跳转走向不同结局（好感度不足）', function () {
    const s = Engine.createSession(fixture());
    s.choose(0); // 打招呼 → 好感度 1
    s.choose(0); // 继续聊 → 好感度 2 → n_chat
    eq(s.nodeId, 'n_good');
    eq(s.status, 'ended');
    eq(s.vars.v_fav, 2);
    eq(s.choices.length, 0);
  });

  test('条件跳转走向不同结局（好感度足够）', function () {
    const s = Engine.createSession(fixture({ fav: 4 }));
    s.choose(0); // 好感度 5
    s.choose(0); // 好感度 6 → n_chat → 命中 >=5
    eq(s.nodeId, 'n_secret');
    eq(s.status, 'ended');
    eq(s.vars.v_fav, 6);
  });

  test('从任意节点开始', function () {
    const s = Engine.createSession(fixture(), { startNodeId: 'n_talk' });
    eq(s.nodeId, 'n_talk');
    eq(s.choices.length, 2);
    s.choose(1);
    eq(s.nodeId, 'n_good');
    eq(s.status, 'ended');
  });

  test('回溯恢复变量与节点', function () {
    const s = Engine.createSession(fixture());
    s.choose(0);
    s.choose(0);
    eq(s.nodeId, 'n_good');
    s.back();
    eq(s.nodeId, 'n_talk');
    eq(s.status, 'playing');
    eq(s.vars.v_fav, 1);
    eq(s.stepCount, 1);
    s.back();
    eq(s.nodeId, 'n_start');
    eq(s.vars.v_fav, 0);
    eq(s.stepCount, 0);
  });

  test('历史为空时 back 不产生副作用', function () {
    const s = Engine.createSession(fixture());
    const before = JSON.stringify(s.snapshot());
    s.back();
    eq(JSON.stringify(s.snapshot()), before);
  });

  test('restart 重置变量与历史', function () {
    const s = Engine.createSession(fixture());
    s.choose(1);
    eq(s.nodeId, 'n_bad');
    eq(s.status, 'ended');
    s.restart();
    eq(s.nodeId, 'n_start');
    eq(s.status, 'playing');
    eq(s.vars.v_fav, 0);
    eq(s.stepCount, 0);
  });

  test('与编辑器数据隔离：会话不会修改传入的项目对象', function () {
    const raw = fixture();
    const before = JSON.stringify(raw);
    const s = Engine.createSession(raw);
    s.choose(0);
    eq(JSON.stringify(raw), before);
  });

  test('结局事件被触发', function () {
    const s = Engine.createSession(fixture());
    const seen = [];
    s.on('ended', function (payload) { seen.push(payload.nodeId); });
    s.choose(1);
    eq(seen, ['n_bad']);
  });

  test('变量监视快照结构完整', function () {
    const s = Engine.createSession(fixture());
    const snap = s.snapshot();
    eq(snap.nodeId, 'n_start');
    eq(snap.nodeTitle, '开场');
    eq(snap.status, 'playing');
    eq(snap.choices.length, 2);
    eq(snap.vars, { v_fav: 0, v_key: false });
    eq(snap.stepCount, 0);
  });
});

group('会话容错', function () {
  test('悬空跳转：保持当前节点且不改变量', function () {
    const broken = Engine.normalizeProject({
      variables: [{ id: 'v_x', name: 'x', type: 'number', initial: 0 }],
      nodes: [{
        id: 'n_a', title: 'a', text: 'a',
        branches: [{ id: 'b_1', text: '去', target: 'n_missing', effects: [{ varId: 'v_x', op: 'add', value: 1 }] }]
      }]
    }).project;
    const s = Engine.createSession(broken);
    s.choose(0);
    eq(s.nodeId, 'n_a');
    eq(s.vars.v_x, 0);
    eq(s.stepCount, 0);
    includes(s.warnings, '目标节点不存在');
  });

  test('纯自动跳转成环时被保护，不会死循环', function () {
    const loop = Engine.normalizeProject({
      nodes: [
        { id: 'n_a', title: 'a', text: 'a', branches: [], autoRules: [{ id: 'a_1', condition: null, target: 'n_b' }] },
        { id: 'n_b', title: 'b', text: 'b', branches: [], autoRules: [{ id: 'a_2', condition: null, target: 'n_a' }] }
      ]
    }).project;
    const s = Engine.createSession(loop);
    eq(s.status, 'error');
    includes([s.lastError], '自动跳转超过');
  });
});

/* ======================================================================
 * 6. 项目校验
 * ==================================================================== */
group('项目校验 validateProject', function () {
  test('规范项目没有任何问题', function () {
    const issues = Engine.validateProject(normalized());
    eq(issues.filter(function (i) { return i.level === 'error'; }), []);
    eq(issues.filter(function (i) { return i.level === 'warn'; }), []);
  });
  test('示例剧情 samples/demo-story.json 校验完全通过（0 错误 0 警告）', function () {
    const fs = require('fs');
    const path = require('path');
    const demoPath = path.join(__dirname, '..', 'samples', 'demo-story.json');
    const rawDemo = JSON.parse(fs.readFileSync(demoPath, 'utf8'));
    const normResult = Engine.normalizeProject(rawDemo);
    eq(normResult.notes, [], 'demo-story.json 归一化时不应产生迁移警告');
    const issues = Engine.validateProject(normResult.project);
    eq(issues, [], 'demo-story.json 项目校验应无任何 issue');
  });


  test('悬空跳转 / 未设置目标 / 起始节点缺失 → error', function () {
    const broken = {
      format: 'story-editor',
      version: 1,
      meta: { title: 'x', startNodeId: 'n_none' },
      variables: [],
      nodes: [{
        id: 'n_a', title: 'a', text: 'a',
        branches: [
          { id: 'b_1', text: 'x', target: 'n_missing', condition: null, effects: [] },
          { id: 'b_2', text: 'y', target: '', condition: null, effects: [] }
        ],
        autoRules: [{ id: 'a_1', condition: null, target: 'n_missing2' }]
      }]
    };
    const codes = Engine.validateProject(broken).map(function (i) { return i.code; });
    ok(codes.indexOf('start-missing') >= 0, '应报告起始节点缺失');
    ok(codes.indexOf('branch-target-missing') >= 0, '应报告悬空跳转');
    ok(codes.indexOf('branch-no-target') >= 0, '应报告未设置目标');
    ok(codes.indexOf('rule-target-missing') >= 0, '应报告自动跳转目标缺失');
  });

  test('空标题/空正文/空选项文字/重名变量/已删除变量引用 → warn', function () {
    const issues = Engine.validateProject({
      format: 'story-editor',
      version: 1,
      meta: { title: 'x', startNodeId: 'n_a' },
      variables: [
        { id: 'v_1', name: 'a', type: 'number', initial: 0 },
        { id: 'v_2', name: 'a', type: 'number', initial: 0 },
        { id: 'v_3', name: '', type: 'number', initial: 0 }
      ],
      nodes: [{
        id: 'n_a', title: '', text: '',
        branches: [{
          id: 'b_1', text: '', target: 'n_a',
          condition: { type: 'cmp', varId: 'v_gone', op: '==', value: 1 },
          effects: [{ varId: 'v_gone', op: 'set', value: 1 }]
        }],
        autoRules: []
      }]
    });
    const codes = issues.map(function (i) { return i.code; });
    ['node-empty-title', 'node-empty-text', 'branch-empty-text', 'var-duplicate-name', 'var-empty-name',
      'cond-var-missing', 'effect-var-missing'].forEach(function (code) {
      ok(codes.indexOf(code) >= 0, '应报告 ' + code + '，实际：' + codes.join(','));
    });
  });

  test('不可达节点与自动跳转环 → warn', function () {
    const issues = Engine.validateProject({
      format: 'story-editor',
      version: 1,
      meta: { title: 'x', startNodeId: 'n_a' },
      variables: [],
      nodes: [
        { id: 'n_a', title: 'a', text: 'a', branches: [], autoRules: [{ id: 'a_1', condition: null, target: 'n_b' }] },
        { id: 'n_b', title: 'b', text: 'b', branches: [], autoRules: [{ id: 'a_2', condition: null, target: 'n_a' }] },
        { id: 'n_孤岛', title: '孤岛', text: 'x', branches: [], autoRules: [] }
      ]
    });
    const codes = issues.map(function (i) { return i.code; });
    ok(codes.indexOf('auto-cycle') >= 0, '应报告自动跳转环');
    ok(codes.indexOf('node-unreachable') >= 0, '应报告不可达节点');
  });

  test('变量引用次数统计', function () {
    const project = normalized();
    eq(Engine.countVariableUsage(project, 'v_fav'), 4);
    eq(Engine.countVariableUsage(project, 'v_key'), 1);
    eq(Engine.countVariableUsage(project, 'v_none'), 0);
  });
});

/* ======================================================================
 * 7. 文案渲染
 * ==================================================================== */
group('文案渲染', function () {
  const project = normalized();

  test('describeCondition', function () {
    eq(Engine.describeCondition(null, project), '无条件');
    eq(Engine.describeCondition({ type: 'group', op: 'all', items: [] }, project), '无条件');
    eq(
      Engine.describeCondition({ type: 'cmp', varId: 'v_fav', op: '>=', value: 5 }, project),
      '好感度 >= 5'
    );
    eq(
      Engine.describeCondition({
        type: 'group', op: 'all', items: [
          { type: 'cmp', varId: 'v_fav', op: '>=', value: 5 },
          {
            type: 'group', op: 'any', items: [
              { type: 'cmp', varId: 'v_key', op: '==', value: true },
              { type: 'cmp', varId: 'v_fav', op: '>', value: 99 }
            ]
          }
        ]
      }, project),
      '好感度 >= 5 且 (hasKey == true 或 好感度 > 99)'
    );
  });

  test('describeEffects', function () {
    eq(Engine.describeEffects([], project), '');
    eq(
      Engine.describeEffects([
        { varId: 'v_fav', op: 'add', value: 1 },
        { varId: 'v_key', op: 'set', value: true },
        { varId: 'v_fav', op: 'sub', value: 2 },
        { varId: 'v_fav', op: 'set', value: 0 }
      ], project),
      '好感度 +1；hasKey = 真；好感度 -2；好感度 = 0'
    );
  });
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

