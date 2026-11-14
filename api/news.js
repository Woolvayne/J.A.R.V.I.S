// J.A.R.V.I.S – Vercel Function: RSS proxy (browsers usually cannot read RSS directly)
const FEEDS = {
  bbc: "https://feeds.bbci.co.uk/news/rss.xml",
  guardian: "https://www.theguardian.com/world/rss",
  npr: "https://feeds.npr.org/1001/rss.xml",
  sky: "https://feeds.skynews.com/feeds/rss/home.xml",
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
  const feed = String((req.query && req.query.feed) || "bbc");
  const url = FEEDS[feed] || FEEDS.bbc;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "JARVIS/3.0 (Vercel)" } });
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
    return res.status(502).json({ error: "News feed unreachable: " + String(e && e.message || e) });
  }
}
