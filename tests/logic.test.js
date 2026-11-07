const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const day = (queues) => ({ queues });

test("parseInterval handles 24:00 and rejects junk", () => {
  assert.deepEqual(L.parseInterval("22:30-24:00"), [1350, 1440]);
  assert.equal(L.parseInterval("10:00-09:00"), null);
  assert.equal(L.parseInterval("nope"), null);
});

test("addDays crosses month and year boundaries", () => {
  assert.equal(L.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(L.addDays("2026-03-01", -1), "2026-02-28");
});

test("kyivNow uses Europe/Kyiv incl. DST", () => {
  assert.deepEqual(L.kyivNow(new Date("2026-11-07T10:00:00Z")), { key: "2026-11-07", minutes: 12 * 60 });
  assert.deepEqual(L.kyivNow(new Date("2026-07-01T12:00:00Z")), { key: "2026-07-01", minutes: 15 * 60 });
  // 22:30Z on 6 Nov is already 00:30 on 7 Nov in Kyiv
  assert.deepEqual(L.kyivNow(new Date("2026-11-06T22:30:00Z")), { key: "2026-11-07", minutes: 30 });
});

test("status: off inside an interval, until its end", () => {
  const days = { "2026-11-07": day({ "1.1": ["06:00-11:00"] }) };
  const s = L.getStatus(days, "2026-11-07", 7 * 60, "1.1");
  assert.equal(s.state, "off");
  assert.equal(s.until, 11 * 60);
});

test("status: end boundary is exclusive, start boundary inclusive", () => {
  const days = { "2026-11-07": day({ "1.1": ["06:00-11:00"] }) };
  assert.equal(L.getStatus(days, "2026-11-07", 11 * 60, "1.1").state, "on");
  assert.equal(L.getStatus(days, "2026-11-07", 6 * 60, "1.1").state, "off");
});

test("status: on, next outage start", () => {
  const days = { "2026-11-07": day({ "1.1": ["06:00-11:00", "15:00-20:00"] }) };
  const s = L.getStatus(days, "2026-11-07", 12 * 60, "1.1");
  assert.equal(s.state, "on");
  assert.equal(s.until, 15 * 60);
});

test("status: outage continues past midnight into tomorrow", () => {
  const days = {
    "2026-11-07": day({ "2.2": ["22:30-24:00"] }),
    "2026-11-08": day({ "2.2": ["00:00-02:00"] }),
  };
  const s = L.getStatus(days, "2026-11-07", 23 * 60, "2.2");
  assert.equal(s.state, "off");
  assert.equal(s.until, 1440 + 120);
  assert.equal(L.fmtTime(s.until), "02:00 (завтра)");
});

test("status: tomorrow unknown keeps 24:00 and flags it", () => {
  const days = { "2026-11-07": day({ "2.2": ["22:30-24:00"] }) };
  const s = L.getStatus(days, "2026-11-07", 23 * 60, "2.2");
  assert.equal(s.until, 1440);
  assert.equal(s.tomorrowKnown, false);
  assert.equal(L.fmtTime(1440), "24:00");
});

test("status: next outage can be tomorrow", () => {
  const days = {
    "2026-11-07": day({ "3.1": ["01:00-02:00"] }),
    "2026-11-08": day({ "3.1": ["04:30-09:30"] }),
  };
  const s = L.getStatus(days, "2026-11-07", 20 * 60, "3.1");
  assert.equal(s.state, "on");
  assert.equal(s.until, 1440 + 270);
});

test("status: no data for today", () => {
  assert.equal(L.getStatus({ "2026-11-06": day({}) }, "2026-11-07", 100, "1.1").state, "nodata");
});

test("status: queue absent from schedule means power on, no next outage", () => {
  const days = { "2026-11-07": day({ "1.2": ["12:00-16:00"] }) };
  const s = L.getStatus(days, "2026-11-07", 600, "1.1");
  assert.equal(s.state, "on");
  assert.equal(s.until, null);
});

test("formatting", () => {
  assert.equal(L.fmtDuration(90), "1 год 30 хв");
  assert.equal(L.fmtDuration(300), "5 год");
  assert.equal(L.fmtDuration(45), "45 хв");
  assert.equal(L.totalMinutes([[0, 120], [360, 660]]), 420);
  assert.equal(L.dayLabel("2026-11-07", "2026-11-07"), "Сьогодні");
  assert.equal(L.dayLabel("2026-11-08", "2026-11-07"), "Завтра");
  assert.equal(L.dayLabel("2026-11-03", "2026-11-07"), "вт, 3 лист.");
});
