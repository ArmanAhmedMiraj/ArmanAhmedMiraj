// Rebuilds the live parts of this profile from real GitHub data: assets/stats.svg and the marked sections of README.md.
// Runs daily in GitHub Actions (see .github/workflows/update.yml). No packages needed (Node 20+).
// Local test without a token:  MOCK=1 node scripts/update-profile.mjs
import { readFileSync, writeFileSync } from "node:fs";

const LOGIN = process.env.GH_LOGIN || "ArmanAhmedMiraj";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const MOCK = process.env.MOCK === "1";
const TZ = "Asia/Dhaka";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ymd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const when = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

async function gql(query, variables) {
  const r = await fetch("https://api.github.com/graphql", { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "user-agent": "profile-readme" }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error(JSON.stringify(j.errors || j).slice(0, 300));
  return j.data;
}
async function rest(path) {
  const r = await fetch(`https://api.github.com${path}`, { headers: { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json", "user-agent": "profile-readme" } });
  return r.ok ? r.json() : [];
}

function mockData() {
  const days = [];
  const today = new Date();
  for (let i = 364; i >= 0; i--) { const d = new Date(today.getTime() - i * 864e5); days.push({ date: ymd(d), contributionCount: i % 9 === 0 ? 0 : (i * 7) % 6 }); }
  return {
    user: { followers: { totalCount: 12 }, repositories: { totalCount: 14, nodes: [
      { name: "EarthEcho", description: "Bilingual farm planner that turns open satellite data into plain-language advice", url: "https://github.com/ArmanAhmedMiraj/EarthEcho", stargazerCount: 3, pushedAt: new Date().toISOString(), primaryLanguage: { name: "JavaScript" }, languages: { edges: [{ size: 900000, node: { name: "JavaScript", color: "#f1e05a" } }, { size: 90000, node: { name: "CSS", color: "#663399" } }, { size: 40000, node: { name: "Python", color: "#3572A5" } }] } },
      { name: "VendorMapSaaS", description: "Vendor map SaaS", url: "https://github.com/ArmanAhmedMiraj/VendorMapSaaS", stargazerCount: 1, pushedAt: new Date(Date.now() - 6e8).toISOString(), primaryLanguage: { name: "TypeScript" }, languages: { edges: [{ size: 300000, node: { name: "TypeScript", color: "#3178c6" } }, { size: 200000, node: { name: "Python", color: "#3572A5" } }] } },
    ] },
    contributionsCollection: { totalCommitContributions: 412, totalPullRequestContributions: 6, restrictedContributionsCount: 0, contributionCalendar: { totalContributions: 520, weeks: [{ contributionDays: days }] } } },
    commits: [
      { repo: "EarthEcho", message: "Add MCP server for the knowledge base and AGENTS.md", date: new Date(Date.now() - 36e5 * 3).toISOString(), url: "#" },
      { repo: "EarthEcho", message: "Add corrective retrieval: grade matches and retry with the plot's crop", date: new Date(Date.now() - 36e5 * 9).toISOString(), url: "#" },
    ],
  };
}

async function load() {
  if (MOCK) return mockData();
  if (!TOKEN) throw new Error("GITHUB_TOKEN is missing");
  const to = new Date(), from = new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
  const data = await gql(`query($login:String!,$from:DateTime!,$to:DateTime!){ user(login:$login){ followers{totalCount}
    repositories(ownerAffiliations:OWNER,isFork:false,privacy:PUBLIC,first:100,orderBy:{field:PUSHED_AT,direction:DESC}){ totalCount nodes{ name description url stargazerCount pushedAt primaryLanguage{name} languages(first:6,orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name color } } } } }
    contributionsCollection(from:$from,to:$to){ totalCommitContributions totalPullRequestContributions restrictedContributionsCount contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } } } } }`,
    { login: LOGIN, from: from.toISOString(), to: to.toISOString() });
  const commits = [];
  for (const repo of data.user.repositories.nodes.slice(0, 4)) {
    const list = await rest(`/repos/${LOGIN}/${repo.name}/commits?author=${LOGIN}&per_page=4`);
    for (const c of Array.isArray(list) ? list : []) commits.push({ repo: repo.name, message: String(c.commit.message).split("\n")[0], date: c.commit.author.date, url: c.html_url });
  }
  commits.sort((a, b) => new Date(b.date) - new Date(a.date));
  return { user: data.user, commits };
}

function compute({ user, commits }) {
  const cc = user.contributionsCollection;
  const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays).sort((a, b) => a.date.localeCompare(b.date));
  const today = ymd(new Date());
  const upToday = days.filter((d) => d.date <= today);
  const last30 = upToday.slice(-30);
  let streak = 0, i = upToday.length - 1;
  if (i >= 0 && upToday[i].contributionCount === 0) i--; // today may not have a commit yet
  for (; i >= 0 && upToday[i].contributionCount > 0; i--) streak++;
  let best = 0, run = 0;
  for (const d of upToday) { run = d.contributionCount > 0 ? run + 1 : 0; best = Math.max(best, run); }
  const langs = new Map();
  for (const r of user.repositories.nodes) for (const e of r.languages.edges) { const o = langs.get(e.node.name) || { size: 0, color: e.node.color || "#8b949e" }; o.size += e.size; langs.set(e.node.name, o); }
  const total = [...langs.values()].reduce((s, l) => s + l.size, 0) || 1;
  const topLangs = [...langs.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6).map(([name, l]) => ({ name, color: l.color, pct: (l.size / total) * 100 }));
  const stars = user.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);
  return { commitsYear: cc.totalCommitContributions + cc.restrictedContributionsCount, contribYear: cc.contributionCalendar.totalContributions, prs: cc.totalPullRequestContributions, last30, last30Total: last30.reduce((s, d) => s + d.contributionCount, 0), todayCount: (upToday.at(-1) || {}).contributionCount || 0, streak, best, topLangs, repos: user.repositories.totalCount, stars, followers: user.followers.totalCount, commits: commits.slice(0, 6), repoList: user.repositories.nodes.slice(0, 6) };
}

function statsSvg(s, stamp) {
  const W = 840, H = 420;
  const tile = (x, label, value, sub, color) => `<g transform="translate(${x},70)"><rect width="190" height="92" rx="14" fill="#101a35" stroke="#24335f"/><text x="16" y="28" class="m">${esc(label)}</text><text x="16" y="62" class="v" fill="${color}">${esc(value)}</text><text x="16" y="82" class="m s">${esc(sub)}</text></g>`;
  const max = Math.max(1, ...s.last30.map((d) => d.contributionCount));
  const bars = s.last30.map((d, i) => { const h = Math.round((d.contributionCount / max) * 80); return `<rect x="${i * 24}" y="${80 - h}" width="17" height="${Math.max(h, 3)}" rx="4" fill="${d.contributionCount ? "#5eead4" : "#24335f"}"><title>${esc(d.date)}: ${d.contributionCount}</title></rect>`; }).join("");
  let x = 0;
  const seg = s.topLangs.map((l) => { const w = (l.pct / 100) * 780; const r = `<rect x="${x}" y="0" width="${Math.max(w, 2)}" height="12" fill="${esc(l.color)}"/>`; x += w; return r; }).join("");
  const legend = s.topLangs.map((l, i) => `<g transform="translate(${(i % 3) * 260},${Math.floor(i / 3) * 22 + 34})"><circle cx="6" cy="6" r="6" fill="${esc(l.color)}"/><text x="20" y="10" class="m">${esc(l.name)} ${l.pct.toFixed(1)}%</text></g>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Live GitHub activity">
<style>text{font-family:'Segoe UI',Arial,sans-serif;fill:#eef1ff}.t{font-size:20px;font-weight:700}.m{font-size:12px;fill:#9fb0d9}.s{font-size:11px}.v{font-size:30px;font-weight:700}.pulse{animation:p 2s ease-in-out infinite}@keyframes p{50%{opacity:.35}}</style>
<rect width="${W}" height="${H}" rx="20" fill="#0b1020" stroke="#24335f"/>
<circle cx="30" cy="34" r="6" fill="#5eead4" class="pulse"/><text x="46" y="40" class="t">Live GitHub activity</text><text x="${W - 24}" y="40" text-anchor="end" class="m">Updated ${esc(stamp)} (Dhaka time)</text>
${tile(24, "Commits this year", s.commitsYear, `${s.contribYear} contributions`, "#5eead4")}${tile(226, "Last 30 days", s.last30Total, `${s.todayCount} today`, "#f6c177")}${tile(428, "Current streak", `${s.streak} d`, `best this year ${s.best} d`, "#7fb2ff")}${tile(630, "Public repos", s.repos, `${s.stars} stars · ${s.followers} followers`, "#ff9478")}
<text x="24" y="196" class="m">Daily contributions, last 30 days (hover a bar)</text><g transform="translate(24,206)">${bars}</g>
<text x="24" y="318" class="m">Languages across my public repositories</text><g transform="translate(24,328)"><clipPath id="c"><rect width="780" height="12" rx="6"/></clipPath><g clip-path="url(#c)">${seg}</g>${legend}</g>
</svg>`;
}

const table = (rows, head) => `| ${head.join(" | ")} |\n| ${head.map(() => "---").join(" | ")} |\n${rows.map((r) => `| ${r.join(" | ")} |`).join("\n")}`;
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

function fill(md, key, body) {
  const re = new RegExp(`(<!--${key}_START-->)[\\s\\S]*?(<!--${key}_END-->)`);
  if (!re.test(md)) throw new Error(`marker ${key} missing in README.md`);
  return md.replace(re, `$1\n${body}\n$2`);
}

const s = compute(await load());
const stamp = when(new Date());
writeFileSync("assets/stats.svg", statsSvg(s, stamp));
let md = readFileSync("README.md", "utf8");
md = fill(md, "UPDATED", `<sub>Last refreshed automatically: **${stamp}** (Asia/Dhaka)</sub>`);
md = fill(md, "COMMITS", s.commits.length ? table(s.commits.map((c) => [when(new Date(c.date)), `\`${cell(c.repo)}\``, `[${cell(c.message)}](${c.url})`]), ["When", "Repo", "What changed"]) : "_No public commits yet._");
md = fill(md, "REPOS", table(s.repoList.map((r) => [`**[${cell(r.name)}](${r.url})**`, cell(r.description || "").slice(0, 110), cell((r.primaryLanguage || {}).name || "-"), `⭐ ${r.stargazerCount}`]), ["Repository", "About", "Language", "Stars"]));
writeFileSync("README.md", md);
console.log(`ok: ${s.commitsYear} commits this year, streak ${s.streak}, ${s.repos} repos`);
