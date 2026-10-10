// The feed without page reloads. The server-rendered page already works on its
// own; this takes over its form and links and keeps the address bar in step.

const form = document.querySelector('.feed-search')
const searchInput = form && form.querySelector('input[name="q"]')
const results = document.getElementById('feed-results')
const statusEl = document.getElementById('feed-status')
const countEl = document.getElementById('feed-count')

if (form && results) {
  // Typing a search fires one request instead of one per keystroke.
  const TYPING_MS = 350

  // the address bar is the only state, so a reload, a bookmark and Back agree
  function readState() {
    const params = new URLSearchParams(location.search)
    return {
      q: (params.get('q') || '').trim(),
      category: params.get('category') || '',
      sort: params.get('sort') === 'popular' ? 'popular' : 'date',
      page: Math.max(1, parseInt(params.get('page'), 10) || 1)
    }
  }

  // defaults are left out so the address stays short - mirrors buildFeedLink()
  // in controllers/publicController.js
  function buildQuery(state) {
    const params = new URLSearchParams()
    if (state.q) params.set('q', state.q)
    if (state.category) params.set('category', state.category)
    if (state.sort !== 'date') params.set('sort', state.sort)
    if (state.page > 1) params.set('page', state.page)
    return params.toString()
  }

  function buildFeedHref(state) {
    const query = buildQuery(state)
    return query ? `/?${query}` : '/'
  }

  function createEl(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    // textContent, never innerHTML: a headline must not be able to bring markup
    if (text !== undefined) node.textContent = text
    return node
  }

  function buildCard(article) {
    const item = createEl('li', 'list-item')
    item.dataset.articleId = article.id

    if (article.imagePath) {
      const link = Object.assign(createEl('a', 'list-thumb'), { href: `/article/${article.id}`, tabIndex: -1 })
      link.setAttribute('aria-hidden', 'true')
      link.append(Object.assign(createEl('img'), { src: article.imagePath, alt: '', loading: 'lazy', width: 160, height: 107 }))
      item.append(link)
    }

    const body = createEl('div', 'list-body')

    const title = createEl('a', 'list-title', article.title)
    title.href = `/article/${article.id}`
    body.append(title)

    if (article.summary) body.append(createEl('p', 'list-summary', article.summary))

    const meta = createEl('div', 'meta')

    const category = createEl('a', 'meta-category', article.categoryLabel)
    category.href = buildFeedHref({ ...readState(), category: article.category, page: 1 })
    category.dataset.feedNav = ''
    category.dataset.category = article.category
    meta.append(category)

    meta.append(createEl('span', null, article.authorName))

    const time = createEl('time', null, new Date(article.publishedAt).toLocaleDateString('en-GB'))
    time.dateTime = article.publishedAt
    meta.append(time)

    // en-US like the template, or a German browser would redraw 8,264 as 8.264
    meta.append(createEl('span', null, `${Number(article.viewCount || 0).toLocaleString('en-US')} views`))

    body.append(meta)
    item.append(body)
    return item
  }

  // Infinite scroll owns everything below the cards. The no-JavaScript pager is
  // removed at start-up (end of this file).
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
  // kept out of the URL - a bookmarked unread filter would do nothing without JS
  let unreadOnly = false
  let pageSize = 20
  let unreadToggle = null
  // every id under the current filters, so the unread count covers the whole
  // feed, not just the loaded cards - null until fetched, or if that failed
  let countIds = null
  let countSig = null
  let countToken = 0

  // where the server-rendered page left off, from the data- attributes the
  // template puts on #feed-results
  function readInitialState() {
    const data = results.dataset
    const page = Number(data.page) || 1
    return {
      state: readState(),
      page,
      pages: Math.max(page, Number(data.pages) || 1),
      total: Number(data.total) || 0,
      size: Number(data.pageSize) || 20
    }
  }

  function ensureMoreUI() {
    if (!sentinel) {
      sentinel = createEl('div', 'feed-sentinel')
      sentinel.setAttribute('aria-hidden', 'true')
    }
    if (!moreWrap) {
      moreWrap = createEl('div', 'feed-more')
      moreLink = createEl('a', 'btn', 'Load more articles')
      moreLink.dataset.feedNav = ''
      moreLink.dataset.more = ''
      moreNote = createEl('p', 'feed-more-note')
      moreNote.setAttribute('role', 'status')
      moreWrap.append(moreLink, moreNote)
    }
    // a fresh render empties #feed-results, so put these back whenever they are
    // missing - otherwise Load more vanishes and the observer watches nothing
    if (!sentinel.isConnected) results.append(sentinel)
    if (!moreWrap.isConnected) results.append(moreWrap)
  }

  function stopObserving() {
    if (observer) observer.disconnect()
    observer = null
  }

  function observeSentinel() {
    ensureMoreUI()
    // without IntersectionObserver the Load more link still works
    if (!('IntersectionObserver' in window) || !sentinel) return
    stopObserving()
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) loadMore()
      }
    }, { root: null, rootMargin: '600px 0px', threshold: 0 })
    observer.observe(sentinel)
  }

  function formatArticleCount(total) {
    return `${total} ${total === 1 ? 'article' : 'articles'}`
  }

  // The count follows the filter: unread on means the unread articles in the
  // whole feed, unread off means the server total.
  function updateCount() {
    if (!countEl) return
    if (unreadOnly) {
      const n = countUnread()
      countEl.textContent = n === 1 ? '1 unread article' : `${n} unread articles`
    } else {
      countEl.textContent = formatArticleCount(loadedTotal)
    }
  }

  function countUnread() {
    // no id set yet, or it failed to load: count the loaded cards instead
    if (!countIds) return getVisibleCards().length
    const read = new Set(DailyWebRead.list())
    return countIds.filter(id => !read.has(id)).length
  }

  // the ids are fetched once per filter; the read list is checked fresh each time
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
      const res = await fetch(`/api/articles/ids?${buildQuery({ ...baseState, page: 1 })}`)
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
      moreLink.href = buildFeedHref({ ...baseState, page: nextPage })
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
        const visible = getVisibleCards().length
        moreNote.textContent = visible
          ? `That's all ${formatArticleCount(loadedTotal)} - ${visible} unread.`
          : `You've read all ${formatArticleCount(loadedTotal)}.`
      } else {
        moreNote.textContent = `That's all ${formatArticleCount(loadedTotal)}.`
      }
    }
  }

  function loadMore() {
    if (loadingMore || inflight > 0 || !baseState) return
    if (loadedPage >= loadedPages) return
    load({ ...baseState, page: loadedPage + 1 }, { push: false, syncInput: false, append: true })
  }

  function buildEmpty(feed) {
    const note = createEl('p', 'feed-empty muted')

    if (feed.q || feed.category) {
      note.append('Nothing matches that. ')
      const reset = createEl('a', null, 'Show everything')
      reset.href = '/'
      reset.dataset.feedNav = ''
      reset.dataset.reset = ''
      note.append(reset, '.')
    } else {
      note.textContent = 'Nothing has been published yet.'
    }

    return note
  }

  // the filter pills sit outside #feed-results, so they are marked, not rebuilt
  function markActive(feed) {
    for (const chip of document.querySelectorAll('[data-sort]')) {
      chip.classList.toggle('active', chip.dataset.sort === feed.sort)
    }
    for (const chip of document.querySelectorAll('.pills [data-category]')) {
      // the API sends null for no category, while the All pill carries ''
      chip.classList.toggle('active', chip.dataset.category === (feed.category || ''))
    }
  }

  function getVisibleCards() {
    const list = document.getElementById('feed-list')
    if (!list) return []
    return Array.from(list.children).filter(card => !card.hidden)
  }

  // Unread means "not opened in this browser" - read.js keeps that list on the
  // device. The read list is only asked while the filter is on, and the filter
  // can only be on when read.js has loaded (see ensureUnreadToggle).
  function applyUnread() {
    const list = document.getElementById('feed-list')
    if (!list) return
    for (const card of list.children) {
      card.hidden = unreadOnly && DailyWebRead.has(card.dataset.articleId)
    }
  }

  function fillUnread() {
    if (!unreadOnly) return
    // keep loading until a page's worth of unread cards shows, or the feed ends
    if (getVisibleCards().length < pageSize) loadMore()
  }

  function setUnreadOnly(value) {
    unreadOnly = Boolean(value)
    if (unreadToggle) unreadToggle.checked = unreadOnly
    applyUnread()
    refreshUnreadCount()
    setMore()
    fillUnread()
  }

  // the browser restores the checkbox on Back, so it can already be on before
  // this script runs - read it rather than assume it is off
  function syncUnreadFromToggle() {
    unreadOnly = Boolean(unreadToggle && unreadToggle.checked)
  }

  function ensureUnreadToggle() {
    if (unreadToggle) return unreadToggle
    // without read.js there is nothing to filter on, so no switch at all
    if (!window.DailyWebRead) return null
    // only on the feed, which has the category pills
    const chips = document.querySelectorAll('.pills [data-category]')
    if (!chips.length) return null
    // Back can restore the switch itself - reuse it rather than add a second
    const existing = document.querySelector('.feed-toggle input[type="checkbox"]')
    if (existing) {
      unreadToggle = existing
      if (!unreadToggle.dataset.feedUnread) {
        unreadToggle.dataset.feedUnread = '1'
        unreadToggle.addEventListener('change', () => setUnreadOnly(unreadToggle.checked))
      }
      return unreadToggle
    }
    // a checkbox, not a button: it holds its own on/off state
    const wrap = createEl('label', 'feed-toggle')
    const box = createEl('input')
    box.type = 'checkbox'
    box.dataset.feedUnread = '1'
    const track = createEl('span', 'feed-toggle-track')
    track.setAttribute('aria-hidden', 'true')
    track.append(createEl('span', 'feed-toggle-thumb'))
    wrap.append(box, track, createEl('span', 'feed-toggle-label', 'Unread only'))
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
    // appending is only for the next page of the same feed - anything else
    // (a search, a pill, Back) starts a clean list
    const list = append ? document.getElementById('feed-list') : null
    if (append && list) {
      for (const article of feed.items) list.append(buildCard(article))
    } else {
      stopObserving()
      results.replaceChildren()

      if (feed.items.length) {
        const fresh = createEl('ul', 'list feed-list')
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
    // the same unread handling as on start-up and on coming back
    syncUnreadFromToggle()
    applyUnread()
    refreshUnreadCount()
    setMore()
    fillUnread()
  }

  function setStatus(text) {
    if (!statusEl) return
    statusEl.textContent = text
    statusEl.hidden = !text
  }

  // latest drops an older answer that lands after a newer one. inflight stops
  // Load more from starting while a fresh feed is on its way.
  let latest = 0
  let inflight = 0

  async function load(state, { push = true, syncInput = true, append = false } = {}) {
    // synced from the URL, except while the reader is typing in it
    if (syncInput && searchInput && searchInput.value !== state.q) searchInput.value = state.q

    // only a fresh feed changes the address - every scrolled page would bury Back
    if (append) {
      if (loadingMore) return
      loadingMore = true
    }

    const query = buildQuery(state)
    if (push && !append) {
      const url = buildFeedHref(state)
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
        () => load({ ...readState(), q: searchInput.value.trim(), page: 1 }, { syncInput: false }),
        TYPING_MS
      )
    })
  }

  form.addEventListener('submit', event => {
    event.preventDefault()
    clearTimeout(typing)
    load({ ...readState(), q: searchInput.value.trim(), page: 1 }, { syncInput: false })
  })

  // One handler for every feed link. It reads the data- attributes, not the
  // href: an href is a snapshot from page load and goes stale as the URL moves.
  document.addEventListener('click', event => {
    const link = event.target.closest('a[data-feed-nav]')
    if (!link) return

    // leave the things that mean "open this somewhere else" to the browser
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    event.preventDefault()

    const data = link.dataset
    // Load more asks for the next page of the feed already on screen
    if (data.more !== undefined) {
      loadMore()
      return
    }

    const next = { ...readState(), page: 1 }

    if (data.reset !== undefined) Object.assign(next, { q: '', category: '', sort: 'date' })
    if (data.sort) next.sort = data.sort
    if (data.category !== undefined) next.category = data.category
    if (data.page) next.page = Number(data.page)

    load(next)
  })

  // Back and Forward arrive with the URL already changed, so load without a push
  window.addEventListener('popstate', () => {
    load(readState(), { push: false })
  })

  // Coming back from an article (Back, a tab switch, another tab) can leave a
  // just-read card on screen, so the unread filter is applied again.
  async function refreshOnReturn() {
    syncUnreadFromToggle()
    if (!unreadOnly) return
    applyUnread()
    await refreshUnreadCount()
    setMore()
    fillUnread()
  }

  window.addEventListener('pageshow', refreshOnReturn)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshOnReturn()
  })
  window.addEventListener('storage', event => {
    if (event.key === window.DailyWebRead?.KEY) refreshOnReturn()
  })

  // Start from the server-rendered page rather than fetching it again, and remove
  // its pager - one way through the feed is enough.
  const serverPager = results.querySelector('.pager')
  if (serverPager) serverPager.remove()
  const initial = readInitialState()
  baseState = { ...initial.state, page: 1 }
  loadedPage = initial.page
  loadedPages = initial.pages
  loadedTotal = initial.total
  pageSize = initial.size
  ensureUnreadToggle()
  syncUnreadFromToggle()
  applyUnread()
  refreshUnreadCount()
  // quiet on first paint - the server already showed this page
  if (initial.total) setMore({ announceEnd: false })
}
