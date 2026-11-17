/* Matita — gioco di disegno guidato.
   Guida tratteggiata su canvas, tratto colorato in base alla distanza,
   punteggio su copertura + precisione, stelle e progressi in localStorage. */
(function () {
  'use strict';

  var LEVELS = window.MATITA_LEVELS || [];
  var COURSES = window.MATITA_COURSES || [];
  var LOGICAL_W = 1000;
  var LOGICAL_H = 750;
  var STORAGE_KEY = 'matita-progress-v1';
  var GOOD = 26;
  var MID = 62;
  var COLORS = ['#1f8a5f', '#d39327', '#cf5544'];

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var levelList = document.getElementById('level-list');
  var levelName = document.getElementById('level-name');
  var levelGroup = document.getElementById('level-group');
  var levelHint = document.getElementById('level-hint');
  var starsTotal = document.getElementById('stars-total');
  var meterFill = document.getElementById('meter-fill');
  var canvasHint = document.getElementById('canvas-hint');
  var resultBox = document.getElementById('result');
  var resultStars = document.getElementById('result-stars');
  var resultScore = document.getElementById('result-score');
  var resultText = document.getElementById('result-text');
  var btnUndo = document.getElementById('btn-undo');
  var btnClear = document.getElementById('btn-clear');
  var btnScore = document.getElementById('btn-score');
  var btnRetry = document.getElementById('btn-retry');
  var btnNext = document.getElementById('btn-next');
  var relaxToggle = document.getElementById('relax-toggle');

  if (!LEVELS.length || !canvas) return;

  /* ---------- misura delle forme ---------- */

  var svgNS = 'http://www.w3.org/2000/svg';
  var measureHost = document.createElementNS(svgNS, 'svg');
  measureHost.setAttribute('aria-hidden', 'true');
  measureHost.style.cssText = 'position:absolute;left:-9999px;top:0;width:10px;height:10px;overflow:hidden';
  document.body.appendChild(measureHost);

  function samplePath(d, step) {
    var path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', d);
    measureHost.appendChild(path);
    var pts = [];
    var len = 0;
    try { len = path.getTotalLength(); } catch (err) { len = 0; }
    if (len > 0) {
      for (var s = 0; s < len; s += step) {
        var p = path.getPointAtLength(s);
        pts.push({ x: p.x, y: p.y });
      }
      var end = path.getPointAtLength(len);
      pts.push({ x: end.x, y: end.y });
    }
    measureHost.removeChild(path);
    return pts;
  }

  /* ---------- stato ---------- */

  function loadProgress() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { stars: {} };
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.stars !== 'object') return { stars: {} };
      return { stars: parsed.stars || {} };
    } catch (err) {
      return { stars: {} };
    }
  }

  function saveProgress() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
    } catch (err) { /* storage pieno o disabilitato: il gioco funziona lo stesso */ }
  }

  var state = {
    levelIndex: 0,
    strokes: [],
    active: null,
    relax: false,
    target: [],
    progress: loadProgress()
  };

  var sx = 0;
  var sy = 0;
  var raf = 0;
  var meterTimer = 0;

  function level() { return LEVELS[state.levelIndex]; }

  function isUnlocked(index) {
    if (index <= 0) return true;
    if (state.relax) return true;
    var prev = LEVELS[index - 1];
    return (state.progress.stars[prev.id] || 0) > 0;
  }

  /* ---------- geometric helpers ---------- */

  function distToTarget(x, y) {
    var target = state.target;
    var best = Infinity;
    for (var i = 0; i < target.length; i++) {
      var dx = x - target[i].x;
      var dy = y - target[i].y;
      var d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function bandFor(pt) {
    var d = distToTarget(pt.x, pt.y);
    if (d <= GOOD) return 0;
    if (d <= MID) return 1;
    return 2;
  }

  /* ---------- rendering ---------- */

  function resize() {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    sx = canvas.width / LOGICAL_W;
    sy = canvas.height / LOGICAL_H;
    requestDraw();
  }

  function requestDraw() {
    if (!raf) raf = window.requestAnimationFrame(paint);
  }

  function paint() {
    raf = 0;
    if (!sx || !sy) return;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var guide = new Path2D(level().d);
    ctx.save();
    ctx.setLineDash([16, 14]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(23, 19, 15, 0.24)';
    ctx.stroke(guide);
    ctx.restore();

    if (state.target.length) {
      var start = state.target[0];
      ctx.beginPath();
      ctx.arc(start.x, start.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = '#ff5c33';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fffdf9';
      ctx.stroke();
    }

    var buckets = [new Path2D(), new Path2D(), new Path2D()];
    for (var s = 0; s < state.strokes.length; s++) {
      var stroke = state.strokes[s];
      for (var i = 1; i < stroke.length; i++) {
        var a = stroke[i - 1];
        var b = stroke[i];
        var path = buckets[a.band];
        path.moveTo(a.x, a.y);
        path.lineTo(b.x, b.y);
      }
    }

    ctx.lineWidth = 9;
    for (var k = 0; k < buckets.length; k++) {
      ctx.strokeStyle = COLORS[k];
      ctx.stroke(buckets[k]);
    }
  }

  /* ---------- punteggio ---------- */

  function collectPoints() {
    var pts = [];
    for (var s = 0; s < state.strokes.length; s++) {
      var stroke = state.strokes[s];
      for (var i = 0; i < stroke.length; i++) pts.push(stroke[i]);
    }
    return pts;
  }

  function coverage() {
    var target = state.target;
    var pts = collectPoints();
    if (pts.length < 4 || !target.length) return 0;
    var step = Math.max(1, Math.floor(pts.length / 600));
    var sampled = [];
    for (var i = 0; i < pts.length; i += step) sampled.push(pts[i]);

    var binSize = 3;
    var bins = 0;
    var covered = 0;
    var goodSq = GOOD * GOOD;
    for (var t = 0; t < target.length; t += binSize) {
      bins++;
      var hit = false;
      for (var j = t; j < Math.min(t + binSize, target.length) && !hit; j++) {
        var tx = target[j].x;
        var ty = target[j].y;
        for (var m = 0; m < sampled.length; m++) {
          var dx = sampled[m].x - tx;
          var dy = sampled[m].y - ty;
          if (dx * dx + dy * dy <= goodSq) { hit = true; break; }
        }
      }
      if (hit) covered++;
    }
    return bins ? covered / bins : 0;
  }

  function evaluate() {
    var target = state.target;
    var pts = collectPoints();
    if (pts.length < 8 || !target.length) {
      return { score: 0, stars: 0, coverage: 0, precision: 0 };
    }
    var step = Math.max(1, Math.floor(pts.length / 700));
    var sampled = [];
    for (var i = 0; i < pts.length; i += step) sampled.push(pts[i]);

    var cov = coverage();

    var near = 0;
    var midSq = MID * MID;
    for (var p = 0; p < sampled.length; p++) {
      var best = Infinity;
      for (var q = 0; q < target.length; q++) {
        var dx = sampled[p].x - target[q].x;
        var dy = sampled[p].y - target[q].y;
        var d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
      if (best <= midSq) near++;
    }
    var precision = near / sampled.length;
    var score = Math.round(cov * 80 + precision * 20);
    var stars = score >= 85 ? 3 : score >= 68 ? 2 : score >= 45 ? 1 : 0;
    return { score: score, stars: stars, coverage: cov, precision: precision };
  }

  function updateMeter() {
    meterFill.style.width = Math.round(coverage() * 100) + '%';
  }

  function scheduleMeter() {
    if (meterTimer) return;
    meterTimer = window.setTimeout(function () {
      meterTimer = 0;
      updateMeter();
    }, 180);
  }

  /* ---------- interfaccia ---------- */

  function starsMarkup(count, max) {
    var out = '';
    for (var i = 0; i < max; i++) {
      out += i < count ? '★' : '<span class="off">★</span>';
    }
    return out;
  }

  function renderTotal() {
    var total = 0;
    for (var i = 0; i < LEVELS.length; i++) total += state.progress.stars[LEVELS[i].id] || 0;
    starsTotal.textContent = total + ' / ' + LEVELS.length * 3 + ' stelle';
  }

  function renderLevels() {
    levelList.innerHTML = '';
    LEVELS.forEach(function (item, index) {
      var stars = state.progress.stars[item.id] || 0;
      var unlocked = isUnlocked(index);
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'level-btn';
      btn.setAttribute('aria-current', index === state.levelIndex ? 'true' : 'false');
      btn.disabled = !unlocked;
      btn.innerHTML = '<span class="level-name">' + item.name + '</span>' +
        (unlocked
          ? '<span class="level-stars">' + starsMarkup(stars, 3) + '</span>'
          : '<span class="level-lock">Da sbloccare</span>');
      btn.addEventListener('click', function () { selectLevel(index); });
      li.appendChild(btn);
      levelList.appendChild(li);
    });
    renderTotal();
  }

  function selectLevel(index) {
    if (index < 0 || index >= LEVELS.length) return;
    if (!state.relax && !isUnlocked(index)) return;
    state.levelIndex = index;
    state.strokes = [];
    state.active = null;
    state.target = samplePath(level().d, 5);
    levelName.textContent = level().name;
    levelGroup.textContent = level().group + ' · ' + level().difficulty;
    levelHint.textContent = level().hint;
    canvasHint.hidden = false;
    hideResult();
    renderLevels();
    updateMeter();
    requestDraw();
  }

  function selectLevelById(id) {
    var index = LEVELS.findIndex(function (item) { return item.id === id; });
    if (index >= 0) selectLevel(index);
  }

  function hideResult() {
    resultBox.hidden = true;
  }

  function showResult(res) {
    var messages = [
      'Ancora un po\': avvicina il tratto alla linea tratteggiata e riprova.',
      'Buon inizio. I tratti in ambra sono quelli da correggere: ripassali con calma.',
      'Bel tratto. Ti manca poco per le tre stelle: copri tutta la linea.',
      'Tratto pulito e preciso. Livello completato.'
    ];
    resultStars.innerHTML = starsMarkup(res.stars, 3);
    resultScore.textContent = state.relax
      ? 'Modalità relax · nessun punteggio salvato'
      : 'Punteggio ' + res.score + ' / 100 · copertura ' + Math.round(res.coverage * 100) + '%';
    resultText.textContent = messages[res.stars];
    resultBox.hidden = false;
    var hasNext = state.levelIndex < LEVELS.length - 1;
    btnNext.disabled = !hasNext || !isUnlocked(state.levelIndex + 1);
  }

  function scoreDrawing() {
    var res = evaluate();
    if (!state.relax && res.stars > 0) {
      var id = level().id;
      var previous = state.progress.stars[id] || 0;
      if (res.stars > previous) {
        state.progress.stars[id] = res.stars;
        saveProgress();
      }
      renderLevels();
    }
    showResult(res);
  }

  function clearDrawing() {
    state.strokes = [];
    state.active = null;
    hideResult();
    updateMeter();
    requestDraw();
  }

  /* ---------- input ---------- */

  function pointFromEvent(event) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * LOGICAL_W,
      y: ((event.clientY - rect.top) / rect.height) * LOGICAL_H
    };
  }

  canvas.addEventListener('pointerdown', function (event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* ignora */ }
    }
    state.active = event.pointerId;
    var p = pointFromEvent(event);
    state.strokes.push([{ x: p.x, y: p.y, band: bandFor(p) }]);
    canvasHint.hidden = true;
    hideResult();
    requestDraw();
  });

  canvas.addEventListener('pointermove', function (event) {
    if (state.active !== event.pointerId) return;
    var stroke = state.strokes[state.strokes.length - 1];
    if (!stroke) return;
    var p = pointFromEvent(event);
    var last = stroke[stroke.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 3) return;
    stroke.push({ x: p.x, y: p.y, band: bandFor(p) });
    requestDraw();
    scheduleMeter();
  });

  function endStroke(event) {
    if (state.active !== event.pointerId) return;
    state.active = null;
    requestDraw();
    updateMeter();
  }

  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', function (event) {
    if (state.active === event.pointerId) endStroke(event);
  });

  btnUndo.addEventListener('click', function () {
    if (!state.strokes.length) return;
    state.strokes.pop();
    hideResult();
    updateMeter();
    requestDraw();
  });

  btnClear.addEventListener('click', clearDrawing);
  btnScore.addEventListener('click', scoreDrawing);
  btnRetry.addEventListener('click', clearDrawing);

  btnNext.addEventListener('click', function () {
    if (state.levelIndex < LEVELS.length - 1) selectLevel(state.levelIndex + 1);
  });

  relaxToggle.addEventListener('change', function () {
    state.relax = relaxToggle.checked;
    document.body.classList.toggle('relax', state.relax);
    hideResult();
    renderLevels();
  });

  window.addEventListener('resize', resize);
  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(canvas);
  }

  /* ---------- contenuti generati ---------- */

  function renderCourses() {
    var grid = document.getElementById('course-grid');
    if (!grid) return;
    grid.innerHTML = '';
    COURSES.forEach(function (course) {
      var first = LEVELS.find(function (item) { return item.id === course.start; });
      if (!first) return;
      var card = document.createElement('article');
      card.className = 'course-card';
      card.innerHTML =
        '<div class="course-thumb"><svg viewBox="0 0 1000 750" aria-hidden="true">' +
        '<path d="' + first.d + '" fill="none" stroke="currentColor" stroke-width="12" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
        '<h3>' + course.title + '</h3>' +
        '<p class="course-meta"><span>' + course.difficulty + '</span>' +
        '<span>' + course.levels.length + ' disegni</span></p>' +
        '<p class="course-blurb">' + course.blurb + '</p>' +
        '<ul class="course-learn">' + course.learn.map(function (item) {
          return '<li>' + item + '</li>';
        }).join('') + '</ul>' +
        '<button type="button" class="btn btn-ghost btn-sm">Esplora il percorso</button>';
      card.querySelector('button').addEventListener('click', function () {
        selectLevelById(course.start);
        document.getElementById('gioco').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      grid.appendChild(card);
    });
  }

  function renderHeroArt() {
    var host = document.getElementById('hero-art');
    if (!host) return;
    var shape = LEVELS.find(function (item) { return item.id === 'cuore'; }) || LEVELS[0];
    host.innerHTML =
      '<svg viewBox="0 0 1000 750" aria-hidden="true">' +
      '<path class="art-guide" d="' + shape.d + '"/>' +
      '<path class="art-ink" d="' + shape.d + '"/></svg>';
  }

  /* ---------- avvio ---------- */

  renderHeroArt();
  renderCourses();
  selectLevel(0);
  resize();
})();
