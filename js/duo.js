/* Matita — disegno in due.
   Tela divisa a metà: ogni giocatore disegna nel proprio lato e riceve i tratti
   dell'altro in tempo reale via WebRTC (PeerJS, segnalazione sul cloud pubblico). */
(function () {
  'use strict';

  var LOGICAL_W = 1000;
  var LOGICAL_H = 750;
  var SPLIT = 500;
  var PEER_PREFIX = 'matita-duo-';
  var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var COLORS = ['#17130f', '#ff5c33', '#e0a637', '#1f8a5f', '#1f6feb', '#a855f7', '#e0567a'];
  var SIZES = [4, 9, 16];
  var FLUSH_MS = 40;

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
  var duoHint = document.getElementById('duo-hint');
  var badgeLeft = document.getElementById('badge-left');
  var badgeRight = document.getElementById('badge-right');

  if (!canvas || !ctx) return;

  var state = {
    role: null,
    side: null,
    code: null,
    peer: null,
    conn: null,
    connected: false,
    strokes: [],
    active: null,
    pending: [],
    flushTimer: 0,
    color: COLORS[1],
    size: SIZES[1],
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
    var base = window.location.origin + window.location.pathname;
    return base + '?room=' + encodeURIComponent(code);
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
    state.side = 'left';
    state.code = code;
    state.color = COLORS[1];
    state.strokes = [];
    rememberCode(code);
    roomCodeLabel.textContent = code;
    setRoomVisible(true);
    setStatus('waiting', 'Sto aprendo la stanza…');
    hideHint();
    renderBadges();
    renderTools();
    requestDraw();

    var peer = new window.Peer(PEER_PREFIX + code, { debug: 1 });
    state.peer = peer;

    peer.on('open', function () {
      if (state.code !== code) return;
      setStatus('waiting', 'Stanza ' + code + ' pronta. Manda il link al tuo compagno e intanto disegna a sinistra.');
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
    state.side = 'right';
    state.code = code;
    state.color = COLORS[4];
    state.strokes = [];
    rememberCode(code);
    roomCodeLabel.textContent = code;
    setRoomVisible(true);
    setStatus('connecting', 'Mi collego alla stanza ' + code + '…');
    hideHint();
    renderBadges();
    renderTools();
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
      try { conn.send({ t: 'hello', side: state.side }); } catch (err) { /* ignora */ }
      sendSnapshot();
      var who = state.role === 'host' ? 'destra' : 'sinistra';
      setStatus('online', 'Collegati: il tuo compagno disegna a ' + who + '. Si comincia.');
      hideHint();
      renderBadges();
      requestDraw();
    });

    conn.on('data', function (data) { onMessage(data); });

    conn.on('close', function () {
      state.connected = false;
      state.conn = null;
      setStatus('offline', 'Il compagno si è disconnesso. Il disegno resta qui: ricarica o rientra per riprovare.');
      renderBadges();
      requestDraw();
    });

    conn.on('error', function () {
      state.connected = false;
      setStatus('error', 'Collegamento interrotto. Riprova a creare o entrare nella stanza.');
      renderBadges();
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

  function sendSnapshot() {
    if (!state.strokes.length) return;
    send({ t: 'snapshot', strokes: state.strokes.map(serializeStroke) });
  }

  function serializeStroke(stroke) {
    return {
      id: stroke.id,
      side: stroke.side,
      color: stroke.color,
      size: stroke.size,
      pts: stroke.pts.map(function (p) { return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]; })
    };
  }

  function onMessage(message) {
    if (!message || typeof message !== 'object') return;
    switch (message.t) {
      case 'hello':
        if (message.side === 'left' || message.side === 'right') {
          state.partnerSide = message.side;
          renderBadges();
        }
        break;
      case 'snapshot':
        if (Array.isArray(message.strokes)) {
          message.strokes.forEach(mergeStroke);
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
        clearSide(message.side);
        break;
      default:
        break;
    }
  }

  function clampPoint(x, y) {
    return {
      x: Math.min(Math.max(x, 2), LOGICAL_W - 2),
      y: Math.min(Math.max(y, 2), LOGICAL_H - 2)
    };
  }

  function makeStroke(raw) {
    return {
      id: raw.id,
      side: raw.side === 'left' ? 'left' : 'right',
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

  function clearSide(side) {
    if (side !== 'left' && side !== 'right') return;
    state.strokes = state.strokes.filter(function (stroke) { return stroke.side !== side; });
    requestDraw();
  }

  function removeLastOwn() {
    for (var i = state.strokes.length - 1; i >= 0; i--) {
      if (state.strokes[i].side === state.side) {
        var id = state.strokes[i].id;
        state.strokes.splice(i, 1);
        send({ t: 'undo', id: id });
        requestDraw();
        return;
      }
    }
  }

  function clearOwn() {
    clearSide(state.side);
    send({ t: 'clear', side: state.side });
  }

  function flushPending() {
    state.flushTimer = 0;
    if (!state.pending.length || !state.active) return;
    var batch = state.pending;
    state.pending = [];
    send({ t: 's', id: state.active.id, side: state.side, color: state.active.color, size: state.active.size, pts: batch });
  }

  function queuePoints(points) {
    for (var i = 0; i < points.length; i++) {
      state.pending.push([Math.round(points[i].x * 10) / 10, Math.round(points[i].y * 10) / 10]);
    }
    if (!state.flushTimer) state.flushTimer = window.setTimeout(flushPending, FLUSH_MS);
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

    for (var i = 0; i < state.strokes.length; i++) {
      var stroke = state.strokes[i];
      if (!stroke.pts.length) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.beginPath();
      if (stroke.pts.length === 1) {
        ctx.arc(stroke.pts[0].x, stroke.pts[0].y, stroke.size / 2, 0, Math.PI * 2);
        ctx.fillStyle = stroke.color;
        ctx.fill();
        continue;
      }
      ctx.moveTo(stroke.pts[0].x, stroke.pts[0].y);
      for (var p = 1; p < stroke.pts.length; p++) {
        ctx.lineTo(stroke.pts[p].x, stroke.pts[p].y);
      }
      ctx.stroke();
    }

    ctx.restore();

    ctx.save();
    ctx.setLineDash([12, 12]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(23, 19, 15, 0.22)';
    ctx.beginPath();
    ctx.moveTo(SPLIT, 0);
    ctx.lineTo(SPLIT, LOGICAL_H);
    ctx.stroke();
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
    var x = ((event.clientX - rect.left) / rect.width) * LOGICAL_W;
    var y = ((event.clientY - rect.top) / rect.height) * LOGICAL_H;
    var min = state.side === 'left' ? 4 : SPLIT + 4;
    var max = state.side === 'left' ? SPLIT - 4 : LOGICAL_W - 4;
    return clampPoint(Math.min(Math.max(x, min), max), y);
  }

  canvas.addEventListener('pointerdown', function (event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    if (!state.side) {
      setStatus('idle', 'Crea una stanza o entra con un codice per disegnare.');
      return;
    }
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* ignora */ }
    }
    var point = pointFromEvent(event);
    var stroke = {
      id: state.role + '-' + (++state.seq) + '-' + Date.now().toString(36),
      side: state.side,
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

  /* ---------- comandi ---------- */

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

  function renderBadges() {
    var mine = state.side;
    var partner = mine === 'left' ? 'right' : 'left';
    setBadge(badgeLeft, 'left', mine, partner);
    setBadge(badgeRight, 'right', mine, partner);
  }

  function setBadge(el, side, mine, partner) {
    var label = side === 'left' ? 'Sinistra' : 'Destra';
    var who = '';
    if (side === mine) who = ' · tu';
    else if (side === partner && state.connected) who = ' · compagno';
    el.textContent = label + who;
    el.dataset.mine = String(side === mine);
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
    state.side = null;
    state.code = null;
    state.partnerSide = null;
    state.strokes = [];
    rememberCode(null);
    setRoomVisible(false);
    setStatus('idle', 'Sei uscito dalla stanza. Creane una nuova o entra con un codice.');
    duoHint.hidden = false;
    roomCodeInput.value = '';
    renderBadges();
    renderTools();
    requestDraw();
  });

  btnUndo.addEventListener('click', removeLastOwn);
  btnClear.addEventListener('click', function () {
    if (!state.side) return;
    clearOwn();
  });

  window.addEventListener('resize', resize);
  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(canvas);
  }

  /* hook di lettura per i test manuali e per la console */
  window.MatitaDuo = {
    status: function () { return statusEl.dataset.state; },
    code: function () { return state.code; },
    side: function () { return state.side; },
    connected: function () { return state.connected; },
    strokeCount: function () { return state.strokes.length; }
  };

  /* ---------- avvio ---------- */

  renderTools();
  renderBadges();
  resize();

  var params = new URLSearchParams(window.location.search);
  var fromUrl = (params.get('room') || '').trim().toUpperCase();
  if (fromUrl.length === 5) {
    roomCodeInput.value = fromUrl;
    joinRoom(fromUrl);
  }
})();
