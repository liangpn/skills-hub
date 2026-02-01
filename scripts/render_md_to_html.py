#!/usr/bin/env python3
"""
Minimal, stdlib-only Markdown -> standalone HTML renderer.

Goals:
- Offline readable (self-contained CSS).
- Preserve code fences (including ```mermaid blocks) as <pre><code>.
- Generate a simple table of contents from headings.

This is intentionally a small subset of Markdown that matches how we write internal docs.
"""

from __future__ import annotations

import argparse
import html
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Tuple


@dataclass(frozen=True)
class Heading:
    level: int
    text: str
    anchor: str


def slugify(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE)
    text = re.sub(r"\s+", "-", text)
    text = re.sub(r"-{2,}", "-", text)
    return text or "section"


def render_inlines(s: str) -> str:
    # Order matters: escape first, then add markup.
    escaped = html.escape(s, quote=False)

    # Inline code: `code`
    escaped = re.sub(
        r"`([^`]+)`",
        lambda m: f"<code>{html.escape(m.group(1), quote=False)}</code>",
        escaped,
    )

    # Links: [text](url)
    escaped = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda m: f'<a href="{html.escape(m.group(2), quote=True)}">{html.escape(m.group(1), quote=False)}</a>',
        escaped,
    )

    # Bold: **text**
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", escaped)
    return escaped


def build_toc(headings: List[Heading]) -> str:
    if not headings:
        return ""

    out: List[str] = []
    current_level = 0

    def open_list():
        out.append("<ul>")

    def close_list():
        out.append("</ul>")

    open_list()
    current_level = 1
    for h in headings:
        level = max(1, min(6, h.level))
        while current_level < level:
            open_list()
            current_level += 1
        while current_level > level:
            close_list()
            current_level -= 1
        out.append(
            f'<li><a href="#{html.escape(h.anchor, quote=True)}">{html.escape(h.text, quote=False)}</a></li>'
        )

    while current_level > 1:
        close_list()
        current_level -= 1
    close_list()
    return "\n".join(out)


def iter_blocks(md_lines: Iterable[str]) -> Tuple[str, List[Heading]]:
    body: List[str] = []
    headings: List[Heading] = []

    in_code = False
    code_lang: Optional[str] = None
    code_lines: List[str] = []

    in_list = False
    list_items: List[str] = []

    paragraph: List[str] = []

    def flush_paragraph():
        nonlocal paragraph
        if not paragraph:
            return
        text = " ".join([p.strip() for p in paragraph]).strip()
        if text:
            body.append(f"<p>{render_inlines(text)}</p>")
        paragraph = []

    def flush_list():
        nonlocal in_list, list_items
        if not in_list:
            return
        body.append("<ul>")
        for item in list_items:
            body.append(f"<li>{render_inlines(item.strip())}</li>")
        body.append("</ul>")
        in_list = False
        list_items = []

    def flush_code():
        nonlocal in_code, code_lang, code_lines
        if not in_code:
            return
        lang_class = f"language-{code_lang}" if code_lang else ""
        code_text = "\n".join(code_lines)
        body.append(
            f'<pre><code class="{html.escape(lang_class, quote=True)}">{html.escape(code_text, quote=False)}</code></pre>'
        )
        in_code = False
        code_lang = None
        code_lines = []

    for raw in md_lines:
        line = raw.rstrip("\n")

        # Code fences
        if line.startswith("```"):
            flush_paragraph()
            flush_list()
            if in_code:
                flush_code()
            else:
                in_code = True
                code_lang = line[3:].strip() or None
                code_lines = []
            continue

        if in_code:
            code_lines.append(line)
            continue

        # Headings
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            flush_paragraph()
            flush_list()
            level = len(m.group(1))
            text = m.group(2).strip()
            anchor = slugify(text)
            # Ensure uniqueness
            if any(h.anchor == anchor for h in headings):
                suffix = 2
                while any(h.anchor == f"{anchor}-{suffix}" for h in headings):
                    suffix += 1
                anchor = f"{anchor}-{suffix}"
            headings.append(Heading(level=level, text=text, anchor=anchor))
            body.append(
                f'<h{level} id="{html.escape(anchor, quote=True)}">{render_inlines(text)}</h{level}>'
            )
            continue

        # Horizontal rule
        if line.strip() in {"---", "***", "___"}:
            flush_paragraph()
            flush_list()
            body.append("<hr />")
            continue

        # Blockquote (single line, minimal)
        if line.startswith(">"):
            flush_paragraph()
            flush_list()
            body.append(f"<blockquote>{render_inlines(line.lstrip('>').strip())}</blockquote>")
            continue

        # Lists
        if line.startswith("- "):
            flush_paragraph()
            in_list = True
            list_items.append(line[2:])
            continue

        # Blank line flushes paragraph/list
        if not line.strip():
            flush_paragraph()
            flush_list()
            continue

        # Default: paragraph line
        paragraph.append(line)

    flush_paragraph()
    flush_list()
    flush_code()
    return ("\n".join(body), headings)


def render_html(md_path: Path, title: str) -> str:
    md_text = md_path.read_text(encoding="utf-8")
    body_html, headings = iter_blocks(md_text.splitlines())
    toc_html = build_toc(headings)

    css = """
    :root {
      --bg: #0b0f14;
      --panel: #0f1621;
      --text: #e6edf3;
      --muted: #9aa7b5;
      --border: #1f2a37;
      --link: #7aa2f7;
      --code-bg: #0b1220;
    }
    html, body { background: var(--bg); color: var(--text); margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 28px 20px 64px; display: grid; grid-template-columns: 320px 1fr; gap: 24px; }
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; }
    .toc { position: sticky; top: 16px; padding: 16px; height: fit-content; }
    .toc h2 { margin: 0 0 12px; font-size: 14px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
    .toc ul { list-style: none; padding-left: 0; margin: 0; }
    .toc li { margin: 6px 0; line-height: 1.35; }
    .toc ul ul { padding-left: 14px; border-left: 1px solid var(--border); margin-left: 6px; }
    .content { padding: 22px 22px 28px; }
    h1 { font-size: 28px; margin-top: 0; }
    h2 { font-size: 20px; margin-top: 28px; padding-top: 6px; border-top: 1px solid var(--border); }
    h3 { font-size: 16px; margin-top: 22px; }
    p { line-height: 1.6; color: var(--text); }
    blockquote { margin: 14px 0; padding: 10px 14px; border-left: 3px solid var(--border); background: rgba(255,255,255,0.03); color: var(--muted); }
    hr { border: 0; border-top: 1px solid var(--border); margin: 22px 0; }
    code { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 0.95em; }
    pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 12px; padding: 14px 14px; overflow: auto; }
    pre code { background: transparent; padding: 0; display: block; white-space: pre; }
    ul { padding-left: 20px; }
    li { margin: 6px 0; }
    @media (max-width: 980px) {
      .wrap { grid-template-columns: 1fr; }
      .toc { position: static; }
    }
    """

    toc_panel = (
        f'<aside class="card toc"><h2>Contents</h2>{toc_html}</aside>' if toc_html else ""
    )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{html.escape(title, quote=False)}</title>
  <style>{css}</style>
</head>
<body>
  <div class="wrap">
    {toc_panel}
    <main class="card content">
      {body_html}
    </main>
  </div>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="Markdown input file")
    parser.add_argument("output", type=Path, help="HTML output file")
    parser.add_argument("--title", type=str, default=None, help="HTML document title")
    args = parser.parse_args()

    md_path: Path = args.input
    out_path: Path = args.output
    title = args.title or md_path.stem

    html_text = render_html(md_path, title=title)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html_text, encoding="utf-8")

    rel_in = os.fspath(md_path)
    rel_out = os.fspath(out_path)
    print(f"Rendered {rel_in} -> {rel_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

