// TEMPORARY probe on the default (Node.js serverless) runtime. To be deleted.
module.exports = async (req, res) => {
  const t0 = Date.now();
  const out = { runtime: 'node', region: process.env.VERCEL_REGION };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch('https://www.zoe.com.ua/outage/', {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'ShoPoSvitlu/1.0 (+https://github.com/Nibelought/shoposvitlu)' },
    });
    const text = await r.text();
    out.status = r.status; out.bytes = text.length;
    out.articles = (text.match(/<article id="post-/g) || []).length;
  } catch (e) { out.error = String((e && e.name) || e); }
  clearTimeout(timer);
  out.ms = Date.now() - t0;
  res.setHeader('cache-control', 'no-store');
  res.status(200).json(out);
};
