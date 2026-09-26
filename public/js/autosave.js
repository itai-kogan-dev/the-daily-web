// Autosave for the article editor. There is no save button: the spec says work
// has to survive a refresh, a closed browser, or moving to another machine, so
// drafts go to the server rather than to localStorage.

const form = document.getElementById('article-form')
const statusEl = document.getElementById('save-status')

// read-only view (article is with the editor), nothing to wire up
if (form && !form.dataset.readonly) {
  const IDLE_MS = 1500     // save this long after typing stops
  const CEILING_MS = 10000 // ...but never go longer than this while typing

  let articleId = form.dataset.id || null
  let dirty = false
  let idleTimer = null
  let ceilingTimer = null

  // form.elements, not form.title - every element has a .title property
  // (the tooltip) and it would shadow the input named "title"
  const field = name => form.elements[name]

  const collect = () => ({
    title: field('title').value,
    summary: field('summary').value,
    body: field('body').value,
    category: field('category').value,
    imageUrl: field('imageUrl').value
  })

  function show(text, kind = '') {
    if (!statusEl) return
    statusEl.textContent = text
    statusEl.className = 'save-status ' + kind
  }

  const isBlank = c => !c.title.trim() && !c.summary.trim() && !c.body.trim() && !c.imageUrl.trim()

  async function save() {
    if (!dirty) return
    // typed something then deleted it again - nothing worth creating yet
    if (!articleId && isBlank(collect())) { dirty = false; show(''); return }
    clearTimeout(idleTimer)
    clearTimeout(ceilingTimer)
    ceilingTimer = null

    // clear the flag before the request, so edits made while it is in flight
    // are not swallowed
    dirty = false
    show('Saving...')

    const isNew = !articleId
    const res = await fetch(isNew ? '/reporter/api/article' : `/reporter/api/article/${articleId}`, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collect())
    }).catch(() => null)

    if (!res || !res.ok) {
      dirty = true
      show('Could not save, retrying...', 'error')
      setTimeout(save, 3000)
      return
    }

    const data = await res.json()

    if (isNew) {
      articleId = data.id
      form.dataset.id = data.id
      // so a refresh lands on the real article instead of the empty form
      history.replaceState(null, '', `/reporter/article/${data.id}`)
    }

    // editing a published article moves it back to in_progress
    const badge = document.getElementById('status-badge')
    if (badge && data.statusLabel) {
      badge.textContent = data.statusLabel
      badge.className = 'badge status-' + data.status
    }

    show('Saved ' + new Date(data.savedAt).toLocaleTimeString())
  }

  form.addEventListener('input', () => {
    dirty = true
    show('Unsaved changes', 'pending')

    clearTimeout(idleTimer)
    idleTimer = setTimeout(save, IDLE_MS)

    // someone typing without pause would otherwise never trigger the idle save
    if (!ceilingTimer) ceilingTimer = setTimeout(save, CEILING_MS)
  })

  // Closing the tab or switching away. keepalive lets the request outlive the
  // page - a normal fetch gets cancelled when the page goes. The dirty check
  // matters: without it, opening a new article and closing it untouched would
  // create an empty one.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden' || !dirty) return

    const isNew = !articleId
    fetch(isNew ? '/reporter/api/article' : `/reporter/api/article/${articleId}`, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collect()),
      keepalive: true
    })
  })

  // live image preview
  field('imageUrl').addEventListener('input', () => {
    const img = document.getElementById('image-preview')
    if (img) img.src = field('imageUrl').value
  })

  // --- send to editor ---
  const submitBtn = document.getElementById('submit-btn')
  const submitError = document.getElementById('submit-error')

  if (submitBtn) submitBtn.addEventListener('click', async () => {
    submitError.hidden = true
    submitBtn.disabled = true

    // flush anything still waiting, or we would submit a stale draft
    if (dirty) await save()

    const res = await fetch(`/reporter/api/article/${articleId}/submit`, { method: 'POST' })
    const data = await res.json()

    if (!res.ok) {
      submitError.textContent = data.error
      submitError.hidden = false
      submitBtn.disabled = false
      return
    }

    // reload so the page comes back read only, with the new status
    location.reload()
  })
}
