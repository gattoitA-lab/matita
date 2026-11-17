# Matita

Gioco di disegno guidato nel browser: traccia la linea tratteggiata, il tratto si colora in base
alla precisione, poi premi **Valuta il disegno** per ottenere punteggio e stelle. Nove livelli,
tre percorsi, progressi salvati in `localStorage`.

La radice `index.html` è la landing con il gioco guidato. La schermata **«Come vuoi giocare?»** sta
in `scegli/` e porta alle due modalità: **Da solo** (`index.html`) o **Insieme ad un amico**
(`duo.html`). In due si apre una stanza con codice, c'è una sola tela condivisa con la traccia da
seguire e i tratti sono sincronizzati in tempo reale, ognuno col suo colore.

Nessuna build: HTML, CSS e JavaScript. L'unica libreria è PeerJS, inclusa in `js/vendor/`.

## Disegnare in due

1. Apri `duo.html` e premi **Crea una stanza**: ottieni un codice di cinque caratteri e un colore.
2. Condividi il link (`Copia link`): chi lo apre entra nella stessa stanza e sulla stessa tela.
3. Scegliete il disegno da seguire e coloratelo insieme: ogni tratto compare sullo schermo
dell'altro mentre viene disegnato, e il puntino colorato mostra dove sta disegnando il compagno.

Extra della stanza:

- **Tela vuota** tra i disegni: nessuna traccia, si disegna quello che si vuole.
- **Scarica disegno** salva un PNG 2000×1500 con tutto ciò che avete fatto insieme.
- **Schermo pieno** porta la tela a tutta finestra con colori e strumenti sotto mano (si esce con Esc).

Il collegamento usa WebRTC: la segnalazione passa dal cloud pubblico di PeerJS, i disegni viaggiano
direttamente tra i due browser. Nessun tratto viene salvato su un server. Le reti che bloccano il
P2P (alcune reti aziendali o mobili molto restrittive) possono impedire il collegamento.

## Giocare in locale

Apri `index.html` nel browser, oppure servi la cartella:

```bash
python -m http.server 8000
# http://localhost:8000
```

## GitHub Pages

Il sito è statico e viene servito direttamente dal branch `main` (root della repo):

- Gioco da solo: <https://gattoitA-lab.github.io/matita/>
- «Come vuoi giocare?»: <https://gattoitA-lab.github.io/matita/scegli/>
- Disegno in due: <https://gattoitA-lab.github.io/matita/duo.html>

## Struttura

| File | Contenuto |
| --- | --- |
| `index.html` | Landing e gioco guidato in solitaria |
| `scegli/index.html` | Schermata «Come vuoi giocare?» con le due modalità |
| `styles.css` | Stile, layout responsive |
| `js/levels.js` | Forme dei nove livelli e percorsi |
| `js/game.js` | Canvas, input, punteggio, stelle, progressi |
| `duo.html` | Pagina del disegno condiviso |
| `js/duo.js` | Stanze, streaming dei tratti, strumenti |
| `js/vendor/peerjs.min.js` | PeerJS 1.5.5 per il collegamento WebRTC |
