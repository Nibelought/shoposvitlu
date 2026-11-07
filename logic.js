/* Pure schedule logic (no DOM) - shared by the page and the node tests. */
(function (g) {
  "use strict";

  var QUEUES = [];
  for (var n = 1; n <= 6; n++) { QUEUES.push(n + ".1", n + ".2"); }

  var MONTHS = ["січ.", "лют.", "бер.", "квіт.", "трав.", "черв.", "лип.", "серп.", "вер.", "жовт.", "лист.", "груд."];
  var WEEKDAYS = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"];

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /** "HH:MM-HH:MM" -> [startMin, endMin]; "24:00" -> 1440. */
  function parseInterval(s) {
    var m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) { return null; }
    var a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
    return b > a ? [a, Math.min(b, 1440)] : null;
  }

  function dayIntervals(day, queue) {
    if (!day || !day.queues) { return []; }
    return (day.queues[queue] || []).map(parseInterval).filter(Boolean)
      .sort(function (x, y) { return x[0] - y[0]; });
  }

  function addDays(key, delta) {
    var p = key.split("-");
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + delta));
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }

  /** Current date (YYYY-MM-DD) and minutes since midnight in Kyiv. */
  function kyivNow(date) {
    var parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Kyiv", hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
    }).formatToParts(date || new Date());
    var v = {};
    parts.forEach(function (p) { v[p.type] = p.value; });
    return { key: v.year + "-" + v.month + "-" + v.day, minutes: +v.hour * 60 + +v.minute };
  }

  /** Intervals of `todayKey` (+ tomorrow, offset by 1440), adjacent ones merged across midnight. */
  function upcoming(days, todayKey, queue) {
    var out = dayIntervals(days[todayKey], queue);
    var tomorrow = days[addDays(todayKey, 1)];
    if (tomorrow) {
      dayIntervals(tomorrow, queue).forEach(function (iv) { out.push([iv[0] + 1440, iv[1] + 1440]); });
    }
    var merged = [];
    out.forEach(function (iv) {
      var last = merged[merged.length - 1];
      if (last && iv[0] <= last[1]) { last[1] = Math.max(last[1], iv[1]); } else { merged.push([iv[0], iv[1]]); }
    });
    return merged;
  }

  /**
   * Status of a queue right now.
   * -> { state: "nodata" | "on" | "off", until: absoluteMinutes|null, tomorrowKnown: bool }
   * `until` is when the state changes (minutes from today 00:00, >1440 = tomorrow).
   */
  function getStatus(days, todayKey, nowMin, queue) {
    if (!days[todayKey]) { return { state: "nodata", until: null, tomorrowKnown: false }; }
    var tomorrowKnown = !!days[addDays(todayKey, 1)];
    var list = upcoming(days, todayKey, queue);
    for (var i = 0; i < list.length; i++) {
      var iv = list[i];
      if (nowMin >= iv[0] && nowMin < iv[1]) { return { state: "off", until: iv[1], tomorrowKnown: tomorrowKnown }; }
      if (iv[0] > nowMin) { return { state: "on", until: iv[0], tomorrowKnown: tomorrowKnown }; }
    }
    return { state: "on", until: null, tomorrowKnown: tomorrowKnown };
  }

  /** Absolute minutes -> "HH:MM", with "(завтра)" past midnight. 1440 stays "24:00". */
  function fmtTime(abs) {
    if (abs > 1440) { return pad(Math.floor((abs - 1440) / 60)) + ":" + pad((abs - 1440) % 60) + " (завтра)"; }
    return pad(Math.floor(abs / 60)) + ":" + pad(abs % 60);
  }

  function fmtDuration(min) {
    var h = Math.floor(min / 60), m = min % 60;
    if (h && m) { return h + " год " + m + " хв"; }
    return h ? h + " год" : m + " хв";
  }

  function totalMinutes(intervals) {
    return intervals.reduce(function (s, iv) { return s + (iv[1] - iv[0]); }, 0);
  }

  function dayLabel(key, todayKey) {
    if (key === addDays(todayKey, 0)) { return "Сьогодні"; }
    if (key === addDays(todayKey, 1)) { return "Завтра"; }
    if (key === addDays(todayKey, -1)) { return "Вчора"; }
    var p = key.split("-");
    var wd = WEEKDAYS[new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay()];
    return wd + ", " + +p[2] + " " + MONTHS[+p[1] - 1];
  }

  g.Logic = {
    QUEUES: QUEUES, parseInterval: parseInterval, dayIntervals: dayIntervals, addDays: addDays,
    kyivNow: kyivNow, upcoming: upcoming, getStatus: getStatus, fmtTime: fmtTime,
    fmtDuration: fmtDuration, totalMinutes: totalMinutes, dayLabel: dayLabel, MONTHS: MONTHS
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = g.Logic; }
})(typeof window !== "undefined" ? window : globalThis);
