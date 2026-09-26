// Autosave for the article editor. There is no save button: the spec says work
// has to survive a refresh, a closed browser, or moving to another machine, so
// drafts go to the server rather than to localStorage.

const form = document.getElementById('article-form')
const statusEl = document.getElementById('save-status')

// read-only view (article is with the editor), nothing to wire up
if (form && !form.dataset.readonly) {
  const IDLE_MS = 1500     // save this long after typing stops
  const CEILING_MS = 10000 // ...but never go longer than this while typing

  const submitBtn = document.getElementById('submit-btn')
  const submitError = document.getElementById('submit-error')

  let articleId = form.dataset.id || null
  let hasUnsavedChanges = false
  let idleTimer = null
  let ceilingTimer = null

  // form.elements, not form.title - every element has a .title property
  // (the tooltip) and it would shadow the input named "title"
  const getField = name => form.elements[name]

  const readForm = () => ({
    title: getField('title').value,
    summary: getField('summary').value,
    body: getField('body').value,
    category: getField('category').value,
    imageUrl: getField('imageUrl').value
  })

  function showStatus(text, state = '') {
    if (!statusEl) return
    statusEl.textContent = text
    statusEl.className = 'save-status ' + state
  }

  const isBlank = content => !content.title.trim() && !content.summary.trim() && !content.body.trim() && !content.imageUrl.trim()

  async function saveDraft() {
    if (!hasUnsavedChanges) return
    // typed something then deleted it again - nothing worth creating yet
    if (!articleId && isBlank(readForm())) {
      hasUnsavedChanges = false
      showStatus('')
      return
    }
    clearTimeout(idleTimer)
    clearTimeout(ceilingTimer)
    ceilingTimer = null

    // clear the flag before the request, so anything typed while it is in
    // flight is not swallowed
    hasUnsavedChanges = false
    showStatus('Saving...')

    const isNew = !articleId
    const res = await fetch(isNew ? '/reporter/api/article' : `/reporter/api/article/${articleId}`, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(readForm())
    }).catch(() => null)

    if (!res || !res.ok) {
      hasUnsavedChanges = true
      showStatus('Could not save, retrying...', 'error')
      setTimeout(saveDraft, 3000)
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

    showStatus('Saved ' + new Date(data.savedAt).toLocaleTimeString())
  }

  form.addEventListener('input', () => {
    hasUnsavedChanges = true
    showStatus('Unsaved changes', 'pending')

    clearTimeout(idleTimer)
    idleTimer = setTimeout(saveDraft, IDLE_MS)

    // someone typing without pause would otherwise never trigger the idle save
    if (!ceilingTimer) ceilingTimer = setTimeout(saveDraft, CEILING_MS)
  })

  // Closing the tab or switching away. keepalive lets the request outlive the
  // page - a normal fetch gets cancelled when the page goes. The check matters:
  // without it, opening a new article and closing it untouched would create one.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden' || !hasUnsavedChanges) return

    const isNew = !articleId
    fetch(isNew ? '/reporter/api/article' : `/reporter/api/article/${articleId}`, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(readForm()),
      keepalive: true
    })
  })

  // live image preview - it starts hidden when the article has no image yet
  getField('imageUrl').addEventListener('input', () => {
    const img = document.getElementById('image-preview')
    if (!img) return
    const url = getField('imageUrl').value.trim()
    img.src = url
    img.hidden = !url
  })

  if (submitBtn) submitBtn.addEventListener('click', async () => {
    submitError.hidden = true
    submitBtn.disabled = true

    // flush anything still waiting, or we would submit a stale draft
    if (hasUnsavedChanges) await saveDraft()

    // still nothing saved, so there is no article to send
    if (!articleId) {
      submitError.textContent = 'Write something first'
      submitError.hidden = false
      submitBtn.disabled = false
      return
    }

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
