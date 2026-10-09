// Autosave for the reporter's article editor. There is no save button: the
// spec says work has to survive a refresh, a closed browser, or moving to
// another machine, so drafts go to the server rather than to localStorage.

const form = document.getElementById('article-form')
const statusEl = document.getElementById('save-status')

// no form means the article is with the editor and the page is read only
if (form) {
  const IDLE_MS = 1500     // save this long after typing stops
  const CEILING_MS = 10000 // ...but never go longer than this while typing

  const submitBtn = document.getElementById('submit-btn')
  const submitError = document.getElementById('submit-error')
  const submitHint = document.getElementById('submit-hint')

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
    imagePath: getField('imagePath').value
  })

  function showStatus(text, state = '') {
    if (!statusEl) return
    statusEl.textContent = text
    statusEl.className = 'save-status ' + state
  }

  // the error takes the hint's place
  function showSubmitError(text) {
    submitError.textContent = text
    submitError.hidden = false
    if (submitHint) submitHint.hidden = true
  }

  const isBlank = content => !content.title.trim() && !content.summary.trim() &&
                             !content.body.trim() && !content.imagePath.trim()

  // Saves run one after another. Two at once could both see no articleId yet
  // and create the article twice. keepalive lets the request outlive the page
  // when the tab is closing.
  let saving = Promise.resolve()
  function saveDraft({ keepalive = false } = {}) {
    saving = saving.then(() => save(keepalive)).catch(() => showStatus('Could not save', 'error'))
    return saving
  }

  async function save(keepalive) {
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
      body: JSON.stringify(readForm()),
      keepalive
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
      // a new article is an unpublished draft, which the reporter can always
      // delete - show the button now so a false start can be removed
      ensureDeleteButton()
    }

    // editing a published article moves it back to in_progress
    const badge = document.getElementById('status-badge')
    if (badge && data.statusLabel) {
      badge.textContent = data.statusLabel
      badge.className = 'badge status-' + data.status
    }

    showStatus('Saved ' + new Date(data.savedAt).toLocaleTimeString())
  }

  function markChanged() {
    hasUnsavedChanges = true
    showStatus('Unsaved changes', 'pending')

    clearTimeout(idleTimer)
    idleTimer = setTimeout(saveDraft, IDLE_MS)

    // someone typing without pause would otherwise never trigger the idle save
    if (!ceilingTimer) ceilingTimer = setTimeout(saveDraft, CEILING_MS)
  }

  form.addEventListener('input', markChanged)

  // closing the tab or switching away
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveDraft({ keepalive: true })
  })

  // a new picture is saved straight away rather than after the idle wait
  setUpImageField({
    uploadUrl: '/reporter/api/image',
    onChange: () => {
      markChanged()
      saveDraft()
    }
  })

  // --- delete ---
  // Only shown for a draft that was never published. Autosave is stopped
  // first, so a save cannot land on an article that no longer exists.
  async function handleDelete(deleteBtn) {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return

    hasUnsavedChanges = false
    clearTimeout(idleTimer)
    clearTimeout(ceilingTimer)
    deleteBtn.disabled = true

    const res = await fetch(`/reporter/api/article/${articleId}`, { method: 'DELETE' }).catch(() => null)
    if (!res || !res.ok) {
      deleteBtn.disabled = false
      showSubmitError(res ? (await res.json().catch(() => ({}))).error || 'Could not delete the draft' : 'Could not reach the server')
      return
    }

    location.href = '/reporter'
  }

  function attachDeleteHandler(deleteBtn) {
    if (deleteBtn && !deleteBtn.dataset.bound) {
      deleteBtn.dataset.bound = '1'
      deleteBtn.addEventListener('click', () => handleDelete(deleteBtn))
    }
  }

  // A new article starts with no delete button (nothing exists yet). Once the
  // first autosave creates it, the button appears without needing a reload.
  function ensureDeleteButton() {
    if (document.getElementById('delete-btn')) return
    const container = document.getElementById('side-actions')
    if (!container) return
    const btn = document.createElement('button')
    btn.id = 'delete-btn'
    btn.type = 'button'
    btn.className = 'btn btn-danger'
    btn.textContent = 'Delete draft'
    container.appendChild(btn)
    attachDeleteHandler(btn)
  }

  attachDeleteHandler(document.getElementById('delete-btn'))

  // --- send to editor ---
  if (submitBtn) submitBtn.addEventListener('click', async () => {
    submitError.hidden = true
    if (submitHint) submitHint.hidden = false
    submitBtn.disabled = true

    // flush anything still waiting, or we would submit a stale draft
    if (hasUnsavedChanges) await saveDraft()

    // still nothing saved, so there is no article to send
    if (!articleId) {
      showSubmitError('Write something first')
      submitBtn.disabled = false
      return
    }

    const res = await fetch(`/reporter/api/article/${articleId}/submit`, { method: 'POST' })
    const data = await res.json()

    if (!res.ok) {
      showSubmitError(data.error)
      submitBtn.disabled = false
      return
    }

    // reload so the page comes back read only, with the new status
    location.reload()
  })
}
