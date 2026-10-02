#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""重新生成 core/engine-source.js

把 core/story-engine.js 的内容转义成一个字符串常量，供编辑器在导出 HTML 时
把引擎源码原样内联进导出物（file:// 下无法 fetch 本地文件）。

用法：python tools/build_engine_source.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'core', 'story-engine.js')
OUT = os.path.join(ROOT, 'core', 'engine-source.js')

HEADER = """/*!
 * engine-source.js — 自动生成，请勿手改！
 * 源文件：core/story-engine.js
 * 重新生成：python tools/build_engine_source.py
 *
 * 作用：把引擎源码作为字符串提供给编辑器（window.STORY_ENGINE_SOURCE），
 *       导出 HTML 时原样内联，保证预览与导出的运行逻辑逐字节一致。
 */
"""


def main():
    with open(SRC, 'r', encoding='utf-8') as fp:
        src = fp.read()

    if '</' + 'script>' in src.lower():
        raise SystemExit('引擎源码里出现了 </script>，无法安全内联到 HTML')

    # JSON 转义后的字符串在 JavaScript 里同样合法
    payload = json.dumps(src, ensure_ascii=False)
    # 防止导出物里的 <script> 块被提前闭合
    payload = payload.replace('</', '<\\/')
    # U+2028 / U+2029 是 JSON 合法字符但会破坏旧引擎的 JS 字符串解析
    payload = payload.replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')

    with open(OUT, 'w', encoding='utf-8', newline='\n') as fp:
        fp.write(HEADER)
        fp.write('window.STORY_ENGINE_SOURCE = ')
        fp.write(payload)
        fp.write(';\n')

    print('已生成 %s（%d 字节源码 → %d 字节文件）' % (OUT, len(src), os.path.getsize(OUT)))


if __name__ == '__main__':
    main()
