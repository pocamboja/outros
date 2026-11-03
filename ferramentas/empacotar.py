#!/usr/bin/env python3
"""Gera o index.html da raiz (tudo num só ficheiro) a partir de codigo-fonte/.

Troca cada <link rel="stylesheet" href="css/..."> por um <style> e cada
<script src="js/..."></script> por um <script> com o código lá dentro.
Uso:  python3 ferramentas/empacotar.py  [pasta-fonte] [saída]
"""
import re
import sys
from pathlib import Path

raiz = Path(__file__).resolve().parent.parent
fonte = Path(sys.argv[1]) if len(sys.argv) > 1 else raiz / 'codigo-fonte'
saida = Path(sys.argv[2]) if len(sys.argv) > 2 else raiz / 'index.html'

html = (fonte / 'index.html').read_text(encoding='utf-8')


def css(m):
    return '<style>\n' + (fonte / m.group(1)).read_text(encoding='utf-8') + '\n</style>'


def js(m):
    return '<script>\n' + (fonte / m.group(1)).read_text(encoding='utf-8') + '\n</script>'


html = re.sub(r'<link rel="stylesheet" href="([^"]+)" />', css, html)
html = re.sub(r'<script src="([^"]+)"></script>', js, html)
saida.write_text(html, encoding='utf-8')
print(f'{saida} ({len(html.encode("utf-8")) // 1024} KB)')
