"""把某个 .dsh 会话文件解成测试 fixture（header + events 的 JSON）。

用法（PowerShell）：
    python _dsh-plugins/session-doc-export/test/make-fixture.py [session目录] [输出json]

不传参数时默认取当前工作区最近写入的会话。
"""

import json
import sys
import zstandard
from pathlib import Path

DEFAULT_OUT = Path(__file__).with_name("fixture.json")


def newest_session() -> Path:
    root = Path.home() / ".dsh" / "sessions"
    files = sorted(root.rglob("session.v4.jsonl.zstd"), key=lambda p: p.stat().st_mtime)
    if not files:
        raise SystemExit("找不到任何会话文件")
    return files[-1]


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else newest_session()
    if source.is_dir():
        source = source / "session.v4.jsonl.zstd"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT

    with open(source, "rb") as handle:
        raw = zstandard.ZstdDecompressor().stream_reader(handle).read()
    rows = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line.strip()]

    header = rows[0]
    events = [row for row in rows[1:] if "seq" in row]
    out.write_text(
        json.dumps({"header": header, "events": events}, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"来源: {source}")
    print(f"输出: {out}")
    print(f"事件: {len(events)}")


if __name__ == "__main__":
    main()
