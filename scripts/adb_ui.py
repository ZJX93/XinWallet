#!/usr/bin/env python3
"""纯本地解析器：读取 adb pull 下来的 uiautomator XML，按文本定位坐标。
adb 调用放在 Bash 里执行（git bash 能找到 adb），本脚本只解析 XML。

用法：
  python adb_ui.py                  # 打印所有带 text 的节点(文本+中心坐标)
  python adb_ui.py text <keyword>  # 打印含 keyword 的节点坐标
"""
import sys
import re
import xml.etree.ElementTree as ET
import os

LOCAL_UI = os.path.join(os.path.dirname(__file__), "_ui_dump.xml")


def nodes():
    tree = ET.parse(LOCAL_UI)
    out = []
    for n in tree.iter("node"):
        b = n.get("bounds") or ""
        m = re.findall(r"\d+", b)
        if len(m) >= 4:
            x1, y1, x2, y2 = map(int, m[:4])
            out.append({
                "text": n.get("text") or "",
                "rid": n.get("resource-id") or "",
                "cx": (x1 + x2) // 2,
                "cy": (y1 + y2) // 2,
                "bounds": b,
            })
    return out


def main():
    kw = sys.argv[1] if len(sys.argv) > 1 else ""
    ns = nodes()
    if kw == "text":
        kw = sys.argv[2] if len(sys.argv) > 2 else ""
        ns = [n for n in ns if kw in n["text"]]
    for n in ns:
        if n["text"].strip():
            print(f"  ({n['cx']:>4},{n['cy']:>4})  {n['text']!r}")


if __name__ == "__main__":
    main()
