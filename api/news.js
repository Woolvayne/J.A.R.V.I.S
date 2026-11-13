// J.A.R.V.I.S – Vercel Function: RSS-Proxy (Browser können RSS meist nicht direkt lesen)
const FEEDS = {
  tagesschau: "https://www.tagesschau.de/xml/rss_2_0",
  bbc: "https://feeds.bbci.co.uk/news/rss.xml",
  heise: "https://www.heise.de/rss/heise.rdf",
  spiegel: "https://www.spiegel.de/schlagzeilen/tops/index.rss",
};

function unCdata(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? unCdata(m[1]) : "";
}

export default async function handler(req, res) {
  const feed = String((req.query && req.query.feed) || "tagesschau");
  const url = FEEDS[feed] || FEEDS.tagesschau;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "JARVIS/2.0 (Vercel)" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const xml = await r.text();
    const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
    const items = blocks.slice(0, 8).map((b) => ({
      title: tag(b, "title"),
      link: tag(b, "link"),
      date: tag(b, "pubDate"),
    })).filter((i) => i.title);
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=120");
    return res.status(200).json({ feed, items });
  } catch (e) {
    return res.status(502).json({ error: "News-Feed nicht erreichbar: " + String(e && e.message || e) });
  }
}
