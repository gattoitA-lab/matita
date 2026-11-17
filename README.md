# Matita

Gioco di disegno guidato nel browser: traccia la linea tratteggiata, il tratto si colora in base
alla precisione, poi premi **Valuta il disegno** per ottenere punteggio e stelle. Nove livelli,
tre percorsi, progressi salvati in `localStorage`.

Nessuna build, nessuna dipendenza: solo HTML, CSS e JavaScript.

## Giocare in locale

Apri `index.html` nel browser, oppure servi la cartella:

```bash
python -m http.server 8000
# http://localhost:8000
```

## GitHub Pages

Il sito è statico e viene servito direttamente dal branch `main` (root della repo):

<https://gattoitA-lab.github.io/matita/>

## Struttura

| File | Contenuto |
| --- | --- |
| `index.html` | Struttura della landing e del pannello di gioco |
| `styles.css` | Stile, layout responsive |
| `js/levels.js` | Forme dei nove livelli e percorsi |
| `js/game.js` | Canvas, input, punteggio, stelle, progressi |
