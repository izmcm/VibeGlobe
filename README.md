# VibeGlobe

**Quanto do mundo você já pisou?** Você joga o histórico de fotos do Google Takeout na
página e ela devolve um mapa com os países pintados, a fração da terra firme do planeta
que você de fato alcançou (área a até 25 km de alguma foto, não o país inteiro),
continentes, lugares distintos, extremos e curiosidades.

**Nada sai do navegador.** Não existe backend, nem chave de API, nem requisição de rede
depois que a página carrega. As fronteiras vêm de um arquivo do próprio site e o
reverse geocoding é feito em JavaScript, no seu computador. É por isso que dá pra
hospedar de graça no GitHub Pages: o site é só arquivo estático.

## Como pegar suas fotos no Google Takeout

1. Vá em [takeout.google.com](https://takeout.google.com).
2. **Desmarcar tudo** e marcar **somente Google Fotos** — o resto é peso morto e o
   download demora horas à toa.
3. Em "Vários formatos", confira que os metadados saem em **JSON** (é o padrão).
4. Exportar → tipo de arquivo **.zip**, tamanho 2 GB ou 4 GB.
5. Quando o e-mail chegar, baixe os `.zip` e arraste **os arquivos .zip fechados** para a
   página. Não precisa descompactar: o site lê só os `.json` de dentro e nem toca nos
   bytes das fotos.

Aceita também `.json` soltos e `.csv` com colunas `latitude`/`longitude` (e, se quiser
data, `timestamp` ISO ou `epoch`); campos entre aspas podem conter vírgula. O botão
**Ver exemplo** carrega [`public/sample.csv`](public/sample.csv) na hora: 1.499 fotos em
31 destinos, agrupadas como um acervo de verdade — várias por lugar, não uma por cidade.
Gerado por [`tools/build-sample.mjs`](tools/build-sample.mjs) com seed fixa
(`npm run sample`), então os testes travam os números.

## Rodando local

```sh
npm run dev     # http://localhost:8000
npm test        # node --test: geocoding, parsers, area alcancada e leitura de zip
```

`npm run dev` é um `http.server` com **`Cache-Control: no-store`**
([`tools/dev-server.py`](tools/dev-server.py)). Não é frescura: sem isso o browser
guarda um `src/*.js` velho e o worker morre no load com um erro de import que não existe
no código em disco (*"does not provide an export named X"*). Hard reload nem sempre
resolve — o grafo de módulos do worker é buscado fora do contexto da página e escapa do
bypass de cache do reload.

Não tem build. É ESM nativo + Web Worker nativo; um servidor estático qualquer serve.
(Abrir o `index.html` por `file://` **não** funciona — módulos e workers exigem http.)

## Como funciona o reverse geocoding sem servidor

`public/borders.json` é o Natural Earth 50m (`ne_50m_admin_0_countries`), podado para
três propriedades e arredondado a 4 casas decimais: 1,8 MB, ~670 KB comprimido. Para
regerar: `npm run borders`.

- **Ponto em polígono** com ray casting, primeiro anel = contorno, demais = buracos.
- **Uma bbox por polígono, não por país.** Países que cruzam o antimeridiano (Nova
  Zelândia, Rússia, EUA, Fiji) têm bbox de país indo de -180 a 180 e capturariam o
  planeta inteiro no pré-filtro. Indexar cada polígono do MultiPolygon separadamente
  resolve.
- **Grade de 10°** sobre esses polígonos: cada ponto compara com ~10 candidatos em vez
  de ~4000. É o que mantém 50 mil pontos rodando em segundos.
- **Fallback de costa** para praia, ilha e jitter de GPS: país com o vértice real mais
  próximo (haversine), aceitando até 75 km. Distância até a *bbox* não serve — Lisboa
  cai dentro da bbox da Espanha.
- **% de terra firme** = área alcançada ÷ terra firme total (sem a Antártida), com o
  total somado dos próprios polígonos por excesso esférico: **134.675.776 km²**, contra
  ~134,7 milhões da realidade.

### A área alcançada

A porcentagem é a **área de terra firme a até 25 km de alguma foto**
([`src/stats.js`](src/stats.js)) — não a área dos países visitados. Uma foto em
Vladivostok soma ~1.963 km² à porcentagem, e não os 16,9 milhões de km² da Rússia.
(O **mapa**, esse sim, pinta o país inteiro: veja *Limitações* abaixo.)

1. cada foto marca as células de uma grade de 0,1° (~11 km) cujo **centro** está a até
   25 km dela — círculo, não quadrado, medido por haversine;
2. marcar numa grade resolve a união de graça: dez fotos da mesma rua marcam as mesmas
   células e a área não conta dez vezes;
3. cada célula distinta passa por ponto-em-polígono. **Só as que caem em terra contam** —
   sem isso, uma foto na praia levaria 20 km de mar aberto junto. Esse teste não usa o
   encaixe de costa de 75 km: ele existe pra salvar a foto da praia, não pra medir chão;
4. a área de cada célula é exata na esfera: `R² · Δλ · (sen φ₂ − sen φ₁)`.

O raio de 25 km é a constante `REACH_KM`. A grade de ~11 km deixa a costa com erro de
cerca de uma célula pra mais ou pra menos; diminuir a célula melhora e custa tempo
linearmente (50 mil fotos levam ~740 ms hoje).

**A sobreposição é o caso normal, não a exceção** — ninguém tira uma foto por cidade.
Os testes usam um acervo sintético de 20 destinos com centenas de fotos em cada, e
travam o comportamento:

| fotos | chão medido | se cada foto contasse seu disco | medido / ingênuo |
|------:|------------:|--------------------------------:|-----------------:|
|    20 |  26.807 km² |                       39.270 km² |           68,3% |
|   500 |  35.463 km² |                      981.748 km² |            3,6% |
| 8.000 |  37.498 km² |                   15.707.963 km² |            0,24% |

400× mais fotos nos mesmos lugares dão 1,4× a área — e esse crescimento é a pessoa
circulando pela cidade, não repetição. Duplicar o acervo inteiro muda a área em
**exatamente 0 km²**. A união de dois discos também é conferida contra a fórmula
analítica de interseção de círculos.

O `.zip` é lido pelo diretório central com `DecompressionStream` nativo (inclusive
zip64, que um Takeout de fotos estoura fácil), fatiando só as entradas `.json`. Um
Takeout de 10 GB nunca entra inteiro na memória — que é o que aconteceria com JSZip.

Parsing, geocoding e contas rodam num Web Worker; a barra de progresso é o worker
falando com a página.

O mapa é `<canvas>` puro, na projeção **Natural Earth**: o polinômio do `d3-geo` cabe em
8 linhas ([`src/app.js`](src/app.js)), e como a projeção é fixa, cada país vira um
`Path2D` já projetado **uma vez** — daí mover e dar zoom continua sendo transformação
afim, um `setTransform` por quadro, zero reprojeção em JS. Sem tiles, sem servidor de
mapas, sem biblioteca de mapa.

As fontes (Archivo e IBM Plex Mono, ambas OFL) são servidas de
[`public/fonts/`](public/fonts/), não do Google Fonts: um request pro Google entregaria o
IP de quem visita, e a página inteira promete o contrário. 85 KB no total.

## Limitações conhecidas

- Ilhas pequenas demais para o dataset 50m (Fernando de Noronha, por exemplo) não
  existem no arquivo de fronteiras e caem como "mar aberto". Subir o raio de 75 km
  consertaria Noronha e quebraria fotos tiradas em voos transatlânticos.
- A projeção Natural Earth é de leitura, não de navegação: as áreas não são exatas na
  tela. A conta de "% de terra firme" não usa a projeção — é área geodésica, feita nos
  polígonos.
- "Lugares distintos" é uma grade de ~20 km, não uma lista de cidades de verdade.
- Sem build, cada módulo é uma URL com cache própria. O GitHub Pages manda
  `max-age=600`, então logo depois de um deploy existe uma janela de até 10 minutos em
  que alguém pode pegar dois módulos de versões diferentes. Se resolve sozinho; o
  conserto de verdade seria hash no nome do arquivo, e aí volta o build.
- O mapa pinta **países visitados**, enquanto a porcentagem mede **área alcançada**: são
  duas leituras diferentes na mesma tela. Pintar as células de 25 km deixaria o mapa
  quase vazio nessa escala — é o que o modo H3 do roadmap resolve.
- A Antártida fica fora do denominador, mas uma foto lá entraria no numerador. São
  algumas milhares de km² num total de 134 milhões, então o desvio é irrelevante; se
  incomodar, é uma linha em [`src/geo.js`](src/geo.js).

## Roadmap

- Nomear cidades offline com o GeoNames `cities15000` (vizinho mais próximo via k-d
  tree) → métrica "X cidades".
- Modo "exploração real" por hexágonos H3 (células tocadas), além de países visitados.
- Animação temporal e export de vídeo vertical. (O export de **imagem** já existe:
  "Baixar meu mapa" salva o canvas em PNG, também sem sair do navegador.)

## Design

O layout veio de um projeto do [Claude Design](https://claude.ai/design)
("Travel footprint dashboard UI"), importado via MCP. O mockup original desenhava o mapa
com D3 + topojson + `world-atlas` por CDN e usava Google Fonts; as duas coisas foram
substituídas por equivalentes locais pelo motivo acima. O resto — grade, tipografia,
cores, hierarquia — está como foi desenhado.

Fronteiras: [Natural Earth](https://www.naturalearthdata.com/) (domínio público).
