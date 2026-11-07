export const config = { runtime: 'edge', regions: ['arn1'] };

// TEMPORARY probe: can this region reach zoe.com.ua? (to be deleted)
export default async function handler(request) {
  const t0 = Date.now();
  const out = { requested: 'arn1', vercelId: request.headers.get('x-vercel-id') };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch('https://www.zoe.com.ua/outage/', {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'ShoPoSvitlu/1.0 (+https://github.com/Nibelought/shoposvitlu)' },
    });
    const text = await r.text();
    out.status = r.status;
    out.bytes = text.length;
    out.articles = (text.match(/<article id="post-/g) || []).length;
    out.server = r.headers.get('server');
  } catch (e) {
    out.error = String((e && e.name) || e);
  }
  clearTimeout(timer);
  out.ms = Date.now() - t0;
  return new Response(JSON.stringify(out), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
