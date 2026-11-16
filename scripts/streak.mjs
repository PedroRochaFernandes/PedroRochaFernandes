// Gera streak.svg com a sequência de contribuições de um usuário do GitHub.
// Uso:
//   GH_TOKEN=xxx GH_USER=seu-usuario node scripts/streak.mjs
//   node scripts/streak.mjs --demo        (dados fictícios, sem rede)
// Variáveis opcionais: OUT (arquivo de saída, padrão streak.svg)

import { writeFileSync } from "node:fs";

const USER = process.env.GH_USER || process.env.GITHUB_REPOSITORY_OWNER;
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const OUT = process.env.OUT || "streak.svg";
const DEMO = process.argv.includes("--demo");

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEKS = 30; // colunas do mapa de calor

// ---------- dados ----------

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "streak-counter",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(`GitHub API: ${res.status} ${JSON.stringify(json.errors || json)}`);
  }
  return json.data;
}

async function fetchDays() {
  if (!USER || !TOKEN) throw new Error("Defina GH_USER e GH_TOKEN (ou use --demo).");

  const { user } = await gql(
    `query($login: String!) { user(login: $login) { contributionsCollection { contributionYears } } }`,
    { login: USER }
  );
  if (!user) throw new Error(`Usuário "${USER}" não encontrado.`);

  // Um alias por ano para buscar todo o histórico numa só requisição.
  const years = user.contributionsCollection.contributionYears;
  const fields = years
    .map(
      (y) => `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") {
        contributionCalendar { weeks { contributionDays { date contributionCount } } }
      }`
    )
    .join("\n");
  const data = await gql(`query($login: String!) { user(login: $login) { ${fields} } }`, { login: USER });

  const map = new Map();
  for (const coll of Object.values(data.user)) {
    for (const w of coll.contributionCalendar.weeks) {
      for (const d of w.contributionDays) map.set(d.date, d.contributionCount);
    }
  }
  return toSortedDays(map);
}

function demoDays() {
  const map = new Map();
  const today = new Date();
  for (let i = 400; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    let n = Math.random() < 0.72 ? Math.floor(Math.random() * 9) + 1 : 0;
    if (i < 23) n = Math.floor(Math.random() * 7) + 1; // sequência atual
    if (i === 23) n = 0;
    if (i > 120 && i < 168) n = Math.floor(Math.random() * 10) + 1; // maior sequência
    map.set(key, n);
  }
  return toSortedDays(map);
}

function toSortedDays(map) {
  const todayUTC = new Date().toISOString().slice(0, 10);
  return [...map.entries()]
    .filter(([date]) => date <= todayUTC)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, count]) => ({ date, count }));
}

// ---------- estatísticas ----------

function computeStats(days) {
  const total = days.reduce((s, d) => s + d.count, 0);

  // Maior sequência
  let longest = { len: 0, start: null, end: null };
  let run = 0;
  let runStart = null;
  for (const d of days) {
    if (d.count > 0) {
      if (run === 0) runStart = d.date;
      run++;
      if (run > longest.len) longest = { len: run, start: runStart, end: d.date };
    } else {
      run = 0;
    }
  }

  // Sequência atual: se hoje ainda não tem contribuição, o dia não quebra a sequência.
  let i = days.length - 1;
  if (i >= 0 && days[i].count === 0) i--;
  let current = { len: 0, start: null, end: null };
  if (i >= 0 && days[i].count > 0) {
    current.end = days[i].date;
    while (i >= 0 && days[i].count > 0) {
      current.len++;
      current.start = days[i].date;
      i--;
    }
  }

  const last30 = days.slice(-30);
  const active30 = last30.filter((d) => d.count > 0).length;
  const first = days.find((d) => d.count > 0)?.date ?? null;

  return { total, longest, current, active30, first };
}

// ---------- SVG ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtNum = (n) => n.toLocaleString("pt-BR");
function fmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MESES[m - 1]} ${y}`;
}
function fmtRange(r) {
  if (!r.start) return "comece hoje!";
  if (r.start === r.end) return fmtDate(r.start);
  const [ys] = r.start.split("-");
  const [ye] = r.end.split("-");
  const a = fmtDate(r.start);
  return `${ys === ye ? a.replace(` ${ys}`, "") : a} – ${fmtDate(r.end)}`;
}

function heatmap(days, x0, y0) {
  // Últimas N semanas, colunas começando no domingo (como no GitHub).
  const cell = 11;
  const gap = 3;
  const recent = days.slice(-(WEEKS * 7 + 7));
  const lastDow = new Date(recent.at(-1).date + "T00:00:00Z").getUTCDay();
  const visible = recent.slice(-(WEEKS - 1) * 7 - (lastDow + 1));

  const counts = visible.map((d) => d.count).filter((n) => n > 0).sort((a, b) => a - b);
  const q = (p) => counts[Math.floor((counts.length - 1) * p)] ?? 1;
  const t = [q(0.25), q(0.5), q(0.75)];
  const level = (n) => (n === 0 ? 0 : n <= t[0] ? 1 : n <= t[1] ? 2 : n <= t[2] ? 3 : 4);

  let out = "";
  visible.forEach((d, idx) => {
    const col = Math.floor(idx / 7);
    const row = idx % 7;
    const x = x0 + col * (cell + gap);
    const y = y0 + row * (cell + gap);
    out += `<rect class="l${level(d.count)}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2.5"><title>${esc(
      `${fmtDate(d.date)}: ${d.count} contribuiç${d.count === 1 ? "ão" : "ões"}`
    )}</title></rect>`;
  });
  const width = WEEKS * (cell + gap) - gap;
  return { svg: out, width, height: 7 * (cell + gap) - gap };
}

function renderSVG(stats, days, user) {
  const W = 480;
  const P = 24;
  const hm = heatmap(days, (W - (WEEKS * 14 - 3)) / 2, 178);
  const H = 178 + hm.height + 38;
  const alive = stats.current.len > 0;
  const colW = (W - P * 2) / 3;
  const cx = (i) => P + colW * i + colW / 2;

  const stat = (i, value, label, sub, accent) => `
    <g>
      <text x="${cx(i)}" y="112" class="num${accent ? " accent" : ""}" text-anchor="middle">${esc(value)}</text>
      <text x="${cx(i)}" y="136" class="label" text-anchor="middle">${esc(label)}</text>
      <text x="${cx(i)}" y="154" class="sub" text-anchor="middle">${esc(sub)}</text>
    </g>`;

  const flame = `<g transform="translate(${P} 26) scale(1.15)"><path class="flame${alive ? "" : " off"}" d="M9 0c1 4-1 6-3 8.5C4.2 10.8 3 12.8 3 15.2 3 19 6 22 10 22s7-3 7-6.8c0-2.6-1.2-4.6-2.6-6.2.1 1.7-.6 3.2-2 3.7.4-4.7-1.4-9.6-3.4-12.7z"/></g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
  <title id="t">Sequência de contribuições de ${esc(user)}</title>
  <desc id="d">Sequência atual: ${stats.current.len} dias. Maior sequência: ${stats.longest.len} dias. Total: ${stats.total} contribuições.</desc>
  <style>
    :root { --bg:#ffffff; --border:#d0d7de; --fg:#1f2328; --muted:#656d76; --accent:#e8590c; --flame:#fd7e14;
            --l0:#ebedf0; --l1:#ffd8a8; --l2:#ffa94d; --l3:#f76707; --l4:#c2410c; }
    @media (prefers-color-scheme: dark) {
      :root { --bg:#0d1117; --border:#30363d; --fg:#e6edf3; --muted:#8d96a0; --accent:#ff922b; --flame:#ff922b;
              --l0:#161b22; --l1:#4a2a12; --l2:#8a4513; --l3:#d9620f; --l4:#ff922b; }
    }
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: var(--fg); }
    .card { fill: var(--bg); stroke: var(--border); }
    .title { font-size: 16px; font-weight: 600; }
    .handle { font-size: 12px; fill: var(--muted); }
    .num { font-size: 30px; font-weight: 700; }
    .accent { fill: var(--accent); }
    .label { font-size: 12.5px; font-weight: 600; }
    .sub { font-size: 11px; fill: var(--muted); }
    .foot { font-size: 11px; fill: var(--muted); }
    .flame { fill: var(--flame); transform-box: fill-box; transform-origin: 50% 100%; animation: flick 2.4s ease-in-out infinite; }
    .flame.off { fill: var(--muted); opacity: .5; animation: none; }
    .divider { stroke: var(--border); }
    .l0 { fill: var(--l0); } .l1 { fill: var(--l1); } .l2 { fill: var(--l2); } .l3 { fill: var(--l3); } .l4 { fill: var(--l4); }
    @keyframes flick { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06, .95); } }
    @media (prefers-reduced-motion: reduce) { .flame { animation: none; } }
  </style>
  <rect class="card" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10"/>
  ${flame}
  <text x="${P + 30}" y="40" class="title">Sequência de estudos</text>
  <text x="${P + 30}" y="57" class="handle">@${esc(user)} · aprendendo e programando todo dia</text>
  ${stat(0, fmtNum(stats.current.len), "Sequência atual", fmtRange(stats.current), true)}
  ${stat(1, fmtNum(stats.longest.len), "Maior sequência", fmtRange(stats.longest), false)}
  ${stat(2, fmtNum(stats.total), "Contribuições", stats.first ? `desde ${fmtDate(stats.first)}` : "—", false)}
  <line class="divider" x1="${P + colW}" y1="88" x2="${P + colW}" y2="156"/>
  <line class="divider" x1="${P + colW * 2}" y1="88" x2="${P + colW * 2}" y2="156"/>
  ${hm.svg}
  <text x="${P}" y="${H - 14}" class="foot">${stats.active30} de 30 dias ativos no último mês</text>
  <g transform="translate(${W - P - 5 * 14 - 62} ${H - 24})">
    <text x="0" y="10" class="foot">menos</text>
    ${[0, 1, 2, 3, 4].map((l) => `<rect class="l${l}" x="${36 + l * 14}" y="0" width="11" height="11" rx="2.5"/>`).join("")}
    <text x="${36 + 5 * 14 + 2}" y="10" class="foot">mais</text>
  </g>
</svg>
`;
}

// ---------- main ----------

const days = DEMO ? demoDays() : await fetchDays();
if (!days.length) throw new Error("Nenhum dado de contribuição encontrado.");
const stats = computeStats(days);
writeFileSync(OUT, renderSVG(stats, days, DEMO ? "seu-usuario" : USER));
console.log(
  `${OUT} gerado · atual: ${stats.current.len} · maior: ${stats.longest.len} · total: ${stats.total}`
);
