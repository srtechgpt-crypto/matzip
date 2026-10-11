// 맛집지도 화면: 카카오 지도·핀·목록·버튼. 검색 규칙·계산은 search.js(MatzipSearch)가 맡는다.
(function () {
  'use strict';
  var MS = window.MatzipSearch;
  var CFG = window.MATZIP_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  var S = {
    type: MS.DEFAULTS.type, radius: MS.DEFAULTS.radius, sort: MS.DEFAULTS.sort,
    center: null,        // {lat, lng, label, mode:'me'|'area'}
    me: null,            // 마지막으로 받은 내 위치 {lat, lng}
    places: [], selId: null, status: '', partial: false, busy: false
  };
  var guard = MS.createRequestGuard();
  var areaGuard = MS.createRequestGuard();
  var locGuard = MS.createRequestGuard();   // 늦게 온 위치 응답이 새 동작을 덮지 않게
  var map, places, geocoder, circle, meOverlay, centerOverlay;
  var pins = {};

  // ---------- 상태 문구 ----------
  function setStatus(text, retry) {
    var el = $('status');
    el.textContent = text || '';
    if (retry) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = '다시 시도';
      b.onclick = retry;
      el.appendChild(b);
    }
  }
  function setBase(extraWarn) {
    var el = $('base');
    el.textContent = '';
    if (!S.center) { el.textContent = '기준: 없음 — 동네를 검색해 주세요'; return; }
    el.appendChild(document.createTextNode(S.center.mode === 'me'
      ? '기준: 내 위치'
      : '기준: ' + S.center.label + ' (거리는 이곳 기준)'));
    if (extraWarn) {
      var w = document.createElement('span');
      w.className = 'warn'; w.textContent = ' · ' + extraWarn;
      el.appendChild(w);
    }
  }

  // ---------- 칩 ----------
  function renderChips() {
    var c = $('chips');
    c.textContent = '';
    function add(label, on, fn) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      if (on) b.className = 'on';
      b.onclick = fn;
      c.appendChild(b);
    }
    function sep() { var s = document.createElement('span'); s.className = 'sep'; c.appendChild(s); }
    MS.TYPES.forEach(function (t) { add(t.label, S.type === t.key, function () { change('type', t.key); }); });
    sep();
    MS.RADII.forEach(function (r) { add(MS.formatDistance(r).replace('.0km', 'km'), S.radius === r, function () { change('radius', r); }); });
    sep();
    add('추천순', S.sort === 'accuracy', function () { change('sort', 'accuracy'); });
    add('가까운순', S.sort === 'distance', function () { change('sort', 'distance'); });
    var h = document.createElement('span');
    h.className = 'hint'; h.textContent = '추천순 = 카카오 정확도순';
    c.appendChild(h);
  }
  function change(key, val) {
    if (S[key] === val) return;
    S[key] = val;
    renderChips();
    runSearch();
  }

  // ---------- 지도 ----------
  function latLng(p) { return new kakao.maps.LatLng(p.lat, p.lng); }
  function overlay(cls, pos, z) {
    var el = document.createElement('div');
    el.className = cls;
    return new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 0.5, xAnchor: 0.5, zIndex: z || 1 });
  }
  function showCenter() {
    var pos = latLng(S.center);
    if (centerOverlay) centerOverlay.setMap(null);
    if (S.center.mode === 'area') {
      centerOverlay = overlay('center', pos, 2);
      centerOverlay.setMap(map);
    }
    if (!circle) {
      circle = new kakao.maps.Circle({ strokeWeight: 2, strokeColor: '#f97316', strokeOpacity: 0.7, strokeStyle: 'dash',
        fillColor: '#f97316', fillOpacity: 0.06 });
    }
    circle.setPosition(pos);
    circle.setRadius(S.radius);
    circle.setMap(map);
    // 반경 원이 화면에 꽉 차도록 직접 영역 계산
    var dLat = S.radius / 111320, dLng = S.radius / (111320 * Math.cos(S.center.lat * Math.PI / 180));
    map.setBounds(new kakao.maps.LatLngBounds(
      new kakao.maps.LatLng(S.center.lat - dLat, S.center.lng - dLng),
      new kakao.maps.LatLng(S.center.lat + dLat, S.center.lng + dLng)));
  }
  function showMe() {
    if (!S.me) return;
    if (!meOverlay) meOverlay = overlay('me', latLng(S.me), 3);
    meOverlay.setPosition(latLng(S.me));
    meOverlay.setMap(map);
  }
  function clearPins() {
    Object.keys(pins).forEach(function (id) { pins[id].ov.setMap(null); });
    pins = {};
  }
  function drawPins(list) {
    clearPins();
    list.forEach(function (p, i) {
      var el = document.createElement('div');
      el.className = 'pin';
      el.textContent = String(i + 1);
      var nm = document.createElement('span');
      nm.className = 'nm'; nm.textContent = p.name;
      el.appendChild(nm);
      el.addEventListener('click', function () { select(p.id, 'pin'); });
      var ov = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(p.y, p.x), content: el, yAnchor: 1, zIndex: 4, clickable: true });
      ov.setMap(map);
      pins[p.id] = { ov: ov, el: el };
    });
  }

  // ---------- 목록 ----------
  function renderList(list) {
    var box = $('list');
    box.textContent = '';
    list.forEach(function (p, i) {
      var it = document.createElement('div');
      it.className = 'item'; it.dataset.id = p.id;
      var no = document.createElement('span'); no.className = 'no'; no.textContent = (i + 1) + '.';
      var b = document.createElement('b'); b.textContent = p.name;
      var meta = document.createElement('div'); meta.className = 'meta';
      meta.textContent = [p.category, MS.formatDistance(p.distance), p.address].filter(Boolean).join(' · ');
      var act = document.createElement('div'); act.className = 'act';
      if (p.url) {
        var a = document.createElement('a');
        a.href = p.url; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = '카카오맵에서 보기';
        a.addEventListener('click', function (e) { e.stopPropagation(); });
        act.appendChild(a);
      }
      if (p.phone) {
        var t = document.createElement('a');
        t.className = 'tel'; t.href = 'tel:' + p.phone.replace(/[^0-9+]/g, '');
        t.textContent = '전화 ' + p.phone;
        t.addEventListener('click', function (e) { e.stopPropagation(); });
        act.appendChild(t);
      }
      it.appendChild(no); it.appendChild(b); it.appendChild(meta); it.appendChild(act);
      it.addEventListener('click', function () { select(p.id, 'list'); });
      box.appendChild(it);
    });
  }
  function select(id, from) {
    S.selId = id;
    Object.keys(pins).forEach(function (k) { pins[k].el.classList.toggle('sel', k === id); });
    var items = document.querySelectorAll('.item');
    var target = null;
    for (var i = 0; i < items.length; i++) {
      var on = items[i].dataset.id === id;
      items[i].classList.toggle('sel', on);
      if (on) target = items[i];
    }
    var p = S.places.filter(function (x) { return x.id === id; })[0];
    if (p && from === 'list') map.panTo(new kakao.maps.LatLng(p.y, p.x));
    if (target && from === 'pin') target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function show(list) {
    S.places = list;
    renderList(list);
    drawPins(list);
    if (S.selId && !list.some(function (p) { return p.id === S.selId; })) S.selId = null;
    if (S.selId) select(S.selId);
  }

  // ---------- 가게 검색 ----------
  function runSearch() {
    if (!S.center || !places) return;
    var id = guard.next();
    var plan = MS.buildSearchPlan(S.type, S.sort, S.radius);
    var typeKey = S.type, sortKey = S.sort;
    S.selId = null;
    show([]);
    showCenter();
    setStatus(MS.MESSAGES.searching);
    var loc = latLng(S.center);
    var SortBy = kakao.maps.services.SortBy;
    var St = kakao.maps.services.Status;

    MS.collectPages({
      isCurrent: function () { return guard.isCurrent(id); },
      fetchPage: function (page, done) {
        var opts = {
          location: loc, radius: plan.radius, page: page, size: 15,
          sort: plan.sort === 'distance' ? SortBy.DISTANCE : SortBy.ACCURACY
        };
        var cb = function (result, status, pagination) {
          var s = status === St.OK ? 'OK' : status === St.ZERO_RESULT ? 'ZERO_RESULT' : 'ERROR';
          done(s, result || [], !!(pagination && pagination.hasNextPage));
        };
        if (plan.method === 'keyword') {
          opts.category_group_code = plan.group;
          places.keywordSearch(plan.keyword, cb, opts);
        } else {
          places.categorySearch(plan.group, cb, opts);
        }
      },
      onPage: function (all) {
        show(MS.finalizePlaces(all, typeKey, sortKey));
        setStatus(MS.MESSAGES.searching);
      },
      onDone: function (r) {
        var list = r.status === 'ok' ? MS.finalizePlaces(r.places, typeKey, sortKey) : [];
        show(list);
        if (r.status === 'error') {
          setStatus(MS.MESSAGES.error, runSearch);
        } else if (!list.length) {
          setStatus(typeKey === 'all' || typeKey === 'cafe' ? MS.MESSAGES.zero : MS.MESSAGES.zeroType);
        } else {
          var sortLabel = sortKey === 'distance' ? '가까운 순' : '추천순';
          setStatus(list.length + '곳 · ' + sortLabel + (r.partial ? ' · ' + MS.MESSAGES.partial : '') + ' · ' + MS.MESSAGES.limitNote,
            r.partial ? runSearch : null);
        }
      }
    });
  }

  // ---------- 내 위치 ----------
  function locate() {
    if (!navigator.geolocation) { onLocFail(null); return; }
    areaGuard.next();       // 진행 중이던 동네 찾기는 무시
    var lid = locGuard.next();
    hideCands();
    setBase();
    setStatus('내 위치 확인 중…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      if (!locGuard.isCurrent(lid)) return;
      S.me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      S.center = { lat: S.me.lat, lng: S.me.lng, label: '내 위치', mode: 'me' };
      showMe();
      setBase(MS.isInaccurate(pos.coords.accuracy) ? MS.MESSAGES.locInaccurate : '');
      runSearch();
    }, function (err) {
      if (locGuard.isCurrent(lid)) onLocFail(err);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }
  function onLocFail(err) {
    setStatus(MS.MESSAGES[MS.locationErrorKey(err)]);
    if (!S.center) setBase();
  }

  // ---------- 동네 찾기 ----------
  function hideCands() { var c = $('cands'); c.hidden = true; c.textContent = ''; }
  function goArea(c) {
    hideCands();
    S.center = { lat: c.y, lng: c.x, label: c.name, mode: 'area' };
    setBase();
    runSearch();
  }
  function searchArea(q) {
    q = (q || '').trim();
    if (!q || !geocoder) return;
    var id = areaGuard.next();
    locGuard.next();        // 기다리던 내 위치 응답은 무시
    hideCands();
    setStatus('동네 찾는 중…');
    geocoder.addressSearch(q, function (addr, st) {
      if (!areaGuard.isCurrent(id)) return;
      var St = kakao.maps.services.Status;
      if (st === St.OK && addr && addr.length) { pick(MS.normalizeAreaCandidates(addr, null)); return; }
      places.keywordSearch(q, function (kw, st2) {
        if (!areaGuard.isCurrent(id)) return;
        if (st2 === St.ERROR) { setStatus(MS.MESSAGES.error, function () { searchArea(q); }); return; }
        pick(MS.normalizeAreaCandidates(null, st2 === St.OK ? kw : null));
      }, { size: 15 });
    });
    function pick(cands) {
      if (!cands.length) { setStatus(MS.MESSAGES.noArea); return; }
      if (cands.length === 1) { goArea(cands[0]); return; }
      var box = $('cands');
      box.textContent = '';
      var h = document.createElement('div'); h.className = 'head'; h.textContent = '어느 곳인가요?';
      box.appendChild(h);
      cands.forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button';
        b.appendChild(document.createTextNode(c.name));
        if (c.address && c.address !== c.name) {
          var s = document.createElement('small'); s.textContent = c.address;
          b.appendChild(s);
        }
        b.onclick = function () { goArea(c); };
        box.appendChild(b);
      });
      box.hidden = false;
      setStatus('검색 결과 중에서 골라 주세요.');
    }
  }

  // ---------- 시작 ----------
  function loadSdk(cb) {
    if (window.kakao && window.kakao.maps && window.kakao.maps.load) { window.kakao.maps.load(cb); return; }
    if (!CFG.kakaoJsKey) { setStatus('카카오 JavaScript 키가 아직 없어요 (config.js).'); setBase(); return; }
    var s = document.createElement('script');
    s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + encodeURIComponent(CFG.kakaoJsKey) + '&libraries=services&autoload=false';
    s.onload = function () {
      if (window.kakao && kakao.maps && kakao.maps.load) kakao.maps.load(cb);
      else setStatus(MS.MESSAGES.sdkFail, function () { location.reload(); });
    };
    s.onerror = function () { setStatus(MS.MESSAGES.sdkFail, function () { location.reload(); }); };
    document.head.appendChild(s);
  }
  function start() {
    var fc = CFG.fallbackCenter || { lat: 35.8714, lng: 128.6014 };
    map = new kakao.maps.Map($('map'), { center: new kakao.maps.LatLng(fc.lat, fc.lng), level: 5 });
    places = new kakao.maps.services.Places();
    geocoder = new kakao.maps.services.Geocoder();
    // 폴드를 접고 펼 때 지도 크기 다시 맞추기
    var keep = function () {
      var c = map.getCenter();
      map.relayout();
      map.setCenter(c);
    };
    if (window.ResizeObserver) new ResizeObserver(keep).observe($('map'));
    else window.addEventListener('resize', keep);
    locate();
  }

  $('searchForm').addEventListener('submit', function (e) {
    e.preventDefault();
    $('q').blur();
    searchArea($('q').value);
  });
  $('mine').addEventListener('click', function () { if (map) locate(); });
  $('foot').textContent = MS.MESSAGES.privacy;
  renderChips();
  setStatus('지도를 불러오는 중…');
  loadSdk(start);

  // 홈 화면 앱: https(또는 localhost)에서만 서비스 워커 등록
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  // 시험용 상태 보기
  window.__matzip = { state: S };
})();
