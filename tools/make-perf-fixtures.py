#!/usr/bin/env python3
"""生成性能与编码测试物料（不入 git，按需重建）。

    python tools/make-perf-fixtures.py

产物（perf/，已在 .gitignore 中忽略）:
    perf-1mb.md / perf-5mb.md / perf-10mb.md   大文档性能测试
    gbk-sample.md                              GBK 编码（验证编码自动识别）
    crlf-sample.md                             CRLF 换行
"""
import os

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'perf')


def block(i: int) -> str:
    return f"""## 小节 {i}

这是第 {i} 段正文，用于测试大文档的渲染与编辑性能。包含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com/{i})。

| 列A | 列B | 列C |
| --- | --- | --- |
| {i} | {i * 2} | {i * 3} |

```js
const value{i} = {i}
console.log(value{i})
```

行内公式 $a_{i} = b_{i}^2 + c_{i}$。

"""


def main() -> None:
    os.makedirs(OUT, exist_ok=True)

    for target_mb, name in ((1, 'perf-1mb.md'), (5, 'perf-5mb.md'), (10, 'perf-10mb.md')):
        path = os.path.join(OUT, name)
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write('# 性能测试文档\n\n')
            i = 0
            while fh.tell() < target_mb * 1024 * 1024:
                i += 1
                fh.write(block(i))
        print('%-14s %6.2f MB' % (name, os.path.getsize(path) / 1048576))

    gbk = "# 编码测试\n\n这是一段 GBK 编码的中文文本，用来验证打开文件时的编码自动识别。\n\n- 第一项\n- 第二项\n"
    with open(os.path.join(OUT, 'gbk-sample.md'), 'wb') as fh:
        fh.write(gbk.encode('gbk'))
    print('%-14s %d bytes (GBK)' % ('gbk-sample.md', os.path.getsize(os.path.join(OUT, 'gbk-sample.md'))))

    crlf = "# CRLF 测试\r\n\r\n第二行\r\n第三行\r\n"
    with open(os.path.join(OUT, 'crlf-sample.md'), 'wb') as fh:
        fh.write(crlf.encode('utf-8'))
    print('%-14s %d bytes (CRLF)' % ('crlf-sample.md', len(crlf.encode('utf-8'))))


if __name__ == '__main__':
    main()
