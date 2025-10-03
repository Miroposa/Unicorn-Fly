# Unicorn Fly

Kleiner Flappy-Bird-Clone in reinem HTML5 Canvas und JavaScript.

## Start

- Öffne die Datei `index.html` im Browser (Doppelklick)
- Steuerung:
  - Leertaste/ArrowUp oder Klick/Touch zum Flappen
  - Enter/Leertaste/Klick zum Neustart nach Game Over

## Hinweise

- Canvas skaliert für HiDPI, mobil passt sich die Größe an
- Highscore wird im `localStorage` gespeichert

### Eigenes Sprite

- Lege dein Bild unter `Flappi Bird/assets/unicorn.png` ab (PNG mit transparentem Hintergrund wird empfohlen).
- Größe wird im Code auf ca. 42×32 px gezeichnet und rotiert mit der Flugrichtung.
- Ist kein Bild vorhanden, erscheint die Kreis-Darstellung.

Viel Spaß!

## Assets

- Spieler: `assets/unicorn.png`
- Hintergrund: `assets/background.png` (wird als Parallax gekachelt)
