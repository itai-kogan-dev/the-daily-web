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

  function buildCard(article) {
    const item = el('li', 'list-item')
    item.dataset.articleId = article.id

    if (article.imagePath) {
      const link = el('a', 'list-thumb')
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

    const body = el('div', 'list-body')

    const title = el('a', 'list-title', article.title)
    title.href = `/article/${article.id}`
    body.append(title)

    if (article.summary) body.append(el('p', 'list-summary', article.summary))

    const meta = el('div', 'meta')

    const category = el('a', 'meta-category', article.categoryLabel)
    category.href = feedHref({ ...currentState(), category: article.category, page: 1 })
    category.dataset.feedNav = ''
    category.dataset.category = article.category
    meta.append(category)

    meta.append(el('span', null, article.authorName))

    const time = el('time', null, new Date(article.publishedAt).toLocaleDateString('en-GB'))
    time.dateTime = article.publishedAt
    meta.append(time)

    // en-US on purpose, and the same choice the template makes: a de-DE browser
    // would otherwise write 8.264 where the server wrote 8,264, and the number
    // would change shape the moment a card is redrawn.
    meta.append(el('span', null, `${Number(article.viewCount || 0).toLocaleString('en-US')} views`))

    body.append(meta)
    item.append(body)
    return item
  }

  // Infinite scroll owns everything below the cards. The server-rendered pager
  // stays in the HTML for readers without JavaScript and is removed once this
  // script runs, so the same feed never has two navigations on screen.
  let baseState = null
  let loadedPage = 1
  let loadedPages = 1
  let loadedTotal = 0
  let loadingMore = false
  let sentinel = null
  let observer = null
  let moreWrap = null
  let moreLink = null
  let moreNote = null
  // Client-only: not in the URL, because a bookmarked unread filter would do
  // nothing without JavaScript. No-JS readers never see the toggle.
  let unreadOnly = false
  let pageSize = 20
  let unreadToggle = null
  // The full id set for the current filters, so the unread count is the whole
  // feed and not just the loaded cards. Cached per filter; a failed fetch
  // leaves countIds null and the count falls back to the loaded cards.
  let countIds = null
  let countSig = null
  let countToken = 0

  function initialFeedState() {
    const state = currentState()
    const page = Math.max(1, parseInt((results.dataset && results.dataset.page) || state.page, 10) || 1)
    const pages = Math.max(page, parseInt((results.dataset && results.dataset.pages) || page, 10) || page)
    const total = Math.max(0, parseInt((results.dataset && results.dataset.total) || '0', 10) || 0)
    const size = Math.max(1, parseInt((results.dataset && results.dataset.pageSize) || '20', 10) || 20)
    return { state, page, pages, total, size }
  }

  function ensureMoreUI() {
    if (!sentinel) {
      sentinel = el('div', 'feed-sentinel')
      sentinel.setAttribute('aria-hidden', 'true')
    }
    if (!moreWrap) {
      moreWrap = el('div', 'feed-more')
      moreLink = el('a', 'btn', 'Load more articles')
      moreLink.dataset.feedNav = ''
      moreLink.dataset.more = ''
      moreNote = el('p', 'feed-more-note')
      moreNote.setAttribute('role', 'status')
      moreWrap.append(moreLink, moreNote)
    }
    // A fresh render replaces the #feed-results children, which detaches these
    // nodes while the variables still hold them. Re-attach whenever they are
    // not in the page, or the Load more link vanishes and the observer watches
    // a node that can never intersect again.
    if (!sentinel.isConnected) results.append(sentinel)
    if (!moreWrap.isConnected) results.append(moreWrap)
  }

  function stopObserving() {
    if (observer) observer.disconnect()
    observer = null
  }

  function observeSentinel() {
    ensureMoreUI()
    // Without IntersectionObserver the Load more link below still works, so an
    // older browser gets a button instead of an automatic load.
    if (!('IntersectionObserver' in window) || !sentinel) return
    stopObserving()
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) loadMore()
      }
    }, { root: null, rootMargin: '600px 0px', threshold: 0 })
    observer.observe(sentinel)
  }

  function articleCountText(total) {
    return `${total} ${total === 1 ? 'article' : 'articles'}`
  }

  // The count follows the filter: unread on means the unread articles in the
  // whole feed, unread off means the server total.
  function updateCount() {
    if (!countEl) return
    if (unreadOnly) {
      const n = unreadTotal()
      countEl.textContent = n === 1 ? '1 unread article' : `${n} unread articles`
    } else {
      countEl.textContent = articleCountText(loadedTotal)
    }
  }

  function unreadTotal() {
    // No id set yet, or its fetch failed: count the loaded cards rather than
    // showing nothing.
    if (!countIds) return visibleCards().length
    let read = null
    try {
      read = new Set(window.DailyWebRead ? window.DailyWebRead.list() : [])
    } catch {
      read = new Set()
    }
    let n = 0
    for (const id of countIds) {
      if (!read.has(id)) n++
    }
    return n
  }

  // The full unread count for the current filters. Cached per filter, so
  // toggling twice or coming back to the page recomputes against the fresh
  // read list without another request; a new filter refetches.
  async function refreshUnreadCount() {
    if (!unreadOnly || !baseState) {
      updateCount()
      return
    }
    // Sort never changes the set, so it is not part of the signature.
    const sig = JSON.stringify({ q: baseState.q, category: baseState.category })
    if (sig === countSig && countIds) {
      updateCount()
      return
    }
    const mine = ++countToken
    let ids = null
    try {
      const res = await fetch(`/api/articles/ids?${toQuery({ ...baseState, page: 1 })}`)
      if (!res.ok) throw new Error(res.status)
      ids = (await res.json()).ids
    } catch {
      ids = null
    }
    if (mine !== countToken) return
    countSig = sig
    countIds = Array.isArray(ids) ? ids : null
    updateCount()
  }

  function setMore({ announceEnd = true } = {}) {
    ensureMoreUI()
    if (!baseState) return
    if (!loadedTotal) {
      stopObserving()
      moreWrap.hidden = true
      moreLink.hidden = true
      moreNote.textContent = ''
      return
    }
    if (loadedPage < loadedPages) {
      moreWrap.hidden = false
      moreLink.hidden = false
      moreNote.textContent = ''
      const nextPage = loadedPage + 1
      moreLink.href = feedHref({ ...baseState, page: nextPage })
      moreLink.dataset.page = String(nextPage)
      moreLink.textContent = 'Load more articles'
      observeSentinel()
    } else {
      stopObserving()
      moreWrap.hidden = false
      moreLink.hidden = true
      if (!announceEnd) {
        moreNote.textContent = ''
      } else if (unreadOnly) {
        const visible = visibleCards().length
        moreNote.textContent = visible
          ? `That's all ${articleCountText(loadedTotal)} - ${visible} unread.`
          : `You've read all ${articleCountText(loadedTotal)}.`
      } else {
        moreNote.textContent = `That's all ${articleCountText(loadedTotal)}.`
      }
    }
  }

  function loadMore() {
    if (loadingMore || inflight > 0 || !baseState) return
    if (loadedPage >= loadedPages) return
    load({ ...baseState, page: loadedPage + 1 }, { push: false, syncInput: false, append: true })
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
    for (const chip of document.querySelectorAll('.pills [data-category]')) {
      // The API answers with null when no category is selected, while the All
      // chip carries an empty string. Without the fallback All never matches.
      chip.classList.toggle('active', chip.dataset.category === (feed.category || ''))
    }
  }

  // Unread means "not opened in this browser". The server never sees the list,
  // so the toggle only hides cards that are already on the page - it cannot
  // change the total, and it stays out of the URL.
  function isRead(id) {
    try {
      return Boolean(window.DailyWebRead && window.DailyWebRead.has(id))
    } catch {
      return false
    }
  }

  function visibleCards() {
    const list = document.getElementById('feed-list')
    if (!list) return []
    return Array.from(list.children).filter(card => !card.hidden)
  }

  function applyUnread() {
    const list = document.getElementById('feed-list')
    if (!list) return 0
    let visible = 0
    for (const card of list.children) {
      const read = isRead(card.dataset && card.dataset.articleId)
      card.hidden = unreadOnly && read
      if (!card.hidden) visible++
    }
    return visible
  }

  function maybeFillUnread() {
    if (!unreadOnly) return
    // A filtered page can render short, so keep loading until a full page of
    // unread cards is on screen or the feed itself runs out.
    if (visibleCards().length < pageSize) loadMore()
  }

  function setUnreadOnly(value) {
    unreadOnly = Boolean(value)
    if (unreadToggle) unreadToggle.checked = unreadOnly
    applyUnread()
    refreshUnreadCount()
    setMore()
    maybeFillUnread()
  }

  // The browser restores the checkbox when the reader comes back from an
  // article, so the toggle can already be on before any of this runs. The
  // script is the source of truth going forward, but it has to pick up the
  // restored control first or the two disagree and the filter looks on while
  // off.
  function syncUnreadFromToggle() {
    unreadOnly = Boolean(unreadToggle && unreadToggle.checked)
  }

  function ensureUnreadToggle() {
    if (unreadToggle) return unreadToggle
    // Without the shared read list there is nothing truthful to filter on, so
    // no-JS readers and blocked scripts never see a dead control.
    if (!window.DailyWebRead) return null
    // It lives with the filters, not the sorters: it narrows which articles
    // show, it never orders them.
    const chips = document.querySelectorAll('.pills [data-category]')
    if (!chips.length || !chips[0].parentNode) return null
    // History navigation can restore the toggle node itself while this script
    // starts over, so reuse it instead of adding a second toggle beside it.
    const existing = document.querySelector('.feed-toggle input[type="checkbox"]')
    if (existing) {
      unreadToggle = existing
      if (!unreadToggle.dataset.feedUnread) {
        unreadToggle.dataset.feedUnread = '1'
        unreadToggle.addEventListener('change', () => setUnreadOnly(unreadToggle.checked))
      }
      return unreadToggle
    }
    // A checkbox, not a button: the on/off state lives in the control itself,
    // so it needs no aria-pressed and announces as a switch would.
    const wrap = el('label', 'feed-toggle')
    const box = el('input')
    box.type = 'checkbox'
    box.dataset.feedUnread = '1'
    const track = el('span', 'feed-toggle-track')
    track.setAttribute('aria-hidden', 'true')
    track.append(el('span', 'feed-toggle-thumb'))
    wrap.append(box, track, el('span', 'feed-toggle-label', 'Unread only'))
    box.addEventListener('change', () => setUnreadOnly(box.checked))
    // Categories live in the sidebar now, so the switch goes into the toolbar
    // slot next to search and sort. The old home stays as the fallback.
    const slot = document.getElementById('feed-unread-slot')
    const home = slot || (chips.length && chips[0].parentNode)
    if (!home) return null
    home.append(wrap)
    unreadToggle = box
    return unreadToggle
  }

  function render(feed, state, { append = false } = {}) {
    // Appending is only for the next page of the same feed. Anything else -
    // a new search, a chip, back/forward - starts from a clean list.
    const list = append ? document.getElementById('feed-list') : null
    if (append && list) {
      for (const article of feed.items) list.append(buildCard(article))
    } else {
      stopObserving()
      results.replaceChildren()

      if (feed.items.length) {
        const fresh = el('ul', 'list feed-list')
        fresh.id = 'feed-list'
        for (const article of feed.items) fresh.append(buildCard(article))
        results.append(fresh)
      } else {
        results.append(buildEmpty(feed))
      }
    }

    markActive(feed)

    if (!append) {
      baseState = { q: state.q, category: state.category, sort: state.sort, page: 1 }
      // The heading follows the filters, using the same words the server
      // renders. The label comes from the matching category pill, so the two
      // can never disagree. Compared via dataset, never interpolated into a
      // selector, so a crafted query value cannot break the lookup.
      const heading = document.getElementById('feed-title')
      if (heading) {
        let title = 'Latest News'
        if (state.sort === 'popular') {
          title = 'Most Read'
        } else if (state.category) {
          for (const pill of document.querySelectorAll('.pills [data-category]')) {
            if (pill.dataset.category === state.category) {
              title = pill.textContent.trim()
              break
            }
          }
        }
        heading.textContent = title
        document.title = title + ' — The Daily Web'
      }
    }
    loadedPage = feed.page
    loadedPages = feed.pages
    loadedTotal = feed.total
    if (Number(feed.pageSize) > 0) pageSize = Number(feed.pageSize)
    // The Load more path appends to the same list, so it needs the same
    // reconciliation as the initial paint and the return-from-article path.
    syncUnreadFromToggle()
    applyUnread()
    refreshUnreadCount()
    setMore()
    maybeFillUnread()
  }

  function setStatus(text) {
    if (!statusEl) return
    statusEl.textContent = text
    statusEl.hidden = !text
  }

  // Guards against a slow earlier request landing after a faster later one and
  // painting the wrong articles. inflight is separate: an automatic append must
  // never start while a fresh feed is on its way, or it would supersede it and
  // append to the page the reader just left.
  let latest = 0
  let inflight = 0

  async function load(state, { push = true, syncInput = true, append = false } = {}) {
    // The input is the one place the address bar cannot speak for itself. It is
    // synced on every route through here except typing and submitting, where the
    // reader's unfinished text - including a trailing space - has to be left alone.
    if (syncInput && searchInput && searchInput.value !== state.q) searchInput.value = state.q

    // Appended pages are never a new address. Pushing ?page=2..20 would bury the
    // back button under every scrolled page, so only fresh feeds move the URL.
    if (append) {
      if (loadingMore) return
      loadingMore = true
    }

    const query = toQuery(state)
    if (push && !append) {
      const url = feedHref(state)
      // pushState does nothing when the URL is already the one asked for
      if (url !== location.pathname + location.search) history.pushState(null, '', url)
    }

    const mine = ++latest
    inflight++
    if (!append) stopObserving()
    setStatus(append ? 'Loading more...' : 'Loading...')

    let feed
    try {
      const res = await fetch(`/api/articles?${query}`)
      if (!res.ok) throw new Error(res.status)
      feed = await res.json()
    } catch {
      inflight--
      if (append) loadingMore = false
      // whatever is already on the page stays put rather than vanishing
      if (mine === latest) setStatus('Could not load the feed. Try again.')
      return
    }

    if (mine !== latest) {
      inflight--
      if (append) loadingMore = false
      return
    }
    setStatus('')
    try {
      render(feed, state, { append })
    } finally {
      inflight--
      if (append) loadingMore = false
    }
  }

  // --- controls ---

  let typing = null
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(typing)
      typing = setTimeout(
        () => load({ ...currentState(), q: searchInput.value.trim(), page: 1 }, { syncInput: false }),
        TYPING_MS
      )
    })
  }

  form.addEventListener('submit', event => {
    event.preventDefault()
    clearTimeout(typing)
    load({ ...currentState(), q: searchInput.value.trim(), page: 1 }, { syncInput: false })
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

    const data = link.dataset
    // The Load more link asks for the next page of the feed already on screen.
    // The href is ignored like every other feed link, because it goes stale as
    // soon as the filters move on without a reload.
    if (data.more !== undefined) {
      loadMore()
      return
    }

    const next = { ...currentState(), page: 1 }

    if (data.reset !== undefined) Object.assign(next, { q: '', category: '', sort: 'date' })
    if (data.sort) next.sort = data.sort
    if (data.category !== undefined) next.category = data.category
    if (data.page) next.page = Number(data.page)

    load(next)
  })

  // Back and forward have to work too, and they arrive with the URL already
  // changed - so no push this time, just pick the new state up. The input sync
  // happens inside load().
  window.addEventListener('popstate', () => {
    load(currentState(), { push: false })
  })

  // Coming back from an article - back button, tab switch, another tab - can
  // leave a just-read card on screen, because recording happens on the article
  // page while this page sits untouched. Re-apply the filter whenever the page
  // becomes visible again. Cheap and idempotent, so all three ways back share
  // the one handler.
  async function refreshOnReturn() {
    syncUnreadFromToggle()
    if (!unreadOnly) return
    applyUnread()
    await refreshUnreadCount()
    setMore()
    maybeFillUnread()
  }

  window.addEventListener('pageshow', refreshOnReturn)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshOnReturn()
  })
  window.addEventListener('storage', event => {
    const key = window.DailyWebRead && window.DailyWebRead.KEY
    if (event.key === key) refreshOnReturn()
  })

  // Start from the server-rendered page instead of fetching it again. The pager
  // is removed here rather than hidden, because leaving a second navigation in
  // the page would give keyboard and screen-reader users two ways to move.
  const serverPager = results.querySelector('.feed-pager')
  if (serverPager) serverPager.remove()
  const initial = initialFeedState()
  baseState = { ...initial.state, page: 1 }
  loadedPage = initial.page
  loadedPages = initial.pages
  loadedTotal = initial.total
  pageSize = initial.size
  ensureUnreadToggle()
  syncUnreadFromToggle()
  applyUnread()
  refreshUnreadCount()
  // Quiet at the end on first paint: the server already showed this page, so
  // there is nothing new to announce until the next client load.
  if (initial.total) setMore({ announceEnd: false })
}
