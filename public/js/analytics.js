// Impact analytics: views over time for one article, with a marker at every
// update. The page is a shell - everything comes from /api/analytics.

// the chart's colours come from the tokens in main.css, so it matches the site
const readToken = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const SERIES_COLOR = readToken('--primary')
const SERIES_FILL = readToken('--ring')
const INK = readToken('--muted')
const GRID = readToken('--line')
const MARKER = readToken('--brand')
if (window.Chart) Chart.defaults.font.family = readToken('--sans')

const $ = id => document.getElementById(id)

const params = new URLSearchParams(location.search)
const state = {
  articleId: params.get('article'),
  range: params.get('range') || 'all',
  data: null
}
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
let chart = null

// --- formatting ---

const formatNumber = n => n.toLocaleString('en-US')
const dateTime = new Intl.DateTimeFormat('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const dateOnly = new Intl.DateTimeFormat('en-GB', { month: 'short', day: 'numeric' })
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

const INTERVAL_NAMES = { '5m': '5 minutes', '1h': 'hour', '1d': 'day' }

function formatBin(ms) {
  if (state.data.interval === '1d') return dateOnly.format(ms)
  return dateTime.format(ms)
}

function formatChange(change) {
  if (change === null) return '-'
  const pct = Math.round(change * 100)
  if (pct === 0) return '0%'
  return (pct > 0 ? '▲ +' : '▼ ') + pct + '%'
}

// --- fetching ---

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (res.status === 401) {
    location.href = '/login'
    return null
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Could not load analytics')
  return body
}

// --- the article picker ---

let searchTimer = null
let listRequest = 0
const picker = { q: '', loaded: 0, hasMore: false, loading: false, ids: new Set() }

function renderItem(article) {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.id = article.id
  if (article.id === state.articleId) button.setAttribute('aria-current', 'true')

  const title = document.createElement('span')
  title.className = 'an-item-title'
  title.textContent = article.title
  const meta = document.createElement('span')
  meta.className = 'muted'
  meta.textContent = `${formatNumber(article.viewCount)} views · ${article.updates} update${article.updates === 1 ? '' : 's'}`

  button.append(title, meta)
  const item = document.createElement('li')
  item.append(button)
  return item
}

// A new search starts the list over; scrolling to the end appends the next
// page. Same pattern as the public feed (public/js/feed.js).
async function loadList(q = picker.q, { append = false } = {}) {
  if (append && (picker.loading || !picker.hasMore)) return

  // a slow answer to an old search must not overwrite a newer one
  const mine = ++listRequest
  picker.loading = true
  const skip = append ? picker.loaded : 0

  let body
  try {
    body = await getJson(`/api/analytics/articles?q=${encodeURIComponent(q)}&skip=${skip}`)
  } finally {
    if (mine === listRequest) picker.loading = false
  }
  if (!body || mine !== listRequest) return

  if (!append) {
    picker.q = q
    picker.ids.clear()
    $('an-scroll').scrollTop = 0
  }
  picker.loaded = skip + body.articles.length
  picker.hasMore = body.hasMore

  // the rollup can move an article up into a page we already have while we
  // scroll, so it would come back a second time - skip it
  const fresh = body.articles.filter(article => !picker.ids.has(article.id))
  fresh.forEach(article => picker.ids.add(article.id))
  const items = fresh.map(renderItem)
  if (append) $('an-list').append(...items)
  else $('an-list').replaceChildren(...items)

  const total = formatNumber(body.total)
  $('an-list-hint').textContent = picker.q
    ? `${total} matching`
    : `Most read first · ${total} articles`
  $('an-more').hidden = !picker.hasMore
  recheckSentinel()

  // first visit: show the most read article instead of an empty panel
  if (!append && !state.articleId && body.articles.length) selectArticle(body.articles[0].id)
  if (!append && !body.articles.length && !state.articleId) setStatus('No published articles yet.')
}

function loadMore() {
  loadList(picker.q, { append: true }).catch(err => setStatus(err.message))
}

// the scroll box is the root, not the page - the list scrolls inside it.
// 200px early so the next page is usually there before the reader gets to it
const observer = 'IntersectionObserver' in window && new IntersectionObserver(entries => {
  if (entries.some(entry => entry.isIntersecting)) loadMore()
}, { root: $('an-scroll'), rootMargin: '0px 0px 200px 0px' })
if (observer) observer.observe($('an-sentinel'))

// The observer only fires when the sentinel's visibility changes. If a page
// was too short to push it out of view it never changes, so look again.
function recheckSentinel() {
  if (!observer || !picker.hasMore) return
  observer.unobserve($('an-sentinel'))
  observer.observe($('an-sentinel'))
}

function selectArticle(id) {
  state.articleId = id
  for (const button of $('an-list').querySelectorAll('button')) {
    button.toggleAttribute('aria-current', button.dataset.id === id)
  }
  loadArticle()
}

// --- one article ---

function setStatus(text) {
  $('an-status').textContent = text
  $('an-status').hidden = !text
}

async function loadArticle() {
  // the url is shareable: an editor can send a link to this exact graph
  const url = new URL(location.href)
  url.searchParams.set('article', state.articleId)
  url.searchParams.set('range', state.range)
  history.replaceState(null, '', url)

  for (const button of document.querySelectorAll('[data-range]')) {
    button.setAttribute('aria-pressed', button.dataset.range === state.range)
  }

  setStatus('Loading…')
  try {
    const query = new URLSearchParams({ range: state.range, tz: timeZone })
    const data = await getJson(`/api/analytics/article/${state.articleId}?${query}`)
    if (!data) return
    state.data = data
    render(data)
    setStatus('')
  } catch (err) {
    $('an-content').hidden = true
    setStatus(err.message)
  }
}

function render(data) {
  $('an-content').hidden = false
  $('an-title').textContent = data.article.title
  $('an-open').href = '/article/' + data.article.id
  $('an-open').hidden = !data.article.isLive

  // the tile and caption describe what is on the graph, the table keeps all
  const from = new Date(data.from)
  const updates = data.updates.filter(update => update.kind === 'update' && new Date(update.at) >= from)
  $('an-total').textContent = formatNumber(data.total)
  $('an-updates').textContent = formatNumber(updates.length)

  const peak = data.points.reduce((best, point) => (point.y > best.y ? point : best), { y: 0 })
  $('an-peak-label').textContent = 'Busiest ' + INTERVAL_NAMES[data.interval]
  $('an-peak').textContent = peak.y ? `${formatNumber(peak.y)} · ${formatBin(peak.x)}` : '-'

  const caption = `Views per ${INTERVAL_NAMES[data.interval]}, ${dateOnly.format(new Date(data.from))} to ${dateOnly.format(new Date(data.to))}`
  $('an-caption').textContent = caption +
    (updates.length ? `, with ${updates.length} update${updates.length === 1 ? '' : 's'} marked.` : '.')

  renderImpact(data.updates)
  renderChart(data)
}

function renderImpact(updates) {
  const rows = updates.filter(update => update.kind === 'update')
  const body = $('an-impact')

  if (!rows.length) {
    const cell = document.createElement('td')
    cell.colSpan = 6
    cell.className = 'muted'
    cell.textContent = 'No updates since this article was published.'
    const row = document.createElement('tr')
    row.append(cell)
    return body.replaceChildren(row)
  }

  body.replaceChildren(...rows.map(update => {
    const impact = update.impact
    const cells = [
      update.label,
      dateTime.format(new Date(update.at)),
      update.editor || '-',
      impact ? formatNumber(impact.before) : '-',
      impact ? formatNumber(impact.after) : '-',
      impact ? formatChange(impact.change) : 'Too close to compare'
    ]
    const row = document.createElement('tr')
    cells.forEach((text, i) => {
      const cell = document.createElement('td')
      cell.textContent = text
      if (i >= 3) cell.className = 'num'
      if (i === 5 && impact) cell.title = `${impact.windowHours} hours either side`
      row.append(cell)
    })
    return row
  }))
}

// --- the chart ---

// Chart.js has no "event on the x axis" mark of its own. This draws one
// dashed line per update, numbered to match the table, plus the hairline that
// follows the pointer so the reader can line a point up with a marker.
const updateMarkers = {
  id: 'updateMarkers',
  afterDatasetsDraw(c, args, options) {
    const { ctx, chartArea: area, scales: { x } } = c
    ctx.save()

    options.markers.forEach(marker => {
      const px = x.getPixelForValue(marker.x)
      if (px < area.left || px > area.right) return

      ctx.strokeStyle = MARKER
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(px, area.top)
      ctx.lineTo(px, area.bottom)
      ctx.stroke()

      ctx.setLineDash([])
      ctx.fillStyle = MARKER
      ctx.font = `600 11px ${readToken('--sans')}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText(marker.short, px, area.top - 3)
    })

    const active = c.tooltip && c.tooltip.getActiveElements()
    if (active && active.length) {
      const px = active[0].element.x
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(px, area.top)
      ctx.lineTo(px, area.bottom)
      ctx.stroke()
    }

    ctx.restore()
  }
}

function buildMarkers(data) {
  let n = 0
  return data.updates.map(update => ({
    x: new Date(update.at).getTime(),
    label: update.label,
    short: update.kind === 'first' ? 'P' : String(++n)
  }))
}

// The x axis is a plain number axis in milliseconds rather than a Chart.js
// time axis, so no date library is needed - the tick labels format the dates.
function renderChart(data) {
  const markers = buildMarkers(data)
  const from = new Date(data.from).getTime()
  const to = new Date(data.to).getTime()

  const config = {
    type: 'line',
    data: {
      datasets: [{
        label: 'Views',
        data: data.points,
        borderColor: SERIES_COLOR,
        backgroundColor: SERIES_FILL,
        fill: true,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: SERIES_COLOR,
        tension: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      layout: { padding: { top: 18 } },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'linear',
          min: from,
          max: to,
          grid: { display: false },
          border: { color: GRID },
          ticks: {
            color: INK,
            maxTicksLimit: 7,
            maxRotation: 0,
            callback: value => (data.interval === '5m' ? timeOnly : dateOnly).format(value)
          }
        },
        y: {
          beginAtZero: true,
          grid: { color: GRID },
          border: { display: false },
          ticks: { color: INK, precision: 0, maxTicksLimit: 6, callback: value => formatNumber(value) }
        }
      },
      plugins: {
        legend: { display: false },   // one series - the caption names it
        updateMarkers: { markers },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: items => formatBin(items[0].parsed.x),
            label: item => `${formatNumber(item.parsed.y)} views`,
            // say so when the point the reader is on contains an update
            footer: items => {
              const start = items[0].parsed.x
              return markers
                .filter(marker => marker.x >= start && marker.x < start + data.intervalMs)
                .map(marker => `${marker.label} published ${timeOnly.format(marker.x)}`)
            }
          }
        }
      }
    },
    plugins: [updateMarkers]
  }

  if (chart) chart.destroy()
  chart = new Chart($('views-chart'), config)
}

// --- wiring ---

$('an-search').addEventListener('input', event => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadList(event.target.value).catch(err => setStatus(err.message)), 250)
})

$('an-more').addEventListener('click', loadMore)

$('an-list').addEventListener('click', event => {
  const button = event.target.closest('button[data-id]')
  if (button) selectArticle(button.dataset.id)
})

for (const button of document.querySelectorAll('[data-range]')) {
  button.addEventListener('click', () => {
    state.range = button.dataset.range
    if (state.articleId) loadArticle()
  })
}

if (state.articleId) loadArticle()
loadList().catch(err => setStatus(err.message))
