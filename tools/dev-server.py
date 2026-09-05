#!/usr/bin/env python3
"""Servidor estatico do dev: igual ao `python3 -m http.server`, mas sem cache.

Sem o no-store, o browser guarda um src/*.js velho e o worker morre no load com um erro
de import que nao existe no codigo em disco ("does not provide an export named X").
Hard reload nem sempre resolve: o grafo de modulos do worker e buscado fora do contexto
da pagina, entao ele escapa do bypass de cache do reload.
"""
import http.server, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

http.server.test(HandlerClass=NoCache, bind="127.0.0.1",
                 port=int(sys.argv[1]) if len(sys.argv) > 1 else 8000)
