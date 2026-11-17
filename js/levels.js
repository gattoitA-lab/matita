/* Matita — dati dei livelli e dei percorsi.
   Ogni livello è una forma disegnata in uno spazio logico 1000 x 750. */
(function () {
  'use strict';

  function polyPath(points, close) {
    var d = 'M ' + points[0].x.toFixed(1) + ' ' + points[0].y.toFixed(1);
    for (var i = 1; i < points.length; i++) {
      d += ' L ' + points[i].x.toFixed(1) + ' ' + points[i].y.toFixed(1);
    }
    return close === false ? d : d + ' Z';
  }

  function fit(points, cx, cy, size) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    var spanX = maxX - minX || 1;
    var spanY = maxY - minY || 1;
    var scale = size / Math.max(spanX, spanY);
    var offX = cx - ((minX + maxX) / 2) * scale;
    var offY = cy - ((minY + maxY) / 2) * scale;
    return points.map(function (p) {
      return { x: p.x * scale + offX, y: p.y * scale + offY };
    });
  }

  function circlePoints(cx, cy, r, steps) {
    var pts = [];
    for (var i = 0; i < steps; i++) {
      var t = (i / steps) * Math.PI * 2 - Math.PI / 2;
      pts.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r });
    }
    return pts;
  }

  function ellipsePoints(cx, cy, rx, ry, rot, steps) {
    var pts = [];
    for (var i = 0; i < steps; i++) {
      var t = (i / steps) * Math.PI * 2;
      var x = Math.cos(t) * rx;
      var y = Math.sin(t) * ry;
      pts.push({
        x: cx + x * Math.cos(rot) - y * Math.sin(rot),
        y: cy + x * Math.sin(rot) + y * Math.cos(rot)
      });
    }
    return pts;
  }

  function starPoints(cx, cy, outer, inner, tips) {
    var pts = [];
    for (var i = 0; i < tips * 2; i++) {
      var r = i % 2 === 0 ? outer : inner;
      var a = (i / (tips * 2)) * Math.PI * 2 - Math.PI / 2;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }

  function heartPoints(steps) {
    var pts = [];
    for (var i = 0; i < steps; i++) {
      var t = (i / steps) * Math.PI * 2;
      var x = 16 * Math.pow(Math.sin(t), 3);
      var y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      pts.push({ x: x * 20, y: y * 20 });
    }
    return pts;
  }

  function spiralPoints(turns, steps) {
    var pts = [];
    for (var i = 0; i <= steps; i++) {
      var t = (i / steps) * turns * Math.PI * 2;
      var r = 10 + t * 15;
      pts.push({ x: Math.cos(t) * r, y: Math.sin(t) * r });
    }
    return pts;
  }

  function leafPoints(steps) {
    var upper = [], lower = [];
    for (var i = 0; i <= steps; i++) {
      var x = -1 + (2 * i) / steps;
      var y = (1 - x * x) * 0.9;
      upper.push({ x: x, y: -y });
      lower.push({ x: x, y: y * 0.92 });
    }
    return upper.concat(lower.reverse());
  }

  function poly(points, size) {
    return polyPath(fit(points, 500, 375, size), true);
  }

  var ellipse = { x: 500, y: 375 };

  var LEVELS = [
    {
      id: 'cerchio',
      name: 'Cerchio',
      group: 'Forme di base',
      difficulty: 'Principiante',
      hint: 'Un solo gesto: parti dal punto e chiudi il cerchio senza staccare la mano.',
      d: poly(circlePoints(0, 0, 1, 140), 520)
    },
    {
      id: 'quadrato',
      name: 'Quadrato',
      group: 'Forme di base',
      difficulty: 'Principiante',
      hint: 'Angoli netti ma senza fretta: cambia direzione con decisione.',
      d: poly([{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }], 470)
    },
    {
      id: 'stella',
      name: 'Stella',
      group: 'Forme di base',
      difficulty: 'Principiante',
      hint: 'Cinque punte: alterna punte lunghe e valli corte mantenendo il ritmo.',
      d: poly(starPoints(0, 0, 1, 0.46, 5), 540)
    },
    {
      id: 'cuore',
      name: 'Cuore',
      group: 'Curve e ritmo',
      difficulty: 'Intermedio',
      hint: 'Due lobi e una punta: rallenta nel punto più basso.',
      d: poly(heartPoints(160), 520)
    },
    {
      id: 'foglia',
      name: 'Foglia',
      group: 'Curve e ritmo',
      difficulty: 'Intermedio',
      hint: 'Le due curve si chiudono alle estremità: mantieni la stessa distanza.',
      d: poly(leafPoints(70), 560) + ' ' + polyPath(fit([{ x: -0.9, y: 0 }, { x: 0.9, y: 0 }], 500, 375, 560), false)
    },
    {
      id: 'spirale',
      name: 'Spirale',
      group: 'Curve e ritmo',
      difficulty: 'Intermedio',
      hint: 'Mano leggera: la curva deve allargarsi in modo regolare.',
      d: polyPath(fit(spiralPoints(3, 220), 500, 375, 540), false)
    },
    {
      id: 'gatto',
      name: 'Gatto',
      group: 'Animali',
      difficulty: 'Tutti i livelli',
      hint: 'Testa, orecchie, baffi: quattro tratti separati, uno alla volta.',
      d: polyPath(circlePoints(500, 410, 175, 120), true) + ' ' +
        polyPath([{ x: 372, y: 268 }, { x: 330, y: 128 }, { x: 452, y: 232 }], true) + ' ' +
        polyPath([{ x: 628, y: 268 }, { x: 670, y: 128 }, { x: 548, y: 232 }], true) + ' ' +
        polyPath([{ x: 325, y: 430 }, { x: 190, y: 405 }], false) + ' ' +
        polyPath([{ x: 325, y: 455 }, { x: 195, y: 465 }], false) + ' ' +
        polyPath([{ x: 675, y: 430 }, { x: 810, y: 405 }], false) + ' ' +
        polyPath([{ x: 675, y: 455 }, { x: 805, y: 465 }], false)
    },
    {
      id: 'pesce',
      name: 'Pesce',
      group: 'Animali',
      difficulty: 'Tutti i livelli',
      hint: 'Corpo ovale, coda a triangolo, pinna sopra: prima le forme grandi.',
      d: polyPath(ellipsePoints(560, 380, 240, 150, 0, 120), true) + ' ' +
        polyPath([{ x: 320, y: 380 }, { x: 170, y: 300 }, { x: 170, y: 460 }], true) + ' ' +
        polyPath([{ x: 470, y: 236 }, { x: 545, y: 150 }, { x: 640, y: 226 }], true)
    },
    {
      id: 'farfalla',
      name: 'Farfalla',
      group: 'Animali',
      difficulty: 'Tutti i livelli',
      hint: 'Quattro ali simmetriche e un corpo sottile: cerca la simmetria.',
      d: polyPath(ellipsePoints(360, 285, 145, 110, -0.35, 90), true) + ' ' +
        polyPath(ellipsePoints(640, 285, 145, 110, 0.35, 90), true) + ' ' +
        polyPath(ellipsePoints(395, 480, 100, 90, 0.26, 80), true) + ' ' +
        polyPath(ellipsePoints(605, 480, 100, 90, -0.26, 80), true) + ' ' +
        polyPath(ellipsePoints(500, 375, 24, 155, 0, 80), true)
    }
  ];

  var COURSES = [
    {
      id: 'basi',
      title: 'Forme di base',
      difficulty: 'Principiante',
      start: 'cerchio',
      levels: ['cerchio', 'quadrato', 'stella'],
      blurb: 'Controllo della mano e gesto continuo: le forme che stanno sotto a tutto il resto.',
      learn: ['Fare un tratto continuo senza fermarti', 'Chiudere una forma senza sbavature']
    },
    {
      id: 'animali',
      title: 'Animali',
      difficulty: 'Tutti i livelli',
      start: 'gatto',
      levels: ['gatto', 'pesce', 'farfalla'],
      blurb: 'Orecchie, pinne e ali: come un animale nasce da cerchi e ovali messi insieme.',
      learn: ['Combinare più forme in un disegno', 'Semplificare i dettagli senza perderli']
    },
    {
      id: 'curve',
      title: 'Curve e ritmo',
      difficulty: 'Intermedio',
      start: 'cuore',
      levels: ['cuore', 'foglia', 'spirale'],
      blurb: 'Cuore, foglia e spirale: curve che chiedono ritmo, non forza.',
      learn: ['Tenere una curva regolare', 'Cambiare direzione senza spezzare il tratto']
    }
  ];

  window.MATITA_LEVELS = LEVELS;
  window.MATITA_COURSES = COURSES;
  window.MATITA_LOGIC = { width: 1000, height: 750, center: ellipse };
})();
