// The feed without a page reload. The page is already a working feed before
// this file runs - a real form, real links, real results - so the only job here
// is to take over those same controls and keep the address bar in step.

const form = document.querySelector('.feed-search')
const searchInput = form && form.querySelector('input[name="q"]')
const results = document.getElementById('feed-results')
const statusEl = document.getElementById('feed-status')
const countEl = document.getElementById('feed-count')

if (form && results) {
  // Typing a search fires one request instead of one per keystroke.
  const TYPING_MS = 350

  // The address bar is the only state. A reload, a bookmark and the back button
  // then all mean the same thing without any of it being kept twice.
  function currentState() {
    const params = new URLSearchParams(location.search)
    return {
      q: (params.get('q') || '').trim(),
      category: params.get('category') || '',
      sort: params.get('sort') === 'popular' ? 'popular' : 'date',
      page: Math.max(1, parseInt(params.get('page'), 10) || 1)
    }
  }

  // Defaults are left out so the address stays short and copyable. Mirrors
  // feedLink() in controllers/publicController.js.
  function toQuery(state) {
    const params = new URLSearchParams()
    if (state.q) params.set('q', state.q)
    if (state.category) params.set('category', state.category)
    if (state.sort !== 'date') params.set('sort', state.sort)
    if (state.page > 1) params.set('page', state.page)
    return params.toString()
  }

  function feedHref(state) {
    const query = toQuery(state)
    return query ? `/?${query}` : '/'
  }

  function el(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    // textContent, never innerHTML: a headline is a reporter's text and must
    // not be able to bring markup along with it
    if (text !== undefined) node.textContent = text
    return node
  }

  function stepLink(label, page, rel) {
    const link = el('a', 'feed-step', label)
    link.href = feedHref({ ...currentState(), page })
    link.rel = rel
    link.dataset.feedNav = ''
    link.dataset.page = page
    return link
  }

  // Same as stepLink but wearing the square page-number styling, and with no
  // rel: only Previous and Next are labelled that way.
  function pageLink(page) {
    const link = el('a', 'feed-page', String(page))
    link.href = feedHref({ ...currentState(), page })
    link.dataset.feedNav = ''
    link.dataset.page = page
    return link
  }

  function buildCard(article) {
    const item = el('li', 'feed-card')

    if (article.imagePath) {
      const link = el('a', 'feed-thumb')
      link.href = `/article/${article.id}`
      link.tabIndex = -1
      link.setAttribute('aria-hidden', 'true')

      const img = el('img')
      img.src = article.imagePath
      img.alt = ''
      img.loading = 'lazy'
      img.width = 160
      img.height = 107
      link.append(img)
      item.append(link)
    }

    const body = el('div', 'feed-card-body')

    const title = el('a', 'feed-card-title', article.title)
    title.href = `/article/${article.id}`
    body.append(title)

    if (article.summary) body.append(el('p', 'feed-summary', article.summary))

    const meta = el('div', 'feed-meta')

    const category = el('a', 'feed-category', article.categoryLabel)
    category.href = feedHref({ ...currentState(), category: article.category, page: 1 })
    category.dataset.feedNav = ''
    category.dataset.category = article.category
    meta.append(category)

    meta.append(el('span', null, article.authorName))

    const time = el('time', null, new Date(article.publishedAt).toLocaleDateString())
    time.dateTime = article.publishedAt
    meta.append(time)

    body.append(meta)
    item.append(body)
    return item
  }

  // Copy of pageWindow in controllers/publicController.js. A browser cannot
  // require the controller, so the same window is worked out again here. If one
  // of the two changes, the other has to change with it.
  function pageWindow(current, pages, span = 2) {
    const wanted = new Set([1, pages])
    for (let page = current - span; page <= current + span; page++) {
      if (page >= 1 && page <= pages) wanted.add(page)
    }

    const entries = []
    let previous = 0

    for (const page of [...wanted].sort((a, b) => a - b)) {
      if (page - previous > 1) entries.push({ gap: true })
      entries.push({ page })
      previous = page
    }

    return entries
  }

  function buildPager(feed) {
    const nav = el('nav', 'feed-pager')
    nav.setAttribute('aria-label', 'Pages')

    const numbers = el('div', 'feed-pages')
    for (const entry of pageWindow(feed.page, feed.pages)) {
      if (entry.gap) {
        // stands in for pages that are not shown, so it is not clickable
        const gap = el('span', 'feed-page-gap', '…')
        gap.setAttribute('aria-hidden', 'true')
        numbers.append(gap)
      } else if (entry.page === feed.page) {
        // the reader is already here, so this is a label rather than a link
        const current = el('span', 'feed-page current', String(entry.page))
        current.setAttribute('aria-current', 'page')
        numbers.append(current)
      } else {
        numbers.append(pageLink(entry.page))
      }
    }

    // An empty span rather than nothing, so the numbers stay in the middle
    // when only one of the two links exists
    nav.append(feed.page > 1 ? stepLink('Previous', feed.page - 1, 'prev') : el('span'))
    nav.append(numbers)
    nav.append(feed.page < feed.pages ? stepLink('Next', feed.page + 1, 'next') : el('span'))

    return nav
  }

  function buildEmpty(feed) {
    const note = el('p', 'feed-empty muted')

    if (feed.q || feed.category) {
      note.append('Nothing matches that. ')
      const reset = el('a', null, 'Show everything')
      reset.href = '/'
      reset.dataset.feedNav = ''
      reset.dataset.reset = ''
      note.append(reset, '.')
    } else {
      note.textContent = 'Nothing has been published yet.'
    }

    return note
  }

  // The chips sit outside #feed-results, so they are marked rather than
  // rebuilt. Only the filter row - the ones on the cards are rebuilt anyway.
  function markActive(feed) {
    for (const chip of document.querySelectorAll('[data-sort]')) {
      chip.classList.toggle('active', chip.dataset.sort === feed.sort)
    }
    for (const chip of document.querySelectorAll('.feed-filters [data-category]')) {
      chip.classList.toggle('active', chip.dataset.category === feed.category)
    }
  }

  function render(feed) {
    results.replaceChildren()

    if (feed.items.length) {
      const list = el('ul', 'feed-list')
      list.id = 'feed-list'
      for (const article of feed.items) list.append(buildCard(article))
      results.append(list)
      if (feed.pages > 1) results.append(buildPager(feed))
    } else {
      results.append(buildEmpty(feed))
    }

    if (countEl) {
      countEl.textContent = `${feed.total} ${feed.total === 1 ? 'article' : 'articles'}`
    }
    markActive(feed)
  }

  function setStatus(text) {
    if (!statusEl) return
    statusEl.textContent = text
    statusEl.hidden = !text
  }

  // Guards against a slow earlier request landing after a faster later one and
  // painting the wrong articles.
  let latest = 0

  async function load(state, { push = true } = {}) {
    const query = toQuery(state)
    if (push) {
      const url = feedHref(state)
      // pushState does nothing when the URL is already the one asked for
      if (url !== location.pathname + location.search) history.pushState(null, '', url)
    }

    const mine = ++latest
    setStatus('Loading...')

    let feed
    try {
      const res = await fetch(`/api/articles?${query}`)
      if (!res.ok) throw new Error(res.status)
      feed = await res.json()
    } catch {
      // whatever is already on the page stays put rather than vanishing
      if (mine === latest) setStatus('Could not load the feed. Try again.')
      return
    }

    if (mine !== latest) return
    setStatus('')
    render(feed)
  }

  // --- controls ---

  let typing = null
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(typing)
      typing = setTimeout(
        () => load({ ...currentState(), q: searchInput.value.trim(), page: 1 }),
        TYPING_MS
      )
    })
  }

  form.addEventListener('submit', event => {
    event.preventDefault()
    clearTimeout(typing)
    load({ ...currentState(), q: searchInput.value.trim(), page: 1 })
  })

  // One handler for every link the feed owns. The href is deliberately ignored
  // and the data- attributes are the instruction instead: a rendered href is a
  // snapshot from the moment the page loaded, so it goes stale as soon as the
  // URL moves on without a reload.
  document.addEventListener('click', event => {
    const link = event.target.closest('a[data-feed-nav]')
    if (!link) return

    // leave the things that mean "open this somewhere else" to the browser
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    event.preventDefault()

    const next = { ...currentState(), page: 1 }
    const data = link.dataset

    if (data.reset !== undefined) Object.assign(next, { q: '', category: '', sort: 'date' })
    if (data.clearSearch !== undefined) next.q = ''
    if (data.sort) next.sort = data.sort
    if (data.category !== undefined) next.category = data.category
    if (data.page) next.page = Number(data.page)

    load(next)
  })

  // Back and forward have to work too, and they arrive with the URL already
  // changed - so no push this time, just pick the new state up.
  window.addEventListener('popstate', () => {
    const state = currentState()
    if (searchInput) searchInput.value = state.q
    load(state, { push: false })
  })
}
