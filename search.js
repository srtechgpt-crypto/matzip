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
    privacy: '위치는 저장하지 않아요. 검색할 때만 카카오로 보내져요.'
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

  return {
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
