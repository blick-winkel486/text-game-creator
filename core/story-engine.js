/*!
 * story-engine.js — 可视化互动叙事编辑器的运行时引擎
 * 唯一真源：编辑器预览与导出 HTML 阅读器共用本文件。
 *
 * 浏览器：用 script 标签引入本文件 → window.StoryEngine
 * Node  ：const StoryEngine = require('./core/story-engine.js')
 *
 * 改动本文件后需重新运行：python tools/build_engine_source.py
 * （该脚本生成 core/engine-source.js，供导出 HTML 时内联引擎源码）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StoryEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var SCHEMA_VERSION = 1;
  var FORMAT = 'story-editor';
  var MAX_AUTO_STEPS = 100; // 自动跳转链的长度上限（防环）

  /* ======================================================================
   * 一、基础工具
   * ==================================================================== */

  var ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

  function uid(prefix) {
    var s = '';
    for (var i = 0; i < 8; i++) {
      s += ID_CHARS.charAt(Math.floor(Math.random() * ID_CHARS.length));
    }
    return (prefix || 'id') + '_' + s;
  }

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function isArray(v) {
    return Object.prototype.toString.call(v) === '[object Array]';
  }

  function clone(v) {
    if (v === undefined) return undefined;
    return JSON.parse(JSON.stringify(v));
  }

  function toText(v) {
    return v === null || v === undefined ? '' : String(v);
  }

  function toNumber(v, fallback) {
    if (typeof v === 'number' && isFinite(v)) return v;
    var n = Number(v);
    if (isFinite(n)) return n;
    return fallback === undefined ? 0 : fallback;
  }

  function toBool(v) {
    return v === true || v === 'true' || v === 1 || v === '1';
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function trimText(v) {
    return toText(v).replace(/^\s+|\s+$/g, '');
  }

  var COMPARE_OPS = ['==', '!=', '>', '>=', '<', '<='];
  var EFFECT_OPS = ['set', 'add', 'sub'];

  /* ======================================================================
   * 二、数据工厂（编辑器新建节点/变量/选项时使用）
   * ==================================================================== */

  function createVariable(opts) {
    opts = opts || {};
    var type = opts.type === 'bool' ? 'bool' : 'number';
    return {
      id: toText(opts.id) || uid('v'),
      name: trimText(opts.name) || '新变量',
      type: type,
      initial: type === 'bool' ? toBool(opts.initial) : toNumber(opts.initial),
      desc: toText(opts.desc)
    };
  }

  function createCondition(varId, op, value) {
    return {
      type: 'cmp',
      varId: toText(varId),
      op: COMPARE_OPS.indexOf(op) >= 0 ? op : '==',
      value: value === undefined ? 0 : value
    };
  }

  function createGroup(op) {
    return { type: 'group', op: op === 'any' ? 'any' : 'all', items: [] };
  }

  function createEffect(varId, op, value) {
    return {
      varId: toText(varId),
      op: EFFECT_OPS.indexOf(op) >= 0 ? op : 'set',
      value: value === undefined ? 0 : value
    };
  }

  function createBranch(opts) {
    opts = opts || {};
    return {
      id: toText(opts.id) || uid('b'),
      text: toText(opts.text),
      target: toText(opts.target),
      condition: opts.condition === undefined ? null : opts.condition,
      effects: isArray(opts.effects) ? clone(opts.effects) : []
    };
  }

  function createAutoRule(opts) {
    opts = opts || {};
    return {
      id: toText(opts.id) || uid('a'),
      condition: opts.condition === undefined ? null : opts.condition,
      target: toText(opts.target)
    };
  }

  function createNode(opts) {
    opts = opts || {};
    return {
      id: toText(opts.id) || uid('n'),
      title: toText(opts.title),
      text: toText(opts.text),
      x: Math.round(toNumber(opts.x, 80)),
      y: Math.round(toNumber(opts.y, 80)),
      branches: isArray(opts.branches) ? clone(opts.branches) : [],
      autoRules: isArray(opts.autoRules) ? clone(opts.autoRules) : []
    };
  }

  /** 新建项目：一个起始节点 + 两个示例变量（覆盖数字与布尔两种类型） */
  function createProject(title) {
    var node = createNode({
      title: '开始',
      text: '在这里写下开场白。\n换行会原样显示在阅读器里。',
      x: 80,
      y: 80
    });
    return {
      format: FORMAT,
      version: SCHEMA_VERSION,
      meta: {
        title: trimText(title) || '未命名故事',
        author: '',
        startNodeId: node.id,
        createdAt: nowIso(),
        updatedAt: nowIso()
      },
      variables: [
        createVariable({ name: '好感度', type: 'number', initial: 0, desc: '示例：数字变量' }),
        createVariable({ name: 'hasKey', type: 'bool', initial: false, desc: '示例：布尔变量' })
      ],
      nodes: [node]
    };
  }

  /* ======================================================================
   * 三、归一化（normalizeProject）
   * ----------------------------------------------------------------------
   * 输入任何形状的数据（旧版本、手写 JSON、残缺数据），输出结构完整、可安全
   * 运行的项目对象，并把修正过程记录到 notes 里返回给编辑器提示用户。
   * ==================================================================== */

  function indexById(list) {
    var map = {};
    for (var i = 0; i < list.length; i++) map[list[i].id] = list[i];
    return map;
  }

  function normalizeProject(raw) {
    var notes = [];
    var data = raw;

    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (e) {
        throw new Error('JSON 解析失败：' + e.message);
      }
    }
    if (!isPlainObject(data)) {
      throw new Error('项目数据不是有效的对象结构');
    }
    if (data.format !== undefined && data.format !== FORMAT) {
      throw new Error('不是本编辑器的项目文件（format=' + toText(data.format) + '）');
    }
    var rawVersion = toNumber(data.version, 1);
    if (rawVersion > SCHEMA_VERSION) {
      notes.push('数据版本 ' + rawVersion + ' 高于当前引擎支持的 ' + SCHEMA_VERSION + '，可能有字段被忽略');
    }

    /* --- 变量 --- */
    var variables = [];
    var varIds = {};
    var varNames = {};
    var rawVars = isArray(data.variables) ? data.variables : [];
    for (var i = 0; i < rawVars.length; i++) {
      if (!isPlainObject(rawVars[i])) continue;
      var v = createVariable(rawVars[i]);
      if (varIds[v.id]) {
        notes.push('变量 id 重复，已重新生成：' + v.id);
        v.id = uid('v');
      }
      varIds[v.id] = true;
      if (varNames[v.name]) {
        var base = v.name;
        var n = 2;
        while (varNames[v.name]) v.name = base + n++;
        notes.push('变量名重复，已重命名为：' + v.name);
      }
      varNames[v.name] = true;
      variables.push(v);
    }
    var varById = indexById(variables);

    function normalizeCondition(raw, where) {
      if (raw === null || raw === undefined || raw === '') return null;
      if (!isPlainObject(raw)) {
        notes.push(where + '：条件结构无法识别，已忽略');
        return null;
      }
      if (raw.type === 'group') {
        var items = [];
        var rawItems = isArray(raw.items) ? raw.items : [];
        for (var k = 0; k < rawItems.length; k++) {
          var sub = normalizeCondition(rawItems[k], where);
          if (sub) items.push(sub);
        }
        return { type: 'group', op: raw.op === 'any' ? 'any' : 'all', items: items };
      }
      var def = varById[toText(raw.varId)];
      if (!def) {
        notes.push(where + '：条件引用了不存在的变量，已忽略');
        return null;
      }
      var op = COMPARE_OPS.indexOf(raw.op) >= 0 ? raw.op : '==';
      if (def.type === 'bool' && op !== '==' && op !== '!=') {
        notes.push(where + '：布尔变量 ' + def.name + ' 不支持 ' + op + '，已改为 ==');
        op = '==';
      }
      return {
        type: 'cmp',
        varId: def.id,
        op: op,
        value: def.type === 'bool' ? toBool(raw.value) : toNumber(raw.value)
      };
    }

    function normalizeEffect(raw, where) {
      if (!isPlainObject(raw)) {
        notes.push(where + '：效果结构无法识别，已忽略');
        return null;
      }
      var def = varById[toText(raw.varId)];
      if (!def) {
        notes.push(where + '：效果引用了不存在的变量，已忽略');
        return null;
      }
      var op = EFFECT_OPS.indexOf(raw.op) >= 0 ? raw.op : 'set';
      if (def.type === 'bool' && op !== 'set') {
        notes.push(where + '：布尔变量 ' + def.name + ' 只支持赋值，已改为 set');
        op = 'set';
      }
      return {
        varId: def.id,
        op: op,
        value: def.type === 'bool' ? toBool(raw.value) : toNumber(raw.value)
      };
    }

    /* --- 节点 --- */
    var nodes = [];
    var nodeIds = {};
    var rawNodes = isArray(data.nodes) ? data.nodes : [];
    for (var j = 0; j < rawNodes.length; j++) {
      if (!isPlainObject(rawNodes[j])) continue;
      var rawNode = rawNodes[j];
      var node = createNode({
        id: rawNode.id,
        title: rawNode.title,
        text: rawNode.text,
        x: rawNode.x,
        y: rawNode.y
      });
      if (nodeIds[node.id]) {
        notes.push('节点 id 重复，已重新生成：' + node.id);
        node.id = uid('n');
      }
      nodeIds[node.id] = true;
      var where = '节点「' + (trimText(node.title) || node.id) + '」';

      var rawBranches = isArray(rawNode.branches) ? rawNode.branches : [];
      var branchIds = {};
      for (var b = 0; b < rawBranches.length; b++) {
        if (!isPlainObject(rawBranches[b])) continue;
        var rb = rawBranches[b];
        var br = createBranch({ id: rb.id, text: rb.text, target: toText(rb.target) });
        if (branchIds[br.id]) br.id = uid('b');
        branchIds[br.id] = true;
        br.condition = normalizeCondition(rb.condition, where + '的选项');
        var effects = [];
        var rawEffects = isArray(rb.effects) ? rb.effects : [];
        for (var e = 0; e < rawEffects.length; e++) {
          var ef = normalizeEffect(rawEffects[e], where + '的选项');
          if (ef) effects.push(ef);
        }
        br.effects = effects;
        node.branches.push(br);
      }

      var rawRules = isArray(rawNode.autoRules) ? rawNode.autoRules : [];
      var ruleIds = {};
      for (var r = 0; r < rawRules.length; r++) {
        if (!isPlainObject(rawRules[r])) continue;
        var rr = rawRules[r];
        var rule = createAutoRule({ id: rr.id, target: toText(rr.target) });
        if (ruleIds[rule.id]) rule.id = uid('a');
        ruleIds[rule.id] = true;
        rule.condition = normalizeCondition(rr.condition, where + '的自动跳转');
        node.autoRules.push(rule);
      }
      nodes.push(node);
    }

    if (!nodes.length) {
      nodes.push(createNode({ title: '开始', text: '在这里写下开场白。', x: 80, y: 80 }));
      notes.push('项目没有任何节点，已自动创建起始节点');
    }

    /* --- meta --- */
    var rawMeta = isPlainObject(data.meta) ? data.meta : {};
    var startNodeId = toText(rawMeta.startNodeId);
    if (!nodeIds[startNodeId]) {
      startNodeId = nodes[0].id;
      notes.push('起始节点无效，已指向第一个节点');
    }

    var project = {
      format: FORMAT,
      version: SCHEMA_VERSION,
      meta: {
        title: trimText(rawMeta.title) || '未命名故事',
        author: toText(rawMeta.author),
        startNodeId: startNodeId,
        createdAt: toText(rawMeta.createdAt) || nowIso(),
        updatedAt: toText(rawMeta.updatedAt) || nowIso()
      },
      variables: variables,
      nodes: nodes
    };

    return { project: project, notes: notes };
  }

  /** 取节点 id 集合，供运行期与校验使用 */
  function nodeIndex(project) {
    return indexById(project && isArray(project.nodes) ? project.nodes : []);
  }

  function variableById(project, varId) {
    var list = project && isArray(project.variables) ? project.variables : [];
    for (var i = 0; i < list.length; i++) if (list[i].id === varId) return list[i];
    return null;
  }

  /* ======================================================================
   * 四、条件求值与效果执行
   * ==================================================================== */

  /**
   * 条件求值。
   * @param {Object|null} cond  条件 AST（null 视为恒真）
   * @param {Object} vars       { 变量id: 值 }
   * @param {Object} [project]  项目（用于查变量类型）
   * @param {Function} [warn]   警告回调 warn(message)
   * @returns {boolean}
   */
  function evaluateCondition(cond, vars, project, warn) {
    vars = vars || {};
    var notify = typeof warn === 'function' ? warn : function () {};
    return evalOne(cond);

    function evalOne(node) {
      if (node === null || node === undefined) return true;
      if (!isPlainObject(node)) {
        notify('条件结构无法识别，已按“无条件”处理');
        return true;
      }
      if (node.type === 'group') {
        var items = isArray(node.items) ? node.items : [];
        if (!items.length) return true; // 空组 = 恒真
        if (node.op === 'any') {
          for (var i = 0; i < items.length; i++) if (evalOne(items[i])) return true;
          return false;
        }
        for (var j = 0; j < items.length; j++) if (!evalOne(items[j])) return false;
        return true;
      }
      return evalCompare(node);
    }

    function evalCompare(node) {
      var def = variableById(project, node.varId);
      var raw = vars[node.varId];
      if (!def) {
        // 没有项目上下文时，退回按值的类型判断
        if (project) {
          notify('条件引用了不存在的变量（' + toText(node.varId) + '）');
          return false;
        }
        def = { type: typeof raw === 'boolean' ? 'bool' : 'number', name: toText(node.varId) };
      }
      if (raw === undefined) {
        notify('变量「' + def.name + '」尚未初始化，按默认值 0/假 处理');
      }
      var op = COMPARE_OPS.indexOf(node.op) >= 0 ? node.op : '==';
      if (def.type === 'bool') {
        var current = toBool(raw);
        var want = toBool(node.value);
        if (op === '==') return current === want;
        if (op === '!=') return current !== want;
        notify('布尔变量「' + def.name + '」不支持 ' + op + '，条件按 false 处理');
        return false;
      }
      var currentNum = typeof raw === 'number' ? raw : Number(raw);
      var wantNum = toNumber(node.value);
      switch (op) {
        case '==': return currentNum === wantNum;
        case '!=': return currentNum !== wantNum;
        case '>': return currentNum > wantNum;
        case '>=': return currentNum >= wantNum;
        case '<': return currentNum < wantNum;
        case '<=': return currentNum <= wantNum;
        default: return false;
      }
    }
  }

  /**
   * 执行效果列表（就地修改 vars）。
   * @returns {Object} vars
   */
  function applyEffects(effects, vars, project, warn) {
    vars = vars || {};
    var notify = typeof warn === 'function' ? warn : function () {};
    var list = isArray(effects) ? effects : [];
    for (var i = 0; i < list.length; i++) {
      var ef = list[i];
      if (!isPlainObject(ef)) {
        notify('效果结构无法识别，已跳过');
        continue;
      }
      var def = variableById(project, ef.varId);
      if (!def) {
        notify('效果引用了不存在的变量（' + toText(ef.varId) + '），已跳过');
        continue;
      }
      var op = EFFECT_OPS.indexOf(ef.op) >= 0 ? ef.op : 'set';
      if (def.type === 'bool') {
        if (op !== 'set') notify('布尔变量「' + def.name + '」不支持 ' + op + '，已改为赋值');
        vars[def.id] = toBool(ef.value);
        continue;
      }
      var amount = toNumber(ef.value);
      var current = toNumber(vars[def.id]);
      if (op === 'add') vars[def.id] = current + amount;
      else if (op === 'sub') vars[def.id] = current - amount;
      else vars[def.id] = amount;
    }
    return vars;
  }

  /** 把条件渲染成可读文案，如「好感度 >= 5 且 (hasKey == true 或 金币 > 0)」 */
  function describeCondition(cond, project) {
    if (cond === null || cond === undefined) return '无条件';
    if (!isPlainObject(cond)) return '（无法识别的条件）';
    if (cond.type === 'group') {
      var items = isArray(cond.items) ? cond.items : [];
      if (!items.length) return '无条件';
      var joiner = cond.op === 'any' ? ' 或 ' : ' 且 ';
      var parts = [];
      for (var i = 0; i < items.length; i++) {
        var text = describeCondition(items[i], project);
        if (isPlainObject(items[i]) && items[i].type === 'group' && isArray(items[i].items) && items[i].items.length > 1) {
          text = '(' + text + ')';
        }
        parts.push(text);
      }
      return parts.join(joiner);
    }
    var def = variableById(project, cond.varId);
    var name = def ? def.name : '未命名变量';
    var op = COMPARE_OPS.indexOf(cond.op) >= 0 ? cond.op : '==';
    var valueText;
    if (def && def.type === 'bool') valueText = toBool(cond.value) ? 'true' : 'false';
    else valueText = toText(toNumber(cond.value));
    return name + ' ' + op + ' ' + valueText;
  }

  /** 把效果列表渲染成可读文案，如「好感度 +1；hasKey = 真」 */
  function describeEffects(effects, project) {
    var list = isArray(effects) ? effects : [];
    var parts = [];
    for (var i = 0; i < list.length; i++) {
      var ef = list[i];
      if (!isPlainObject(ef)) continue;
      var def = variableById(project, ef.varId);
      var name = def ? def.name : '未命名变量';
      var op = EFFECT_OPS.indexOf(ef.op) >= 0 ? ef.op : 'set';
      if (def && def.type === 'bool') {
        parts.push(name + ' = ' + (toBool(ef.value) ? '真' : '假'));
        continue;
      }
      var amount = toNumber(ef.value);
      if (op === 'add') parts.push(name + ' +' + amount);
      else if (op === 'sub') parts.push(name + ' -' + amount);
      else parts.push(name + ' = ' + amount);
    }
    return parts.join('；');
  }

  /* ======================================================================
   * 五、节点推进判定（纯函数）
   * ----------------------------------------------------------------------
   * 规则：先看有没有条件通过的选项 → 有则交给玩家选；
   *       没有可用选项时按顺序取第一条命中的自动跳转规则 → 静默转场；
   *       都没有 → 结局。
   * ==================================================================== */

  function evaluateNode(project, node, vars, warn) {
    var notify = typeof warn === 'function' ? warn : function () {};
    var index = nodeIndex(project);
    var branches = node && isArray(node.branches) ? node.branches : [];
    var visible = [];
    for (var i = 0; i < branches.length; i++) {
      if (evaluateCondition(branches[i].condition, vars, project, notify)) visible.push(branches[i]);
    }
    if (visible.length) {
      var choices = [];
      for (var k = 0; k < visible.length; k++) {
        choices.push({
          index: k,
          branchId: visible[k].id,
          text: visible[k].text,
          target: visible[k].target,
          description: describeCondition(visible[k].condition, project)
        });
      }
      return { kind: 'choices', choices: choices };
    }
    var rules = node && isArray(node.autoRules) ? node.autoRules : [];
    for (var r = 0; r < rules.length; r++) {
      if (!evaluateCondition(rules[r].condition, vars, project, notify)) continue;
      if (rules[r].target && index[rules[r].target]) {
        return {
          kind: 'jump',
          target: rules[r].target,
          ruleId: rules[r].id,
          conditionText: describeCondition(rules[r].condition, project)
        };
      }
      notify('自动跳转的目标节点不存在，已跳过该规则');
    }
    return { kind: 'ending' };
  }

  /* ======================================================================
   * 六、项目校验（编辑器校验面板使用；不修改数据）
   * ==================================================================== */

  function eachConditionRef(cond, visit) {
    if (!isPlainObject(cond)) return;
    if (cond.type === 'group') {
      var items = isArray(cond.items) ? cond.items : [];
      for (var i = 0; i < items.length; i++) eachConditionRef(items[i], visit);
      return;
    }
    visit(toText(cond.varId));
  }

  /** 统计某个变量被引用的次数（条件 + 效果），用于变量面板提示是否可安全删除 */
  function countVariableUsage(project, varId) {
    var count = 0;
    var nodes = project && isArray(project.nodes) ? project.nodes : [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var branches = isArray(node.branches) ? node.branches : [];
      for (var b = 0; b < branches.length; b++) {
        eachConditionRef(branches[b].condition, function (id) {
          if (id === varId) count++;
        });
        var effects = isArray(branches[b].effects) ? branches[b].effects : [];
        for (var e = 0; e < effects.length; e++) if (toText(effects[e].varId) === varId) count++;
      }
      var rules = isArray(node.autoRules) ? node.autoRules : [];
      for (var r = 0; r < rules.length; r++) {
        eachConditionRef(rules[r].condition, function (id) {
          if (id === varId) count++;
        });
      }
    }
    return count;
  }

  function issue(level, code, message, extra) {
    var out = { level: level, code: code, message: message };
    if (extra) {
      for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
    }
    return out;
  }

  /**
   * 校验项目，返回 Issue[]（level: 'error' | 'warn'）。
   * @returns {Array<{level:string, code:string, message:string, nodeId?:string, branchId?:string}>}
   */
  function validateProject(project) {
    var issues = [];
    if (!isPlainObject(project)) return [issue('error', 'project-invalid', '项目数据无效')];
    var index = nodeIndex(project);
    var varById = indexById(isArray(project.variables) ? project.variables : []);

    // 1) 变量名
    var nameSeen = {};
    var vars = isArray(project.variables) ? project.variables : [];
    for (var i = 0; i < vars.length; i++) {
      var name = trimText(vars[i].name);
      if (!name) {
        issues.push(issue('error', 'var-empty-name', '存在没有名称的变量'));
      } else if (nameSeen[name]) {
        issues.push(issue('warn', 'var-duplicate-name', '变量名重复：' + name));
      } else {
        nameSeen[name] = true;
      }
    }

    // 2) 起始节点
    var startId = project.meta ? toText(project.meta.startNodeId) : '';
    if (!index[startId]) {
      issues.push(issue('error', 'start-missing', '起始节点不存在，请重新设置起始节点'));
    }

    // 3) 逐节点检查结构
    var nodes = isArray(project.nodes) ? project.nodes : [];
    for (var n = 0; n < nodes.length; n++) {
      var node = nodes[n];
      var label = '节点「' + (trimText(node.title) || '未命名') + '」';
      if (!trimText(node.title)) {
        issues.push(issue('warn', 'node-empty-title', label + ' 没有标题', { nodeId: node.id }));
      }
      if (!trimText(node.text)) {
        issues.push(issue('warn', 'node-empty-text', label + ' 没有正文', { nodeId: node.id }));
      }
      var branches = isArray(node.branches) ? node.branches : [];
      for (var b = 0; b < branches.length; b++) {
        var br = branches[b];
        var brLabel = label + ' 的第 ' + (b + 1) + ' 个选项';
        if (!trimText(br.text)) {
          issues.push(issue('warn', 'branch-empty-text', brLabel + ' 没有选项文字', { nodeId: node.id, branchId: br.id }));
        }
        if (!toText(br.target)) {
          issues.push(issue('error', 'branch-no-target', brLabel + ' 没有设置目标节点', { nodeId: node.id, branchId: br.id }));
        } else if (!index[toText(br.target)]) {
          issues.push(issue('error', 'branch-target-missing', brLabel + ' 的目标节点不存在（悬空跳转）', { nodeId: node.id, branchId: br.id }));
        }
        var condMissing = false;
        eachConditionRef(br.condition, function (id) {
          if (id && !varById[id]) condMissing = true;
        });
        if (condMissing) {
          issues.push(issue('warn', 'cond-var-missing', brLabel + ' 的显示条件引用了已删除的变量', { nodeId: node.id, branchId: br.id }));
        }
        var effects = isArray(br.effects) ? br.effects : [];
        for (var e = 0; e < effects.length; e++) {
          if (!varById[toText(effects[e].varId)]) {
            issues.push(issue('warn', 'effect-var-missing', brLabel + ' 的执行效果引用了已删除的变量', { nodeId: node.id, branchId: br.id }));
          }
        }
      }
      var rules = isArray(node.autoRules) ? node.autoRules : [];
      for (var r = 0; r < rules.length; r++) {
        var rLabel = label + ' 的第 ' + (r + 1) + ' 条自动跳转';
        if (!toText(rules[r].target)) {
          issues.push(issue('error', 'rule-no-target', rLabel + ' 没有设置目标节点', { nodeId: node.id }));
        } else if (!index[toText(rules[r].target)]) {
          issues.push(issue('error', 'rule-target-missing', rLabel + ' 的目标节点不存在', { nodeId: node.id }));
        }
        var ruleCondMissing = false;
        eachConditionRef(rules[r].condition, function (id) {
          if (id && !varById[id]) ruleCondMissing = true;
        });
        if (ruleCondMissing) {
          issues.push(issue('warn', 'rule-cond-var-missing', rLabel + ' 的条件引用了已删除的变量', { nodeId: node.id }));
        }
      }
    }

    // 4) 可达性（从起始节点沿「选项 + 自动跳转」的边遍历）
    if (index[startId]) {
      var seen = {};
      var queue = [startId];
      seen[startId] = true;
      while (queue.length) {
        var cur = index[queue.shift()];
        if (!cur) continue;
        var targets = [];
        var bs = isArray(cur.branches) ? cur.branches : [];
        for (var bb = 0; bb < bs.length; bb++) targets.push(bs[bb].target);
        var rs = isArray(cur.autoRules) ? cur.autoRules : [];
        for (var rr = 0; rr < rs.length; rr++) targets.push(rs[rr].target);
        for (var t = 0; t < targets.length; t++) {
          var tid = toText(targets[t]);
          if (tid && index[tid] && !seen[tid]) {
            seen[tid] = true;
            queue.push(tid);
          }
        }
      }
      for (var u = 0; u < nodes.length; u++) {
        if (!seen[nodes[u].id]) {
          issues.push(issue('warn', 'node-unreachable', '节点「' + (trimText(nodes[u].title) || '未命名') + '」从起始节点无法到达', { nodeId: nodes[u].id }));
        }
      }
    }

    // 5) 纯自动跳转形成的环（A → B → A，途中没有被选项打断）
    var state = {};
    var cycles = [];
    function visitAuto(id, path) {
      if (state[id] === 2) return;
      if (state[id] === 1) {
        var at = path.indexOf(id);
        if (at >= 0) cycles.push(path.slice(at).concat([id]).join(' → '));
        return;
      }
      state[id] = 1;
      var nd = index[id];
      if (nd) {
        var arcs = isArray(nd.autoRules) ? nd.autoRules : [];
        for (var a = 0; a < arcs.length; a++) {
          var arcTarget = toText(arcs[a].target);
          if (arcTarget && index[arcTarget]) visitAuto(arcTarget, path.concat([arcTarget]));
        }
      }
      state[id] = 2;
    }
    for (var c = 0; c < nodes.length; c++) visitAuto(nodes[c].id, [nodes[c].id]);
    for (var cy = 0; cy < cycles.length; cy++) {
      issues.push(issue('warn', 'auto-cycle', '自动跳转可能形成环：' + cycles[cy]));
    }

    return issues;
  }

  /* ======================================================================
   * 七、会话（状态机）
   * ==================================================================== */

  function createEmitter() {
    var handlers = {};
    return {
      on: function (type, fn) {
        if (typeof fn !== 'function') return;
        (handlers[type] = handlers[type] || []).push(fn);
      },
      off: function (type, fn) {
        var list = handlers[type];
        if (!list) return;
        for (var i = list.length - 1; i >= 0; i--) if (list[i] === fn) list.splice(i, 1);
      },
      emit: function (type, payload) {
        var list = handlers[type];
        if (!list) return;
        var copy = list.slice();
        for (var i = 0; i < copy.length; i++) copy[i](payload);
      }
    };
  }

  /**
   * 创建一次游玩会话。
   * @param {Object} project 项目数据（内部会归一化并深拷贝，不污染编辑器数据）
   * @param {Object} [options] { startNodeId }
   */
  function createSession(project, options) {
    options = options || {};
    var data = normalizeProject(project).project;
    var index = nodeIndex(data);
    var emitter = createEmitter();
    var warnings = [];

    var defaultStartId = toText(options.startNodeId);
    if (!index[defaultStartId]) defaultStartId = data.meta.startNodeId;

    var vars = {};
    var history = [];
    var state = {
      nodeId: '',
      status: 'playing', // playing | ended | error
      lastError: '',
      choices: []
    };

    function resetVars() {
      vars = {};
      for (var i = 0; i < data.variables.length; i++) {
        var def = data.variables[i];
        vars[def.id] = def.type === 'bool' ? toBool(def.initial) : toNumber(def.initial);
      }
    }

    function pushWarning(message) {
      var text = toText(message);
      if (!text) return;
      for (var i = 0; i < warnings.length; i++) if (warnings[i] === text) return; // 去重，避免刷屏
      warnings.push(text);
      emitter.emit('warning', text);
    }

    /**
     * 进入某节点；若该节点只有自动跳转，会连续跳转直到出现选项或结局。
     * @param {string} nodeId
     * @param {Object} [opts] { silentEnded:boolean }
     */
    function enter(nodeId, opts) {
      opts = opts || {};
      var currentId = toText(nodeId);
      var steps = 0;
      while (true) {
        var node = index[currentId];
        if (!node) {
          pushWarning('节点不存在：' + currentId);
          state.nodeId = currentId;
          state.status = 'error';
          state.choices = [];
          state.lastError = '节点不存在：' + currentId;
          return;
        }
        var result = evaluateNode(data, node, vars, pushWarning);
        if (result.kind === 'jump') {
          steps++;
          if (steps > MAX_AUTO_STEPS) {
            state.nodeId = currentId;
            state.status = 'error';
            state.choices = [];
            state.lastError = '自动跳转超过 ' + MAX_AUTO_STEPS + ' 步，可能存在环';
            pushWarning(state.lastError);
            return;
          }
          currentId = result.target;
          continue;
        }
        state.nodeId = currentId;
        state.status = result.kind === 'ending' ? 'ended' : 'playing';
        state.choices = result.kind === 'choices' ? result.choices : [];
        state.lastError = '';
        if (result.kind === 'ending' && !opts.silentEnded) emitter.emit('ended', { nodeId: currentId });
        return;
      }
    }

    function snapshotForHistory() {
      return { nodeId: state.nodeId, vars: clone(vars) };
    }

    var session = {
      project: data,
      variables: data.variables,

      get nodeId() {
        return state.nodeId;
      },
      get node() {
        return index[state.nodeId] || null;
      },
      get nodeTitle() {
        var nd = index[state.nodeId];
        return nd ? nd.title : '';
      },
      get text() {
        var nd = index[state.nodeId];
        return nd ? nd.text : '';
      },
      get status() {
        return state.status;
      },
      get lastError() {
        return state.lastError;
      },
      get choices() {
        return state.choices.slice();
      },
      get vars() {
        return vars;
      },
      get warnings() {
        return warnings.slice();
      },
      get history() {
        return history.slice();
      },
      get stepCount() {
        return history.length;
      },
      get canGoBack() {
        return history.length > 0;
      },

      on: emitter.on,
      off: emitter.off,

      /** 开始 / 重新开始（不传则回到项目起始节点） */
      start: function (startNodeId) {
        history = [];
        warnings = [];
        resetVars();
        var id = toText(startNodeId);
        enter(index[id] ? id : defaultStartId);
        emitter.emit('change', session);
        return session;
      },

      restart: function (startNodeId) {
        return session.start(startNodeId);
      },

      /** 选择第 index 个可用选项 */
      choose: function (choiceIndex) {
        if (state.status !== 'playing') return session;
        var choice = state.choices[choiceIndex];
        if (!choice) {
          pushWarning('选项序号无效：' + choiceIndex);
          return session;
        }
        var node = index[state.nodeId];
        var branches = node && isArray(node.branches) ? node.branches : [];
        var branch = null;
        for (var i = 0; i < branches.length; i++) {
          if (branches[i].id === choice.branchId) branch = branches[i];
        }
        if (!branch) {
          pushWarning('选项已失效，请重新选择');
          return session;
        }
        var target = toText(branch.target);
        if (!target || !index[target]) {
          // 先校验目标再改数据，避免“点了选项变量变了却没跳转”的困惑
          pushWarning('该选项的目标节点不存在，无法跳转');
          emitter.emit('change', session);
          return session;
        }
        history.push(snapshotForHistory());
        applyEffects(branch.effects, vars, data, pushWarning);
        enter(target);
        emitter.emit('change', session);
        return session;
      },

      /** 回到上一步（恢复节点与变量） */
      back: function () {
        if (!history.length) return session;
        var prev = history.pop();
        vars = clone(prev.vars) || {};
        enter(prev.nodeId, { silentEnded: true });
        emitter.emit('change', session);
        return session;
      },

      /** 直接跳到某节点（调试用，不记入历史） */
      goto: function (nodeId) {
        var id = toText(nodeId);
        if (!index[id]) {
          pushWarning('节点不存在：' + id);
          return session;
        }
        enter(id);
        emitter.emit('change', session);
        return session;
      },

      /** 只读快照，供变量监视与测试断言使用 */
      snapshot: function () {
        var outVars = {};
        for (var k in vars) if (Object.prototype.hasOwnProperty.call(vars, k)) outVars[k] = vars[k];
        var choices = [];
        for (var i = 0; i < state.choices.length; i++) {
          choices.push({
            text: state.choices[i].text,
            target: state.choices[i].target,
            description: state.choices[i].description
          });
        }
        return {
          nodeId: state.nodeId,
          nodeTitle: session.nodeTitle,
          text: session.text,
          status: state.status,
          vars: outVars,
          choices: choices,
          stepCount: history.length,
          warnings: warnings.slice()
        };
      }
    };

    session.start(toText(options.startNodeId));
    return session;
  }

  /** 生成初始变量表（编辑器预览面板显示初始值时用） */
  function initialVars(project) {
    var out = {};
    var list = project && isArray(project.variables) ? project.variables : [];
    for (var i = 0; i < list.length; i++) {
      out[list[i].id] = list[i].type === 'bool' ? toBool(list[i].initial) : toNumber(list[i].initial);
    }
    return out;
  }

  /* ======================================================================
   * 八、对外 API
   * ==================================================================== */

  return {
    VERSION: VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
    FORMAT: FORMAT,
    MAX_AUTO_STEPS: MAX_AUTO_STEPS,

    // 工具
    uid: uid,
    clone: clone,

    // 工厂
    createProject: createProject,
    createNode: createNode,
    createVariable: createVariable,
    createBranch: createBranch,
    createAutoRule: createAutoRule,
    createCondition: createCondition,
    createGroup: createGroup,
    createEffect: createEffect,

    // 归一化与校验
    normalizeProject: normalizeProject,
    validateProject: validateProject,
    countVariableUsage: countVariableUsage,
    initialVars: initialVars,

    // 运行期纯函数
    evaluateCondition: evaluateCondition,
    applyEffects: applyEffects,
    evaluateNode: evaluateNode,
    describeCondition: describeCondition,
    describeEffects: describeEffects,

    // 会话
    createSession: createSession
  };
});
