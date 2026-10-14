(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MatzipSearch = factory();
  }
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var TYPES = [
    { key: 'all', label: '전체', group: 'FD6', keyword: null },
    { key: 'korean', label: '한식', group: 'FD6', keyword: '한식' },
    { key: 'chinese', label: '중식', group: 'FD6', keyword: '중식' },
    { key: 'japanese', label: '일식', group: 'FD6', keyword: '일식' },
    { key: 'western', label: '양식', group: 'FD6', keyword: '양식' },
    { key: 'snack', label: '분식', group: 'FD6', keyword: '분식' },
    { key: 'chicken', label: '치킨', group: 'FD6', keyword: '치킨' },
    { key: 'cafe', label: '카페', group: 'CE7', keyword: null }
  ];
  var RADII = [500, 1000, 3000];
  var DEFAULTS = { type: 'all', radius: 1000, sort: 'accuracy' };
  var MAX_PAGES = 3;
  var MAX_RESULTS = 45;
  var MESSAGES = {
    searching: '찾는 중…',
    zero: '이 범위에서 가게를 찾지 못했어요. 거리를 넓혀 보세요.',
    zeroType: '이번 검색에서 이 종류 가게를 찾지 못했어요. 거리를 넓혀 보세요.',
    error: '불러오지 못했어요. 인터넷·설정·사용 한도를 확인한 뒤 다시 시도해 주세요.',
    partial: '일부만 불러왔어요.',
    limitNote: '한 번에 최대 45곳까지 보여요(주변 전부는 아님).',
    locDenied: '위치 권한이 꺼져 있어요. 크롬 주소창 왼쪽 ⓘ(또는 자물쇠) → 권한 → 위치를 허용하거나, 동네를 검색해 주세요.',
    locTimeout: '위치를 받지 못했어요(10초). 다시 누르거나 동네를 검색해 주세요.',
    locUnavailable: '위치를 확인할 수 없어요. 동네를 검색해 주세요.',
    locInaccurate: '위치가 정확하지 않을 수 있어요.',
    sdkFail: '카카오 지도를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.',
    noArea: '그런 동네를 찾지 못했어요. 예: 대구 동성로',
    privacy: '위치는 저장하지 않아요. 검색할 때만 카카오로 보내져요.',
    privacyBlog: '위치는 기기에 저장하지 않아요. 카카오에는 위치를, 블로그 확인용 중계 서버·네이버에는 가게 이름과 동네 이름을 보내요.'
  };

  // Number('') / Number(null)이 0이 되는 것을 막는다.
  function numeric(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    var result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function string(value) {
    return typeof value === 'string' ? value : '';
  }

  function findType(key) {
    return TYPES.find(function (type) { return type.key === key; });
  }

  function formatDistance(m) {
    var distance = numeric(m);
    if (distance === null || distance < 0) return '';
    return distance < 1000 ? Math.round(distance) + 'm' : (distance / 1000).toFixed(1) + 'km';
  }

  function categoryLevels(categoryName) {
    if (typeof categoryName !== 'string') return [];
    return categoryName.split('>').map(function (level) {
      return level.replace(/\s/g, '');
    }).filter(function (level) { return level !== ''; });
  }

  function shortCategory(categoryName) {
    var levels = categoryLevels(categoryName);
    return levels.length ? levels[levels.length - 1] : '';
  }

  // 카카오 원본과 normalizePlace 결과를 모두 받는다.
  function matchesType(place, typeKey) {
    var type = findType(typeKey);
    if (!type || !place || typeof place !== 'object') return false;
    var group = place.category_group_code !== undefined ? place.category_group_code : place.group;
    if (!type.keyword) return !group || group === type.group;
    var categoryName = place.category_name !== undefined ? place.category_name : place.categoryName;
    return categoryLevels(categoryName).indexOf(type.label) !== -1;
  }

  function buildSearchPlan(typeKey, sortKey, radius) {
    var type = findType(typeKey) || TYPES[0];
    return {
      method: type.keyword ? 'keyword' : 'category',
      group: type.group,
      keyword: type.keyword,
      // 언급순은 카카오 추천순으로 받아 와서 화면에서만 다시 정렬한다.
    sort: sortKey === 'distance' ? 'distance' : 'accuracy',
      radius: RADII.indexOf(radius) !== -1 ? radius : DEFAULTS.radius
    };
  }

  function normalizePlace(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = raw.id;
    if ((typeof id !== 'string' && typeof id !== 'number') ||
        (typeof id === 'string' && id.trim() === '') ||
        (typeof id === 'number' && !Number.isFinite(id))) return null;
    var x = numeric(raw.x);
    var y = numeric(raw.y);
    if (x === null || y === null) return null;
    var categoryName = string(raw.category_name);
    return {
      id: String(id),
      name: string(raw.place_name),
      category: shortCategory(categoryName),
      categoryName: categoryName,
      group: string(raw.category_group_code),
      distance: numeric(raw.distance),
      address: string(raw.road_address_name) || string(raw.address_name),
      lotAddress: string(raw.address_name),
      phone: string(raw.phone),
      url: string(raw.place_url),
      x: x,
      y: y
    };
  }

  function mergePlaces(existing, incoming) {
    var merged = [];
    var ids = new Set();
    [existing, incoming].forEach(function (items) {
      if (!Array.isArray(items)) return;
      items.forEach(function (place) {
        if (place && !ids.has(place.id)) {
          ids.add(place.id);
          merged.push(place);
        }
      });
    });
    return merged;
  }

  function finalizePlaces(places, typeKey, sortKey) {
    var filtered = (Array.isArray(places) ? places : []).filter(function (place) {
      return matchesType(place, typeKey);
    });
    if (sortKey === 'distance') {
      // 원래 위치를 같이 비교해 같은 거리와 null의 순서를 보존한다.
      filtered = filtered.map(function (place, index) {
        return { place: place, index: index };
      }).sort(function (a, b) {
        var left = a.place.distance;
        var right = b.place.distance;
        if (left === null && right !== null) return 1;
        if (right === null && left !== null) return -1;
        return (left === right ? 0 : left - right) || a.index - b.index;
      }).map(function (item) { return item.place; });
    }
    return filtered.slice(0, MAX_RESULTS);
  }

  function collectPages(opts) {
    var places = [];

    function finish(status, partial) {
      if (opts.isCurrent()) opts.onDone({ places: places, status: status, partial: partial });
    }

    function request(page) {
      if (!opts.isCurrent()) return;
      var handled = false;
      opts.fetchPage(page, function (status, rawItems, hasNext) {
        if (handled) return;
        handled = true;
        if (!opts.isCurrent()) return;
        if (status === 'OK') {
          var normalized = (Array.isArray(rawItems) ? rawItems : []).map(normalizePlace).filter(function (place) {
            return place !== null;
          });
          places = mergePlaces(places, normalized);
          opts.onPage(places, { page: page });
          if (hasNext && page < MAX_PAGES) {
            request(page + 1);
          } else {
            finish(places.length ? 'ok' : 'zero', false);
          }
        } else if (status === 'ZERO_RESULT') {
          finish(places.length ? 'ok' : 'zero', false);
        } else {
          finish(page === 1 ? 'error' : 'ok', page > 1);
        }
      });
    }

    request(1);
  }

  function createRequestGuard() {
    var current = 0;
    return {
      next: function () { current += 1; return current; },
      isCurrent: function (id) { return id === current; }
    };
  }

  function normalizeAreaCandidates(addressResults, keywordResults) {
    var candidates = [];
    var seen = new Set();

    function addResults(results, isAddress) {
      if (!Array.isArray(results)) return;
      results.forEach(function (raw) {
        if (!raw || typeof raw !== 'object' || candidates.length >= 5) return;
        var x = numeric(raw.x);
        var y = numeric(raw.y);
        if (x === null || y === null) return;
        var name = string(isAddress ? raw.address_name : raw.place_name);
        var address = isAddress ? string(raw.address_name) : string(raw.road_address_name) || string(raw.address_name);
        // 구분자가 이름/주소 안에 들어가도 충돌하지 않는 쌍 키.
        var key = JSON.stringify([name, address]);
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push({ name: name, address: address, x: x, y: y });
      });
    }

    addResults(addressResults, true);
    addResults(keywordResults, false);
    return candidates;
  }

  function locationErrorKey(error) {
    if (error && error.code === 1) return 'locDenied';
    if (error && error.code === 3) return 'locTimeout';
    return 'locUnavailable';
  }

  function isInaccurate(accuracyMeters) {
    return typeof accuracyMeters === 'number' && Number.isFinite(accuracyMeters) && accuracyMeters > 200;
  }

  // ---------- 다른 곳 후기 (바로가기·네이버 블로그 글 수) ----------
  var BLOG_DAYS = 90;

  // 지번 주소에서 동네 낱말: '동·읍·면·가·리'로 끝나는 첫 낱말, 없으면 시군구 낱말.
  function regionWord(addressName) {
    var words = string(addressName).trim().split(/\s+/).slice(1);
    var hit = words.filter(function (w) { return /[가-힣0-9](동|읍|면|가|리)$/.test(w); })[0];
    if (hit) return hit;
    return words.filter(function (w) { return /[가-힣](구|군|시)$/.test(w); })[0] || '';
  }

  function blogQuery(place) {
    if (!place) return '';
    var region = regionWord(place.lotAddress || place.address);
    return (string(place.name).trim() + (region ? ' ' + region : '')).trim();
  }

  // 지번 주소에서 동네 낱말 앞의 마지막 시·군·구 낱말 ("경북 포항시 북구 죽도동" → "북구").
  function siGunGu(addressName) {
    var words = string(addressName).trim().split(/\s+/).slice(1);
    var out = '';
    for (var i = 0; i < words.length; i += 1) {
      if (/[가-힣0-9](동|읍|면|가|리)$/.test(words[i])) break;
      if (/[가-힣](구|군|시)$/.test(words[i])) out = words[i];
    }
    return out;
  }

  // 네이버 지도용 검색어: 카카오와 네이버의 지점 이름이 자주 달라서(죽전점↔죽전직영점)
  // 마지막 '○○점' 낱말을 빼고 대신 구·동네로 가게를 가린다. 업종 낱말(홍콩반점 등)은 그대로.
  var NOT_BRANCH = /(반점|주점|상점|매점|음식점|분식점|제과점|편의점|할인점|전문점|정육점)$/;
  function naverMapQuery(place) {
    if (!place) return '';
    var addr = place.lotAddress || place.address;
    var region = regionWord(addr);
    var sgg = siGunGu(addr);
    var words = string(place.name).trim().split(/\s+/).filter(Boolean);
    var last = words[words.length - 1] || '';
    var cut = (region || sgg) && words.length >= 2 && /.점$/.test(last) && !NOT_BRANCH.test(last);
    if (!cut) return blogQuery(place);  // 지점 낱말이 없으면 구를 붙이지 않는다(붙이면 순위가 밀린 가게가 있었음)
    words.pop();
    return [sgg && sgg !== region ? sgg : '', words.join(' '), region].filter(Boolean).join(' ');
  }

  function enc(s) { return encodeURIComponent(s); }
  function outLinks(place) {
    var q = blogQuery(place);
    var addr = string(place.address) || string(place.lotAddress);
    return {
      naverMap: 'https://m.map.naver.com/search2/search.naver?query=' + enc(naverMapQuery(place)),
      blog: 'https://m.search.naver.com/search.naver?where=m_blog&query=' + enc(q) + '&nso=' + enc('so:dd,p:all'),
      google: 'https://www.google.com/maps/search/?api=1&query=' + enc((string(place.name) + ' ' + addr).trim())
    };
  }

  // 띄어쓰기·대소문자·흔한 부호를 무시하고 비교한다.
  function normText(s) {
    return string(s).toLowerCase().replace(/[\s·\-_.,'"()\[\]]/g, '');
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // "○○식당 감삼점" → 전체 이름 + 지점 뺀 이름 + 지점 낱말("감삼")
  function nameParts(name) {
    var words = string(name).trim().split(/\s+/).filter(Boolean);
    var last = words[words.length - 1] || '';
    var parts = { full: normText(words.join('')), core: null, branch: null, coreWords: null };
    if (words.length >= 2 && /..점$/.test(last)) {
      parts.coreWords = words.slice(0, -1).join('');
      parts.core = normText(parts.coreWords);
      parts.branch = normText(last.slice(0, -1));
    }
    return parts;
  }

  // 글(제목+요약)이 이 가게 이야기인지. 지점 가게는 다른 지점 글을 빼고, 지점·동네 낱말이 있어야 센다.
  function isRelevantPost(text, parts, region) {
    if (!parts || parts.full.length < 2) return false;
    var t = normText(text);
    if (t.indexOf(parts.full) !== -1) return true;
    if (!parts.core || parts.core.length < 2 || t.indexOf(parts.core) === -1) return false;
    // 이름 바로 뒤에 다른 "○○점"이 오면 다른 지점 글. '점' 뒤는 끝·부호·조사("범어점에서")만 지점으로 본다('점심'은 아님)
    var coreRe = parts.coreWords.replace(/\s/g, '').split('').map(escapeRe).join('\\s*');
    var other = new RegExp(coreRe + '\\s*([가-힣A-Za-z0-9]{2,6})점(?=$|[^가-힣]|(?:에서|에선|에도|은|는|을|를|이|가|의|에|도|으로|로|과|와|이랑|까지)(?:$|[^가-힣]))', 'gi');
    var spaced = string(text).replace(/[·\-_.,'"()\[\]]/g, ' ');
    var m;
    while ((m = other.exec(spaced)) !== null) {
      if (normText(m[1]) !== parts.branch) return false;
    }
    var regionCore = normText(region).replace(/(동|읍|면|가|리)$/, '');
    return (parts.branch.length >= 2 && t.indexOf(parts.branch) !== -1) || (regionCore.length >= 2 && t.indexOf(regionCore) !== -1);
  }

  // yyyymmdd → 1970-01-01부터 일수. 없는 날짜(2월 30일 등)는 null.
  function ymdToDay(ymd) {
    var s = String(ymd === undefined || ymd === null ? '' : ymd);
    if (!/^\d{8}$/.test(s)) return null;
    var y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
    var t = Date.UTC(y, m - 1, d);
    var back = new Date(t);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
    return Math.round(t / 86400000);
  }
  // 기기 시간대와 상관없이 한국 날짜(yyyymmdd)
  function todayKst(nowMs) {
    var d = new Date((typeof nowMs === 'number' ? nowMs : Date.now()) + 9 * 3600000);
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }

  // 네이버 블로그 최신 글(최대 100건)에서 이 가게 글을 센다.
  // state: full(90일 전부 봄) / partial(최근 글이 너무 많아 일부만 봄 → 최소값) / skip(이름이 너무 짧음)
  function countRecent(resp, place, todayYmd) {
    var parts = nameParts(place && place.name);
    if (parts.full.length < 2) return { state: 'skip' };
    var region = regionWord(place.lotAddress || place.address);
    var today = ymdToDay(todayYmd);
    var start = today - (BLOG_DAYS - 1);
    var items = resp && Array.isArray(resp.items) ? resp.items : [];
    var seen = new Set();
    var recent = 0, last = null, oldest = null, bad = 0;
    items.forEach(function (it) {
      if (!it || typeof it !== 'object') { bad++; return; }
      var key = it.l || (it.t + '|' + it.p);
      if (seen.has(key)) return;
      seen.add(key);
      var day = ymdToDay(it.p);
      if (day === null) { bad++; return; }
      if (oldest === null || day < oldest) oldest = day;
      if (day > today) return;
      if (!isRelevantPost(string(it.t) + ' ' + string(it.d), parts, region)) return;
      if (last === null || day > last) last = day;
      if (day >= start) recent++;
    });
    var total = numeric(resp && resp.total);
    // 날짜를 못 읽은 글이 있으면 그 글이 최근 글일 수도 있으니 최소값("+")으로 본다
    var cut = (total !== null && total > items.length && oldest !== null && oldest >= start) || bad > 0;
    return { state: cut ? 'partial' : 'full', recent: recent, last: last, bad: bad };
  }

  function dayLabel(day, todayYmd) {
    var d = new Date(day * 86400000);
    var y = d.getUTCFullYear(), md = (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
    return y === Math.floor(todayYmd / 10000) ? md : y + '/' + md;
  }
  function formatBlog(r, todayYmd) {
    if (!r || r.state === 'skip') return '';
    if (r.state === 'fail') return '블로그 확인 못 함';
    if (r.state === 'pending') return '블로그 글 세는 중…';
    var lastTxt = r.last !== null ? ' · 마지막 ' + dayLabel(r.last, todayYmd) : '';
    if (r.recent > 0) return '최근 90일 블로그 ' + r.recent + (r.state === 'partial' ? '개+' : '개') + lastTxt;
    if (r.state === 'partial') return '최근 블로그 글이 많아 이 가게 글은 못 찾음';
    return r.last !== null ? '최근 90일 블로그 글 없음' + lastTxt : '블로그 글 못 찾음';
  }

  // 언급순: 최근 글 많은 순 → 마지막 글 늦은 순 → 원래(추천) 순. 확인 못 한 가게는 맨 뒤.
  function sortByMention(places, results) {
    var list = Array.isArray(places) ? places : [];
    var res = results || {};
    return list.map(function (p, i) { return { p: p, i: i, r: res[p.id] }; }).sort(function (a, b) {
      var oa = a.r && (a.r.state === 'full' || a.r.state === 'partial');
      var ob = b.r && (b.r.state === 'full' || b.r.state === 'partial');
      if (oa !== ob) return oa ? -1 : 1;
      if (oa) {
        if (a.r.recent !== b.r.recent) return b.r.recent - a.r.recent;
        var la = a.r.last === null ? -Infinity : a.r.last, lb = b.r.last === null ? -Infinity : b.r.last;
        if (la !== lb) return lb > la ? 1 : -1;
      }
      return a.i - b.i;
    }).map(function (x) { return x.p; });
  }

  return {
    regionWord: regionWord,
    blogQuery: blogQuery,
    siGunGu: siGunGu,
    naverMapQuery: naverMapQuery,
    outLinks: outLinks,
    normText: normText,
    nameParts: nameParts,
    isRelevantPost: isRelevantPost,
    ymdToDay: ymdToDay,
    todayKst: todayKst,
    countRecent: countRecent,
    formatBlog: formatBlog,
    sortByMention: sortByMention,
    BLOG_DAYS: BLOG_DAYS,
    TYPES: TYPES,
    RADII: RADII,
    DEFAULTS: DEFAULTS,
    MAX_PAGES: MAX_PAGES,
    MAX_RESULTS: MAX_RESULTS,
    formatDistance: formatDistance,
    categoryLevels: categoryLevels,
    shortCategory: shortCategory,
    matchesType: matchesType,
    buildSearchPlan: buildSearchPlan,
    normalizePlace: normalizePlace,
    mergePlaces: mergePlaces,
    finalizePlaces: finalizePlaces,
    collectPages: collectPages,
    createRequestGuard: createRequestGuard,
    normalizeAreaCandidates: normalizeAreaCandidates,
    MESSAGES: MESSAGES,
    locationErrorKey: locationErrorKey,
    isInaccurate: isInaccurate
  };
}));
