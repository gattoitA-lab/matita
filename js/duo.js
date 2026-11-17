/* Matita — disegno in due.
   Una sola tela condivisa con la traccia da seguire: ogni giocatore disegna
   con il proprio colore e vede i tratti dell'altro in tempo reale (WebRTC). */
(function () {
  'use strict';

  var LOGICAL_W = 1000;
  var LOGICAL_H = 750;
  var PEER_PREFIX = 'matita-duo-';
  var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var COLORS = ['#17130f', '#ff5c33', '#e0a637', '#1f8a5f', '#1f6feb', '#a855f7', '#e0567a'];
  var SIZES = [4, 9, 16];
  var LESSON_IDS = ['pesce', 'gatto', 'farfalla', 'stella', 'cuore', 'foglia'];
  var FLUSH_MS = 40;
  var CURSOR_MS = 90;

  var canvas = document.getElementById('duo-board');
  var ctx = canvas ? canvas.getContext('2d') : null;
  var roomIdle = document.getElementById('room-idle');
  var roomLive = document.getElementById('room-live');
  var roomCodeInput = document.getElementById('room-code');
  var roomCodeLabel = document.getElementById('room-code-label');
  var statusEl = document.getElementById('room-status');
  var btnCreate = document.getElementById('btn-create');
  var btnJoin = document.getElementById('btn-join');
  var btnCopy = document.getElementById('btn-copy');
  var btnLeave = document.getElementById('btn-leave');
  var btnUndo = document.getElementById('btn-undo-duo');
  var btnClear = document.getElementById('btn-clear-duo');
  var colorPicker = document.getElementById('color-picker');
  var sizePicker = document.getElementById('size-picker');
  var lessonPicker = document.getElementById('duo-lessons');
  var legend = document.getElementById('duo-legend');
  var duoHint = document.getElementById('duo-hint');

  if (!canvas || !ctx) return;

  var LEVELS = window.MATITA_LEVELS || [];

  function lessonById(id) {
    for (var i = 0; i < LEVELS.length; i++) {
      if (LEVELS[i].id === id) return LEVELS[i];
    }
    return null;
  }

  var state = {
    role: null,
    code: null,
    peer: null,
    conn: null,
    connected: false,
    strokes: [],
    active: null,
    pending: [],
    flushTimer: 0,
    cursorTimer: 0,
    color: COLORS[1],
    partnerColor: null,
    partnerCursor: null,
    size: SIZES[1],
    lessonId: 'pesce',
    seq: 0,
    drawing: false
  };

  var sx = 0;
  var sy = 0;
  var raf = 0;

  /* ---------- stato della stanza ---------- */

  function setStatus(kind, text) {
    statusEl.dataset.state = kind;
    statusEl.textContent = text;
  }

  function setRoomVisible(visible) {
    roomIdle.hidden = visible;
    roomLive.hidden = !visible;
  }

  function randomCode() {
    var out = '';
    var bytes = new Uint32Array(5);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var b = 0; b < 5; b++) bytes[b] = Math.floor(Math.random() * 4294967295);
    }
    for (var i = 0; i < 5; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return out;
  }

  function shareUrl(code) {
    return window.location.origin + window.location.pathname + '?room=' + encodeURIComponent(code);
  }

  function rememberCode(code) {
    try {
      window.history.replaceState(null, '', code ? '?room=' + code : window.location.pathname);
    } catch (err) { /* file:// o history bloccata */ }
  }

  /* ---------- connessione ---------- */

  function teardown() {
    state.connected = false;
    state.drawing = false;
    state.active = null;
    state.partnerCursor = null;
    state.partnerColor = null;
    if (state.conn) {
      try { state.conn.close(); } catch (err) { /* ignora */ }
    }
    if (state.peer) {
      try { state.peer.destroy(); } catch (err) { /* ignora */ }
    }
    state.conn = null;
    state.peer = null;
    state.pending = [];
    if (state.flushTimer) {
      window.clearTimeout(state.flushTimer);
      state.flushTimer = 0;
    }
    if (state.cursorTimer) {
      window.clearTimeout(state.cursorTimer);
      state.cursorTimer = 0;
    }
  }

  function createRoom() {
    if (typeof window.Peer !== 'function') {
      setStatus('error', 'Libreria di collegamento non caricata: ricarica la pagina.');
      return;
    }
    teardown();
    startHost(randomCode());
  }

  function startHost(code) {
    state.role = 'host';
    state.code = code;
    state.color = COLORS[1];
    state.strokes = [];
    rememberCode(code);
    roomCodeLabel.textContent = code;
    setRoomVisible(true);
    setStatus('waiting', 'Sto aprendo la stanza…');
    hideHint();
    renderTools();
    renderLegend();
    renderLessons();
    requestDraw();

    var peer = new window.Peer(PEER_PREFIX + code, { debug: 1 });
    state.peer = peer;

    peer.on('open', function () {
      if (state.code !== code) return;
      setStatus('waiting', 'Stanza ' + code + ' pronta. Manda il link: appena entra, disegnate sulla stessa tela.');
      sendHello();
      sendSnapshot();
    });

    peer.on('connection', function (conn) {
      if (state.conn && state.conn.open) {
        try { conn.close(); } catch (err) { /* stanza piena */ }
        return;
      }
      acceptConnection(conn);
    });

    peer.on('error', function (err) { handlePeerError(err); });
  }

  function joinRoom(code) {
    if (typeof window.Peer !== 'function') {
      setStatus('error', 'Libreria di collegamento non caricata: ricarica la pagina.');
      return;
    }
    teardown();
    state.role = 'guest';
    state.code = code;
    state.color = COLORS[4];
    state.strokes = [];
    rememberCode(code);
    roomCodeLabel.textContent = code;
    setRoomVisible(true);
    setStatus('connecting', 'Mi collego alla stanza ' + code + '…');
    hideHint();
    renderTools();
    renderLegend();
    renderLessons();
    requestDraw();

    var peer = new window.Peer({ debug: 1 });
    state.peer = peer;

    peer.on('open', function () {
      if (state.code !== code) return;
      var conn = peer.connect(PEER_PREFIX + code, { reliable: true });
      acceptConnection(conn, true);
    });

    peer.on('error', function (err) { handlePeerError(err); });
  }

  function acceptConnection(conn, isGuest) {
    state.conn = conn;

    conn.on('open', function () {
      state.connected = true;
      sendHello();
      sendSnapshot();
      setStatus('online', 'Collegati: state disegnando sulla stessa tela, ognuno con il suo colore.');
      hideHint();
      renderLegend();
      requestDraw();
    });

    conn.on('data', function (data) { onMessage(data); });

    conn.on('close', function () {
      state.connected = false;
      state.conn = null;
      state.partnerCursor = null;
      setStatus('offline', 'Il compagno si è disconnesso. Il disegno resta qui: rientra nella stanza per continuare.');
      renderLegend();
      requestDraw();
    });

    conn.on('error', function () {
      state.connected = false;
      state.partnerCursor = null;
      setStatus('error', 'Collegamento interrotto. Riprova a creare o entrare nella stanza.');
      renderLegend();
    });

    if (isGuest && conn.open) {
      state.connected = true;
    }
  }

  function handlePeerError(err) {
    var type = err && err.type ? err.type : 'errore';
    if (type === 'unavailable-id' && state.role === 'host') {
      setStatus('waiting', 'Codice occupato da una sessione precedente: ne genero un altro…');
      var next = randomCode();
      window.setTimeout(function () { startHost(next); }, 700);
      return;
    }
    if (type === 'peer-unavailable') {
      state.connected = false;
      setStatus('error', 'Nessuno in questa stanza. Controlla il codice o chiedi al tuo compagno di crearla.');
      return;
    }
    if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
      state.connected = false;
      setStatus('error', 'Server di segnalazione non raggiungibile. Controlla la connessione e riprova.');
      return;
    }
    setStatus('error', 'Collegamento non riuscito (' + type + '). Riprova.');
  }

  /* ---------- messaggi ---------- */

  function send(message) {
    if (!state.conn || !state.conn.open) return;
    try { state.conn.send(message); } catch (err) { /* canale chiuso */ }
  }

  function sendHello() {
    send({ t: 'hello', color: state.color, lesson: state.lessonId });
  }

  function sendSnapshot() {
    if (!state.strokes.length) return;
    send({ t: 'snapshot', lesson: state.lessonId, strokes: state.strokes.map(serializeStroke) });
  }

  function serializeStroke(stroke) {
    return {
      id: stroke.id,
      color: stroke.color,
      size: stroke.size,
      pts: stroke.pts.map(function (p) { return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]; })
    };
  }

  function onMessage(message) {
    if (!message || typeof message !== 'object') return;
    switch (message.t) {
      case 'hello':
        if (typeof message.color === 'string') state.partnerColor = message.color;
        if (typeof message.lesson === 'string') applyLesson(message.lesson, false);
        renderLegend();
        requestDraw();
        break;
      case 'color':
        if (typeof message.color === 'string') {
          state.partnerColor = message.color;
          renderLegend();
        }
        break;
      case 'lesson':
        if (typeof message.lesson === 'string') applyLesson(message.lesson, false);
        break;
      case 'snapshot':
        if (Array.isArray(message.strokes)) {
          message.strokes.forEach(mergeStroke);
          if (typeof message.lesson === 'string') applyLesson(message.lesson, false);
          requestDraw();
        }
        break;
      case 's':
        applySegment(message);
        break;
      case 'undo':
        removeStroke(message.id);
        break;
      case 'clear':
        state.strokes = [];
        requestDraw();
        break;
      case 'cursor':
        if (typeof message.x === 'number' && typeof message.y === 'number') {
          state.partnerCursor = clampPoint(message.x, message.y);
          requestDraw();
        }
        break;
      default:
        break;
    }
  }

  function clampPoint(x, y) {
    return {
      x: Math.min(Math.max(x, 1), LOGICAL_W - 1),
      y: Math.min(Math.max(y, 1), LOGICAL_H - 1)
    };
  }

  function makeStroke(raw) {
    return {
      id: raw.id,
      color: typeof raw.color === 'string' ? raw.color : '#17130f',
      size: typeof raw.size === 'number' ? raw.size : SIZES[1],
      pts: [],
      remote: true
    };
  }

  function appendPairs(stroke, pairs) {
    pairs.forEach(function (pair) {
      if (!Array.isArray(pair) || pair.length < 2) return;
      stroke.pts.push(clampPoint(Number(pair[0]) || 0, Number(pair[1]) || 0));
    });
  }

  function mergeStroke(raw) {
    if (!raw || !raw.id || !Array.isArray(raw.pts)) return null;
    var existing = findStroke(raw.id);
    if (existing) return existing;
    var stroke = makeStroke(raw);
    appendPairs(stroke, raw.pts);
    if (!stroke.pts.length) return null;
    state.strokes.push(stroke);
    return stroke;
  }

  function applySegment(message) {
    if (!message || !message.id || !Array.isArray(message.pts) || !message.pts.length) return;
    var stroke = findStroke(message.id);
    if (!stroke) {
      stroke = makeStroke(message);
      state.strokes.push(stroke);
    }
    appendPairs(stroke, message.pts);
    requestDraw();
  }

  function findStroke(id) {
    for (var i = state.strokes.length - 1; i >= 0; i--) {
      if (state.strokes[i].id === id) return state.strokes[i];
    }
    return null;
  }

  function removeStroke(id) {
    for (var i = state.strokes.length - 1; i >= 0; i--) {
      if (state.strokes[i].id === id) {
        state.strokes.splice(i, 1);
        requestDraw();
        return;
      }
    }
  }

  function removeLastOwn() {
    for (var i = state.strokes.length - 1; i >= 0; i--) {
      if (!state.strokes[i].remote) {
        var id = state.strokes[i].id;
        state.strokes.splice(i, 1);
        send({ t: 'undo', id: id });
        requestDraw();
        return;
      }
    }
  }

  function clearAll() {
    state.strokes = [];
    send({ t: 'clear' });
    requestDraw();
  }

  function applyLesson(id, broadcast) {
    if (!lessonById(id)) return;
    state.lessonId = id;
    renderLessons();
    requestDraw();
    if (broadcast) send({ t: 'lesson', lesson: id });
  }

  function flushPending() {
    state.flushTimer = 0;
    if (!state.pending.length || !state.active) return;
    var batch = state.pending;
    state.pending = [];
    send({ t: 's', id: state.active.id, color: state.active.color, size: state.active.size, pts: batch });
  }

  function queuePoints(points) {
    for (var i = 0; i < points.length; i++) {
      state.pending.push([Math.round(points[i].x * 10) / 10, Math.round(points[i].y * 10) / 10]);
    }
    if (!state.flushTimer) state.flushTimer = window.setTimeout(flushPending, FLUSH_MS);
  }

  function queueCursor(point) {
    if (state.cursorTimer) return;
    state.cursorTimer = window.setTimeout(function () {
      state.cursorTimer = 0;
      send({ t: 'cursor', x: point.x, y: point.y });
    }, CURSOR_MS);
  }

  /* ---------- disegno ---------- */

  function requestDraw() {
    if (!raf) raf = window.requestAnimationFrame(paint);
  }

  function paint() {
    raf = 0;
    if (!sx || !sy) return;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var lesson = lessonById(state.lessonId);
    if (lesson) {
      ctx.save();
      ctx.strokeStyle = 'rgba(90, 130, 190, 0.5)';
      ctx.lineWidth = 4;
      ctx.stroke(new Path2D(lesson.d));
      ctx.restore();
    }

    for (var i = 0; i < state.strokes.length; i++) {
      var stroke = state.strokes[i];
      if (!stroke.pts.length) continue;
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      if (stroke.pts.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke.pts[0].x, stroke.pts[0].y, stroke.size / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(stroke.pts[0].x, stroke.pts[0].y);
      for (var p = 1; p < stroke.pts.length; p++) {
        ctx.lineTo(stroke.pts[p].x, stroke.pts[p].y);
      }
      ctx.stroke();
    }

    if (state.partnerCursor && state.connected) {
      var c = state.partnerCursor;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = state.partnerColor || '#1f6feb';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255, 253, 249, 0.95)';
      ctx.stroke();
    }

    ctx.restore();
  }

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

  /* ---------- input ---------- */

  function pointFromEvent(event) {
    var rect = canvas.getBoundingClientRect();
    return clampPoint(
      ((event.clientX - rect.left) / rect.width) * LOGICAL_W,
      ((event.clientY - rect.top) / rect.height) * LOGICAL_H
    );
  }

  canvas.addEventListener('pointerdown', function (event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    if (!state.code) {
      setStatus('idle', 'Crea una stanza o entra con un codice per disegnare.');
      return;
    }
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* ignora */ }
    }
    var point = pointFromEvent(event);
    var stroke = {
      id: state.role + '-' + (++state.seq) + '-' + Date.now().toString(36),
      color: state.color,
      size: state.size,
      pts: [point],
      remote: false
    };
    state.strokes.push(stroke);
    state.active = stroke;
    state.drawing = true;
    state.pending = [];
    queuePoints([point]);
    requestDraw();
  });

  canvas.addEventListener('pointermove', function (event) {
    if (!state.drawing || !state.active) return;
    var point = pointFromEvent(event);
    var pts = state.active.pts;
    var last = pts[pts.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) < 2) return;
    pts.push(point);
    queuePoints([point]);
    queueCursor(point);
    requestDraw();
  });

  function endStroke(event) {
    if (!state.drawing) return;
    state.drawing = false;
    flushPending();
    state.active = null;
    state.pending = [];
    if (event && canvas.releasePointerCapture) {
      try { canvas.releasePointerCapture(event.pointerId); } catch (err) { /* ignora */ }
    }
    requestDraw();
  }

  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', function (event) {
    if (state.drawing) endStroke(event);
  });

  /* ---------- interfaccia ---------- */

  function renderTools() {
    colorPicker.innerHTML = '';
    COLORS.forEach(function (color) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch';
      btn.style.background = color;
      btn.setAttribute('aria-label', 'Colore ' + color);
      btn.setAttribute('aria-pressed', String(color === state.color));
      btn.addEventListener('click', function () {
        state.color = color;
        renderTools();
        renderLegend();
        send({ t: 'color', color: color });
      });
      colorPicker.appendChild(btn);
    });

    sizePicker.innerHTML = '';
    SIZES.forEach(function (size) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'size-btn';
      btn.setAttribute('aria-label', 'Spessore ' + size + ' pixel');
      btn.setAttribute('aria-pressed', String(size === state.size));
      var dot = document.createElement('span');
      dot.className = 'size-dot';
      dot.style.width = Math.max(6, size) + 'px';
      dot.style.height = Math.max(6, size) + 'px';
      btn.appendChild(dot);
      btn.addEventListener('click', function () {
        state.size = size;
        renderTools();
      });
      sizePicker.appendChild(btn);
    });
  }

  function renderLessons() {
    if (!lessonPicker) return;
    lessonPicker.innerHTML = '';
    LESSON_IDS.forEach(function (id) {
      var lesson = lessonById(id);
      if (!lesson) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lesson-chip';
      btn.textContent = lesson.name;
      btn.setAttribute('aria-pressed', String(id === state.lessonId));
      btn.addEventListener('click', function () { applyLesson(id, true); });
      lessonPicker.appendChild(btn);
    });
  }

  function renderLegend() {
    if (!legend) return;
    legend.innerHTML = '';
    legend.appendChild(legendItem('Tu', state.color, true));
    legend.appendChild(legendItem(
      state.connected ? 'Compagno' : 'Compagno (in attesa)',
      state.partnerColor || '#c9bfb1',
      false
    ));
  }

  function legendItem(label, color, mine) {
    var span = document.createElement('span');
    span.className = 'legend-item';
    if (!mine) span.classList.add('legend-item-partner');
    var dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.background = color;
    span.appendChild(dot);
    span.appendChild(document.createTextNode(label));
    return span;
  }

  function hideHint() {
    duoHint.hidden = true;
  }

  btnCreate.addEventListener('click', createRoom);

  btnJoin.addEventListener('click', function () {
    var code = (roomCodeInput.value || '').trim().toUpperCase();
    if (code.length !== 5) {
      setStatus('error', 'Il codice della stanza ha cinque caratteri.');
      return;
    }
    joinRoom(code);
  });

  roomCodeInput.addEventListener('input', function () {
    roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  });

  roomCodeInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') btnJoin.click();
  });

  btnCopy.addEventListener('click', function () {
    var link = shareUrl(state.code || '');
    var done = function () {
      btnCopy.textContent = 'Link copiato';
      window.setTimeout(function () { btnCopy.textContent = 'Copia link'; }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done, function () { window.prompt('Copia il link:', link); });
    } else {
      window.prompt('Copia il link:', link);
    }
  });

  btnLeave.addEventListener('click', function () {
    teardown();
    state.role = null;
    state.code = null;
    state.strokes = [];
    rememberCode(null);
    setRoomVisible(false);
    setStatus('idle', 'Sei uscito dalla stanza. Creane una nuova o entra con un codice.');
    duoHint.hidden = false;
    roomCodeInput.value = '';
    renderLegend();
    renderTools();
    requestDraw();
  });

  btnUndo.addEventListener('click', function () {
    if (!state.code) return;
    removeLastOwn();
  });

  btnClear.addEventListener('click', function () {
    if (!state.code) return;
    clearAll();
  });

  window.addEventListener('resize', resize);
  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(canvas);
  }

  window.MatitaDuo = {
    status: function () { return statusEl.dataset.state; },
    code: function () { return state.code; },
    connected: function () { return state.connected; },
    strokeCount: function () { return state.strokes.length; },
    lesson: function () { return state.lessonId; }
  };

  /* ---------- avvio ---------- */

  renderTools();
  renderLessons();
  renderLegend();
  resize();

  var params = new URLSearchParams(window.location.search);
  var fromUrl = (params.get('room') || '').trim().toUpperCase();
  if (fromUrl.length === 5) {
    roomCodeInput.value = fromUrl;
    joinRoom(fromUrl);
  }
})();
