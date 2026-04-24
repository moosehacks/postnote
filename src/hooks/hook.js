(function () {
  'use strict';

  if (window.__bbHookInstalled) return;
  window.__bbHookInstalled = true;

  var SOURCE_CAP = 16384;

  // ---- Wrapper unwinding ----
  // Detect common monitoring wrapper patterns (New Relic, Sentry, Rollbar, Bugsnag, jQuery)
  // and return the inner function the site author actually wrote.
  var WRAPPER_PATTERNS = [
    {
      name: 'newrelic',
      detect: /newrelic|nrWrapper|__NR_/,
      extract: function (fn) {
        return fn.__NR_original || fn.__nr_original || fn.original || null;
      },
    },
    {
      name: 'sentry',
      detect: /raven|sentry|Sentry|__sentry/i,
      extract: function (fn) {
        return fn.__sentry_original__ || fn.__sentry_wrapped__ || fn.original || null;
      },
    },
    {
      name: 'rollbar',
      detect: /rollbar|Rollbar/,
      extract: function (fn) {
        return fn._rollbar_original || fn.original || null;
      },
    },
    {
      name: 'bugsnag',
      detect: /bugsnag|Bugsnag/,
      extract: function (fn) {
        return fn._bugsnag_original || fn.original || null;
      },
    },
    {
      name: 'jquery',
      detect: /jQuery|\$\.event/,
      extract: function (fn) {
        return (fn.handler && fn.handler !== fn) ? fn.handler : null;
      },
    },
  ];

  function tryUnwrap(fn) {
    var src;
    try { src = fn.toString(); } catch (e) { return fn; }

    for (var i = 0; i < WRAPPER_PATTERNS.length; i++) {
      var p = WRAPPER_PATTERNS[i];
      if (p.detect.test(src)) {
        var inner = null;
        try { inner = p.extract(fn); } catch (e) { /* ignore */ }
        if (typeof inner === 'function' && inner !== fn) return inner;
      }
    }
    return fn;
  }

  // ---- Origin check classification ----
  function classifyOriginCheck(src) {
    if (!/\borigin\b/.test(src)) return 'none';
    if (/\.startsWith\s*\(/.test(src)) return 'startsWith';
    if (/\.endsWith\s*\(/.test(src)) return 'endsWith';
    if (/\.indexOf\s*\(/.test(src)) return 'indexOf';
    if (/\/[^\n/]+\/[gimsuy]*\.test\s*\(|\.match\s*\(\//.test(src)) return 'regex';
    // Require the operator to appear within the same expression as origin
    // (no statement/block delimiters in between) to avoid false-negatives where
    // an unrelated === elsewhere in the function causes a safe-looking classification.
    if (/\borigin\b[^;{}\n]{0,80}===|===[^;{}\n]{0,80}\borigin\b/.test(src)) return 'strict-eq';
    if (/\borigin\b[^;{}\n]{0,80}(?<![=!<>])==(?!=)|(?<![=!<>])==(?!=)[^;{}\n]{0,80}\borigin\b/.test(src)) return 'loose-eq';
    return 'ref-only';
  }

  function topUrl() {
    try { return window.top.location.href; } catch (e) { return window.location.href; }
  }

  function report(payload) {
    try {
      // __bbReport is injected by CDP Runtime.addBinding
      if (typeof __bbReport === 'function') {
        __bbReport(JSON.stringify(payload));
      }
    } catch (e) { /* never interrupt the page */ }
  }

  // ---- DOM-XSS source tracking ----
  // Storage reads are tracked here because storage values aren't available
  // at sink time via a simple property read (unlike URL-based sources).
  var SOURCE_VALUE_CAP = 200;
  var storageReads = { localStorage: [], sessionStorage: [] };

  function trackStorageRead(storeName, value) {
    var str = String(value == null ? '' : value).slice(0, SOURCE_VALUE_CAP);
    if (!str) return;
    storageReads[storeName].push(str);
  }

  // Hook localStorage.getItem / sessionStorage.getItem to record what was read.
  (function () {
    ['localStorage', 'sessionStorage'].forEach(function (storeName) {
      try {
        var store = window[storeName];
        if (!store) return;
        var origGet = store.getItem.bind(store);
        store.getItem = function (key) {
          var v = origGet(key);
          if (v != null) trackStorageRead(storeName, v);
          return v;
        };
      } catch (e) { /* never interrupt */ }
    });
  })();

  // ---- DOM-XSS sink wrappers ----
  var SINK_VALUE_CAP = 1024;

  /**
   * Detects which taint sources contributed to the sink value.
   * URL-based sources (hash, search, referrer) are read directly at call time
   * since they are always available. Storage sources are checked against the
   * read log accumulated by the getItem hooks above.
   */
  function detectSources(val) {
    var sources = [];
    try {
      var hash = window.location.hash;
      if (hash && hash.length > 1 && val.indexOf(hash.slice(1)) !== -1) {
        sources.push('hash');
      }
    } catch (e) {}
    try {
      var search = window.location.search;
      if (search && search.length > 1) {
        // Check if any individual query-param value appears in the sink value.
        var pairs = search.slice(1).split('&');
        for (var i = 0; i < pairs.length; i++) {
          var eq = pairs[i].indexOf('=');
          var pv = eq !== -1 ? pairs[i].slice(eq + 1) : pairs[i];
          pv = decodeURIComponent(pv.replace(/\+/g, ' '));
          if (pv && val.indexOf(pv) !== -1) {
            sources.push('search');
            break;
          }
        }
      }
    } catch (e) {}
    try {
      var ref = document.referrer;
      if (ref && val.indexOf(ref) !== -1) sources.push('referrer');
    } catch (e) {}
    // Storage
    ['localStorage', 'sessionStorage'].forEach(function (storeName) {
      var reads = storageReads[storeName];
      for (var j = 0; j < reads.length; j++) {
        // Minimum 4-char guard: very short storage values (e.g. "1", "en",
        // "true") match in almost any string and produce noisy false positives.
        if (reads[j] && reads[j].length >= 4 && val.indexOf(reads[j]) !== -1) {
          sources.push(storeName);
          break;
        }
      }
    });
    return sources;
  }

  function reportSink(sinkName, value) {
    try {
      var val = String(value == null ? '' : value).slice(0, SINK_VALUE_CAP);
      var stack = '';
      try { stack = new Error().stack || ''; } catch (e) { /* ignore */ }
      var sources = detectSources(val);
      report({
        t: 'sink',
        sink: sinkName,
        value: val,
        stack: stack,
        topUrl: topUrl(),
        frameUrl: window.location.href,
        sources: sources,
      });
    } catch (e) { /* never interrupt the page */ }
  }

  // innerHTML / outerHTML setters on Element.prototype
  (function () {
    try {
      var elProto = Element.prototype;
      var innerDesc = Object.getOwnPropertyDescriptor(elProto, 'innerHTML');
      if (innerDesc && innerDesc.set) {
        Object.defineProperty(elProto, 'innerHTML', {
          get: innerDesc.get,
          set: function (v) {
            reportSink('innerHTML', v);
            innerDesc.set.call(this, v);
          },
          configurable: true,
        });
      }
      var outerDesc = Object.getOwnPropertyDescriptor(elProto, 'outerHTML');
      if (outerDesc && outerDesc.set) {
        Object.defineProperty(elProto, 'outerHTML', {
          get: outerDesc.get,
          set: function (v) {
            reportSink('outerHTML', v);
            outerDesc.set.call(this, v);
          },
          configurable: true,
        });
      }
    } catch (e) { /* never interrupt */ }
  })();

  // insertAdjacentHTML
  (function () {
    try {
      var origIAH = Element.prototype.insertAdjacentHTML;
      if (origIAH) {
        Element.prototype.insertAdjacentHTML = function (position, text) {
          reportSink('insertAdjacentHTML', text);
          return origIAH.call(this, position, text);
        };
      }
    } catch (e) { /* never interrupt */ }
  })();

  // eval
  (function () {
    try {
      var origEval = window.eval;
      window.eval = function (code) {
        reportSink('eval', code);
        return origEval.call(this, code);
      };
      window.eval.toString = origEval.toString.bind(origEval);
    } catch (e) { /* never interrupt */ }
  })();

  // document.write / document.writeln
  (function () {
    try {
      var origWrite = document.write.bind(document);
      document.write = function () {
        var args = Array.prototype.slice.call(arguments);
        reportSink('document.write', args.join(''));
        return origWrite.apply(document, args);
      };
      var origWriteln = document.writeln.bind(document);
      document.writeln = function () {
        var args = Array.prototype.slice.call(arguments);
        reportSink('document.writeln', args.join(''));
        return origWriteln.apply(document, args);
      };
    } catch (e) { /* never interrupt */ }
  })();

  // location.href setter
  (function () {
    try {
      var locProto = Location.prototype;
      var hrefDesc = Object.getOwnPropertyDescriptor(locProto, 'href');
      if (hrefDesc && hrefDesc.set) {
        Object.defineProperty(locProto, 'href', {
          get: hrefDesc.get,
          set: function (v) {
            reportSink('location.href', v);
            hrefDesc.set.call(this, v);
          },
          configurable: true,
        });
      }
    } catch (e) { /* never interrupt */ }
  })();

  // ---- Wrap addEventListener ----
  var origAEL = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (type === 'message' && typeof listener === 'function') {
      try {
        var unwrapped = tryUnwrap(listener);
        var src = '';
        try { src = unwrapped.toString().slice(0, SOURCE_CAP); } catch (e) { /* ignore */ }
        var stack = '';
        try { stack = new Error().stack || ''; } catch (e) { /* ignore */ }
        report({
          t: 'listener',
          type: type,
          source: src,
          stack: stack,
          topUrl: topUrl(),
          frameUrl: window.location.href,
          originCheck: classifyOriginCheck(src),
        });
      } catch (e) { /* never interrupt the page */ }
    }
    return origAEL.call(this, type, listener, options);
  };

  // ---- Capture outbound postMessage calls ----
  var origPM = window.postMessage.bind(window);
  window.postMessage = function (message, targetOrigin, transfer) {
    try {
      var to = typeof targetOrigin === 'string' ? targetOrigin
        : (Array.isArray(targetOrigin) && targetOrigin.length > 0 ? targetOrigin[0]
          : (typeof targetOrigin === 'object' && targetOrigin !== null && 'targetOrigin' in targetOrigin
            ? (targetOrigin.targetOrigin != null ? String(targetOrigin.targetOrigin) : '*')
            : '*'));
      var stack = '';
      try { stack = new Error().stack || ''; } catch (e) { /* ignore */ }
      var PAYLOAD_CAP = 4096;
      report({
        t: 'postmessage',
        targetOrigin: to,
        message: (function() {
          try { return JSON.stringify(message).slice(0, PAYLOAD_CAP); } catch(e) { return '[unserializable]'; }
        })(),
        stack: stack,
        topUrl: topUrl(),
        frameUrl: window.location.href,
      });
    } catch (e) { /* never interrupt the page */ }
    return transfer !== undefined ? origPM(message, targetOrigin, transfer) : origPM(message, targetOrigin);
  };
})();
