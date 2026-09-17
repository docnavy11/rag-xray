#!/usr/bin/env python3
"""Turn the .dc.html artboards into plain pages a browser can open.

An artboard is a canvas format: a <helmet> block that belongs in <head>, an
<x-dc> wrapper, and a support.js the canvas runtime substitutes at render time.
None of that survives outside the canvas, so this lifts the helmet into a real
<head>, drops the wrapper, and hangs the fixed-size root in a viewer that scales
it to whatever window it lands in.
"""
import re
import pathlib

SRC = pathlib.Path(__file__).parent / "mockups"
OUT = pathlib.Path(__file__).parent / "dist"

SCREENS = [
    ("Shelf.dc.html",    "1-shelf.html",  "Pick a corpus", 1440, 900,
     "Four corpora, four chatbots. Choosing one re-skins the whole app."),
    ("Main.dc.html",     "2-chat.html",   "Chat",          1440, 900,
     "The answer, its citations, and the source span that was actually verified."),
    ("Xray.dc.html",     "3-xray.html",   "X-ray",         1440, 960,
     "The agent loop on top; the retrieval pipeline nested inside the tool call."),
    ("XrayDiff.dc.html", "4-diff.html",   "Counterfactual",1440, 960,
     "Reciprocal rank fusion switched off. Free, instant, no model called."),
]

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>{title} &middot; RAG X-Ray</title>
{helmet}
<style>
  html{{background:#E9EBE6}}
  body{{margin:0;background:#E9EBE6}}
  .nav{{position:sticky;top:0;z-index:10;background:#171A17;color:#E8EBE6;display:flex;align-items:center;
       gap:4px;padding:0 14px;height:44px;font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:11.5px;
       letter-spacing:.06em;overflow-x:auto;white-space:nowrap}}
  .nav a{{color:#A7AEA5;text-decoration:none;padding:6px 11px;border-radius:4px;flex:none}}
  .nav a:hover{{color:#fff;background:#282D27}}
  .nav a.on{{color:#0E5C5E;background:#5FD4D2}}
  .nav .sp{{flex-grow:1}}
  .nav .cap{{color:#7B827A;flex:none}}
  .cap-line{{max-width:1440px;margin:0 auto;padding:16px 16px 0;font-family:"IBM Plex Sans",system-ui,sans-serif;
            font-size:14px;line-height:1.5;color:#4A4F49}}
  .stage{{margin:14px auto 40px;padding:0 16px;max-width:1472px;overflow:hidden}}
  .stage > div{{transform-origin:top left;box-shadow:0 2px 6px rgba(20,24,20,.10),0 24px 60px -30px rgba(20,24,20,.55);
               border-radius:8px;overflow:hidden}}
</style>
</head>
<body>
<nav class="nav">{navlinks}<span class="sp"></span><span class="cap">{w}&times;{h}</span></nav>
<p class="cap-line">{caption}</p>
<div class="stage" data-w="{w}" data-h="{h}">
"""

FOOT = """</div>
<script>
(function(){
  var st = document.querySelector('.stage');
  var art = st.firstElementChild;
  var W = +st.dataset.w, H = +st.dataset.h;
  function fit(){
    var avail = st.clientWidth;
    var s = Math.min(1, avail / W);
    art.style.transform = 'scale(' + s + ')';
    st.style.height = (H * s) + 'px';
  }
  fit();
  window.addEventListener('resize', fit);
})();
</script>
</body>
</html>
"""


def convert(path: pathlib.Path) -> tuple[str, str]:
    raw = path.read_text(encoding="utf-8")
    helmet = ""
    m = re.search(r"<helmet>(.*?)</helmet>", raw, re.S)
    if m:
        helmet = m.group(1).strip()
    m = re.search(r"<x-dc>(.*?)</x-dc>", raw, re.S)
    body = m.group(1) if m else raw
    body = re.sub(r"<helmet>.*?</helmet>", "", body, flags=re.S).strip()
    return helmet, body


def nav(current: str) -> str:
    out = ['<a href="./" style="color:#E8EBE6">RAG X-Ray</a>']
    for i, (_, slug, label, _w, _h, _c) in enumerate(SCREENS, 1):
        on = " class=\"on\"" if slug == current else ""
        out.append(f'<a href="{slug}"{on}>{i} &middot; {label}</a>')
    return "".join(out)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for src, slug, label, w, h, caption in SCREENS:
        helmet, body = convert(SRC / src)
        page = HEAD.format(title=label, helmet=helmet, navlinks=nav(slug),
                           w=w, h=h, caption=caption) + body + FOOT
        (OUT / slug).write_text(page, encoding="utf-8")
        print(f"  {src:22s} -> dist/{slug}")

    cards = []
    for i, (src, slug, label, w, h, caption) in enumerate(SCREENS, 1):
        _, body = convert(SRC / src)
        scale = 640 / w
        cards.append(f"""
      <a href="{slug}" class="card">
        <div class="shot" style="height:{int(h*scale)}px">
          <div style="transform:scale({scale});transform-origin:top left;width:{w}px;height:{h}px">{body}</div>
        </div>
        <div class="meta"><span class="n">{i}</span><b>{label}</b><span class="d">{caption}</span></div>
      </a>""")

    index = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>RAG X-Ray &middot; screen mockups</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  :root{--paper:#F3F4F1;--ink:#171A17;--ink-2:#4A4F49;--ink-3:#787E76;--rule:#D6D9D2;--accent:#0E5C5E}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);
       font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:16px;line-height:1.62}
  header{background:#fff;border-bottom:1px solid var(--rule);padding:30px 24px 26px}
  .in{max-width:1400px;margin:0 auto}
  .kick{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;
        color:var(--accent);margin-bottom:12px}
  h1{font-size:clamp(25px,3.2vw,34px);font-weight:600;letter-spacing:-.028em;margin:0;line-height:1.15}
  header p{color:var(--ink-2);margin:11px 0 0;max-width:66ch;font-size:16px}
  .grid{max-width:1400px;margin:0 auto;padding:26px 24px 60px;
        display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:26px}
  .card{display:block;text-decoration:none;color:inherit}
  .shot{background:#fff;border:1px solid var(--rule);border-radius:8px;overflow:hidden;
        box-shadow:0 1px 2px rgba(20,24,20,.05),0 14px 34px -22px rgba(20,24,20,.5);
        transition:box-shadow .18s ease, transform .18s ease}
  .card:hover .shot{box-shadow:0 2px 6px rgba(20,24,20,.10),0 22px 48px -22px rgba(20,24,20,.6);transform:translateY(-2px)}
  .meta{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;padding:13px 2px 0;align-items:baseline}
  .meta .n{font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--accent);grid-row:span 2}
  .meta b{font-size:16px;font-weight:600;letter-spacing:-.015em}
  .meta .d{font-size:13.5px;color:var(--ink-3);line-height:1.45}
  footer{border-top:1px solid var(--rule);background:#fff;padding:22px 24px 40px;
         font-size:13px;color:var(--ink-3);line-height:1.6}
  @media (max-width:700px){.grid{gap:20px;padding:20px 16px 40px}header{padding:24px 16px 22px}}
</style>
</head>
<body>
<header><div class="in">
  <div class="kick">Screen mockups &middot; not a running app</div>
  <h1>RAG X-Ray</h1>
  <p>Four screens for a retrieval demo whose point is that you can see how it works: pick a corpus, ask it something, then open the X-ray and switch a retrieval decision off to watch the ranking move.</p>
</div></header>
<div class="grid">__CARDS__</div>
<footer><div class="in">
  Provision text and every measured figure are real. Timings, costs and trace ids are sample values &mdash; and the costs in particular, because the measured ones were on Gemini&nbsp;Flash and Sonnet through OpenRouter and do not carry over to claude-opus-5.
</div></footer>
</body>
</html>
"""
    (OUT / "index.html").write_text(index.replace("__CARDS__", "".join(cards)),
                                    encoding="utf-8")
    print("  index                  -> dist/index.html")


if __name__ == "__main__":
    main()
