(function () {
  "use strict";
  var L = window.Logic;

  var state = { data: null, meta: null, queue: null, dayKey: null, userPickedDay: false };

  var params = new URLSearchParams(location.search);

  // `?now=2026-11-07T08:30` previews the page at a given Kyiv time (debug/demo aid).
  function currentTime() {
    var m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(params.get("now") || "");
    return m ? { key: m[1], minutes: +m[2] * 60 + +m[3] } : L.kyivNow();
  }

  function $(id) { return document.getElementById(id); }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "class") { node.className = props[k]; }
      else if (k === "text") { node.textContent = props[k]; }
      else if (k.slice(0, 2) === "on") { node.addEventListener(k.slice(2), props[k]); }
      else { node.setAttribute(k, props[k]); }
    });
    (children || []).forEach(function (c) { if (c) { node.appendChild(c); } });
    return node;
  }

  function store(key, value) {
    try {
      if (value === undefined) { return localStorage.getItem(key); }
      localStorage.setItem(key, value);
    } catch (e) { /* storage blocked - fine */ }
    return null;
  }

  /* ---------- timeline bar ---------- */

  function bar(intervals, small, nowMin) {
    var b = el("div", { class: "bar" + (small ? " small" : "") });
    intervals.forEach(function (iv) {
      var s = el("div", { class: "seg" });
      s.style.left = (iv[0] / 14.4) + "%";
      s.style.width = ((iv[1] - iv[0]) / 14.4) + "%";
      b.appendChild(s);
    });
    if (nowMin !== null && nowMin !== undefined) {
      var n = el("div", { class: "now", title: "Зараз" });
      n.style.left = "calc(" + (nowMin / 14.4) + "% - 1px)";
      b.appendChild(n);
    }
    return b;
  }

  function ticks() {
    var t = el("div", { class: "ticks", "aria-hidden": "true" });
    [0, 6, 12, 18, 24].forEach(function (h) {
      var s = el("span", { text: String(h).padStart(2, "0") + ":00" });
      s.style.left = (h / 24 * 100) + "%";
      t.appendChild(s);
    });
    return t;
  }

  /* ---------- sections ---------- */

  function renderPicker() {
    var box = $("queue-picker");
    if (!box.children.length) {
      // columns = queue 1..6, rows = sub-queue .1 / .2
      [1, 2].forEach(function (sub) {
        for (var n = 1; n <= 6; n++) {
          (function (q) {
            box.appendChild(el("button", {
              type: "button", class: "qbtn", "data-q": q, text: q,
              "aria-label": "Черга " + q,
              onclick: function () { selectQueue(q); }
            }));
          })(n + "." + sub);
        }
      });
    }
    Array.prototype.forEach.call(box.children, function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-q") === state.queue));
    });
  }

  function renderStatus(now) {
    var box = $("status");
    box.hidden = false;
    box.className = "card status";
    box.textContent = "";
    var icon = "💡", big, small = "";

    if (!state.queue) {
      box.classList.add("nodata");
      big = "Оберіть чергу";
      small = "Тоді тут з’явиться, чи є світло зараз і коли воно зміниться.";
    } else {
      var st = L.getStatus(state.data.days, now.key, now.minutes, state.queue);
      if (st.state === "nodata") {
        box.classList.add("nodata");
        icon = "❔";
        big = "Немає даних на сьогодні";
        small = "Графік на " + L.dayLabel(now.key, now.key).toLowerCase() + " ще не опубліковано на сайті Запоріжжяобленерго.";
      } else if (st.state === "off") {
        box.classList.add("off");
        icon = "🔌";
        big = "Світла немає";
        var left = st.until - now.minutes;
        small = "Очікуємо увімкнення о " + L.fmtTime(st.until) + " (через " + L.fmtDuration(left) + ")." +
          (st.until === 1440 && !st.tomorrowKnown ? " Графік на завтра ще не опубліковано." : "");
      } else {
        box.classList.add("on");
        icon = "💡";
        big = "Світло є";
        if (st.until !== null) {
          small = "Наступне відключення о " + L.fmtTime(st.until) + " (через " + L.fmtDuration(st.until - now.minutes) + ").";
        } else if (st.tomorrowKnown) {
          small = "Відключень до кінця завтрашнього дня не заплановано.";
        } else {
          small = "До кінця доби відключень не заплановано. Графік на завтра ще не опубліковано.";
        }
      }
    }
    box.appendChild(el("div", { class: "icon", "aria-hidden": "true", text: icon }));
    box.appendChild(el("div", {}, [
      el("p", { class: "big", text: big }),
      el("p", { class: "small", text: small })
    ]));
  }

  function visibleDayKeys(todayKey) {
    var from = L.addDays(todayKey, -2);
    return Object.keys(state.data.days).filter(function (k) { return k >= from; }).sort();
  }

  function pickDefaultDay(keys, todayKey) {
    if (keys.indexOf(todayKey) !== -1) { return todayKey; }
    var past = keys.filter(function (k) { return k < todayKey; });
    return past.length ? past[past.length - 1] : keys[0];
  }

  function renderTabs(now) {
    var keys = visibleDayKeys(now.key);
    if (!keys.length) { $("day-tabs").textContent = ""; return keys; }
    if (!state.userPickedDay || keys.indexOf(state.dayKey) === -1) {
      state.dayKey = pickDefaultDay(keys, now.key);
    }
    var box = $("day-tabs");
    box.textContent = "";
    keys.forEach(function (k) {
      box.appendChild(el("button", {
        type: "button", class: "tab", role: "tab",
        "aria-selected": String(k === state.dayKey),
        text: L.dayLabel(k, now.key),
        onclick: function () { state.dayKey = k; state.userPickedDay = true; render(); }
      }));
    });
    return keys;
  }

  function renderDay(now) {
    var box = $("my-day");
    box.textContent = "";
    var meta = $("day-meta");
    var day = state.data.days[state.dayKey];
    if (!day) {
      meta.textContent = "";
      box.appendChild(el("p", { class: "hint", text: "Немає опублікованих графіків." }));
      return;
    }
    meta.textContent = day.updatedAt ? "Оновлена версія графіка (" + day.updatedAt + ")" : "Графік на добу";

    if (!state.queue) {
      box.appendChild(el("p", { class: "hint", text: "Оберіть чергу вище, щоб побачити її графік." }));
      return;
    }
    var intervals = L.dayIntervals(day, state.queue);
    var isToday = state.dayKey === now.key;
    box.appendChild(ticks());
    box.appendChild(bar(intervals, false, isToday ? now.minutes : null));

    if (!intervals.length) {
      box.appendChild(el("p", { class: "empty", text: "Відключень за цим графіком не заплановано 🎉" }));
      return;
    }
    var ul = el("ul", { class: "intervals" });
    intervals.forEach(function (iv) {
      var current = isToday && now.minutes >= iv[0] && now.minutes < iv[1];
      ul.appendChild(el("li", { class: current ? "current" : "" }, [
        el("span", { text: L.fmtTime(iv[0]) + " – " + L.fmtTime(iv[1]) + (current ? "  · зараз" : "") }),
        el("span", { class: "dur", text: L.fmtDuration(iv[1] - iv[0]) })
      ]));
    });
    box.appendChild(ul);
    var total = L.totalMinutes(intervals);
    box.appendChild(el("p", {
      class: "summary",
      text: "Разом без світла: " + L.fmtDuration(total) + " · зі світлом: " + L.fmtDuration(1440 - total)
    }));
  }

  function renderAll(now) {
    var box = $("all-queues");
    box.textContent = "";
    var day = state.data.days[state.dayKey];
    if (!day) { return; }
    var isToday = state.dayKey === now.key;
    box.appendChild(el("div", { class: "row", style: "cursor:default" }, [
      el("span"), ticks()
    ]));
    L.QUEUES.forEach(function (q) {
      box.appendChild(el("button", {
        type: "button", class: "row", "aria-pressed": String(q === state.queue),
        "aria-label": "Черга " + q + ": " + (L.dayIntervals(day, q).map(function (iv) {
          return L.fmtTime(iv[0]) + "–" + L.fmtTime(iv[1]);
        }).join(", ") || "без відключень"),
        onclick: function () { selectQueue(q); }
      }, [
        el("span", { class: "lbl", text: q }),
        bar(L.dayIntervals(day, q), true, isToday ? now.minutes : null)
      ]));
    });
  }

  function renderNotes() {
    var day = state.data.days[state.dayKey];
    var card = $("notes-card");
    var notes = (day && day.notes) || [];
    card.hidden = !notes.length;
    var box = $("notes");
    box.textContent = "";
    box.className = "notes";
    notes.forEach(function (t) { box.appendChild(el("p", { text: t })); });
  }

  function renderFooter() {
    var node = $("checked");
    node.textContent = "";
    if (!state.meta || !state.meta.checkedAt) { return; }
    var t = new Date(state.meta.checkedAt);
    if (isNaN(t)) { return; }
    var txt = new Intl.DateTimeFormat("uk-UA", {
      timeZone: "Europe/Kyiv", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit"
    }).format(t);
    var stale = Date.now() - t.getTime() > 3 * 3600 * 1000;
    node.textContent = "Останнє автоматичне оновлення: " + txt + (stale ? " — дані можуть бути застарілими, перевірте джерело." : ".");
  }

  function render() {
    if (!state.data) { return; }
    var now = currentTime();
    renderPicker();
    renderStatus(now);
    var keys = renderTabs(now);
    $("error").hidden = true;
    if (!keys.length) {
      $("my-day").textContent = "";
      $("day-meta").textContent = "";
      $("all-queues").textContent = "";
      $("notes-card").hidden = true;
      $("my-day").appendChild(el("p", { class: "hint", text: "Немає даних про графіки." }));
      return;
    }
    renderDay(now);
    renderAll(now);
    renderNotes();
    renderFooter();
  }

  function selectQueue(q) {
    state.queue = q;
    store("queue", q);
    render();
  }

  /* ---------- data ---------- */

  function load() {
    var bust = "?t=" + Math.floor(Date.now() / 60000);
    return Promise.all([
      fetch("data/schedules.json" + bust, { cache: "no-store" }).then(function (r) {
        if (!r.ok) { throw new Error("HTTP " + r.status); }
        return r.json();
      }),
      fetch("data/meta.json" + bust, { cache: "no-store" }).then(function (r) {
        return r.ok ? r.json() : null;
      }).catch(function () { return null; })
    ]).then(function (res) {
      state.data = res[0];
      state.meta = res[1];
      render();
    }).catch(function (err) {
      var box = $("error");
      box.hidden = false;
      box.textContent = "Не вдалося завантажити графіки (" + err.message + "). Спробуйте оновити сторінку або перегляньте джерело: zoe.com.ua/outage.";
    });
  }

  // `?queue=3.2` makes a shareable link; otherwise use the remembered choice.
  var wanted = params.get("queue") || store("queue");
  if (wanted && L.QUEUES.indexOf(wanted) !== -1) { state.queue = wanted; }
  renderPicker();
  load();
  setInterval(render, 30 * 1000);       // keep "now" fresh
  setInterval(load, 5 * 60 * 1000);     // pick up new schedules
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { load(); } });
})();
