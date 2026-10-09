(function () {
  const page = document.querySelector('main[data-article]')
  if (!page) return

  const articleId = page.dataset.article
  // only on the page while the article waits for approval
  const form = document.getElementById('review-form')
  const statusEl = document.getElementById('review-status')
  const errorEl = document.getElementById('review-error')
  const badge = document.getElementById('status-badge')

  function showStatus(text, state) {
    if (!statusEl) return
    statusEl.textContent = text
    statusEl.className = 'save-status' + (state ? ' ' + state : '')
  }

  function showError(text) {
    if (!errorEl) return
    errorEl.textContent = text || ''
    errorEl.hidden = !text
  }

  async function readError(res) {
    try {
      const data = await res.json()
      return data.error || 'Something went wrong'
    } catch (err) {
      return 'Something went wrong'
    }
  }

  // --- autosave ---
  // The editor's typing goes to the server on its own, the same way the
  // reporter's does, so an edit survives a refresh or another computer.
  // Without a form there is nothing to save and this stays a no-op.
  let saveDraft = async () => {}

  if (form) {
    const IDLE_MS = 1500     // save this long after typing stops
    const CEILING_MS = 10000 // ...but never go longer than this while typing

    let hasUnsavedChanges = false
    let idleTimer = null
    let ceilingTimer = null

    // form.elements, not form.title - same shadowing problem as the reporter form
    const getField = name => form.elements[name]

    const readForm = () => ({
      title: getField('title').value,
      summary: getField('summary').value,
      body: getField('body').value,
      category: getField('category').value,
      imagePath: getField('imagePath').value
    })

    async function save(keepalive) {
      if (!hasUnsavedChanges) return
      clearTimeout(idleTimer)
      clearTimeout(ceilingTimer)
      ceilingTimer = null

      // clear the flag before the request, so anything typed while it is in
      // flight is not swallowed
      hasUnsavedChanges = false
      showStatus('Saving...')

      const res = await fetch(`/editor/api/article/${articleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(readForm()),
        keepalive
      }).catch(() => null)

      if (!res) {
        hasUnsavedChanges = true
        showStatus('Could not save, retrying...', 'error')
        setTimeout(saveDraft, 3000)
        return
      }

      // the server said no (a bad image path and the like) - show it instead
      // of retrying something that will fail the same way again
      if (!res.ok) {
        showStatus('')
        showError(await readError(res))
        return
      }

      const data = await res.json()
      if (badge && data.statusLabel) {
        badge.textContent = data.statusLabel
        badge.className = 'badge status-' + data.status
      }
      showStatus('Saved ' + new Date(data.savedAt).toLocaleTimeString())
    }

    // one save at a time, so two upserts of the same draft never race
    let saving = Promise.resolve()
    saveDraft = ({ keepalive = false } = {}) => {
      saving = saving.then(() => save(keepalive)).catch(() => showStatus('Could not save', 'error'))
      return saving
    }

    function markChanged() {
      hasUnsavedChanges = true
      showError('')
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
      uploadUrl: '/editor/api/image',
      onChange: () => {
        markChanged()
        saveDraft()
      }
    })
  }

  // Publish and send back both take what the editor saw, so anything still
  // waiting to be saved goes first.
  async function act(button, request) {
    showError('')
    button.disabled = true
    await saveDraft()

    const res = await request().catch(() => null)
    if (!res || !res.ok) {
      button.disabled = false
      showError(!res ? 'Could not reach the server' : await readError(res))
      return
    }

    location.reload()
  }

  const publishBtn = document.getElementById('publish-btn')
  if (publishBtn) publishBtn.addEventListener('click', () => {
    act(publishBtn, () => fetch(`/editor/api/article/${articleId}/publish`, { method: 'POST' }))
  })

  const returnBtn = document.getElementById('return-btn')
  const noteInput = document.getElementById('return-note')
  if (returnBtn) returnBtn.addEventListener('click', () => {
    // same message as the server so it looks like one validation
    const note = noteInput.value
    if (!note.trim()) {
      showError('Write a note so the reporter knows what to fix')
      noteInput.focus()
      return
    }

    act(returnBtn, () => fetch(`/editor/api/article/${articleId}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note })
    }))
  })

  const deleteBtn = document.getElementById('delete-btn')
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!window.confirm('Delete this article? This cannot be undone.')) return
    showError('')
    deleteBtn.disabled = true

    const res = await fetch(`/editor/api/article/${articleId}`, {
      method: 'DELETE'
    }).catch(() => null)

    if (!res || !res.ok) {
      deleteBtn.disabled = false
      showError(!res ? 'Could not reach the server' : await readError(res))
      return
    }

    location.href = '/editor'
  })

  // --- comment moderation ---
  // comments are small enough to just reload after an edit
  document.querySelectorAll('[data-comment]').forEach(row => {
    const commentId = row.getAttribute('data-comment')
    const bodyEl = row.querySelector('[data-body]')
    const rowError = row.querySelector('[data-error]')
    const editBtn = row.querySelector('[data-edit]')
    const deleteCommentBtn = row.querySelector('[data-delete]')

    const showRowError = text => {
      rowError.textContent = text || ''
      rowError.hidden = !text
    }

    // each row flips between showing the text and editing it
    let input = null

    editBtn.addEventListener('click', async () => {
      if (!input) {
        showRowError('')
        input = document.createElement('textarea')
        input.rows = 3
        input.value = bodyEl.textContent
        input.setAttribute('aria-label', 'Edit comment')
        bodyEl.replaceWith(input)
        editBtn.textContent = 'Save'
        input.focus()
        return
      }

      editBtn.disabled = true
      const res = await fetch(`/editor/api/comments/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: input.value })
      }).catch(() => null)
      editBtn.disabled = false

      if (!res || !res.ok) {
        showRowError(!res ? 'Could not reach the server' : await readError(res))
        return
      }

      location.reload()
    })

    deleteCommentBtn.addEventListener('click', async () => {
      if (!window.confirm('Delete this comment?')) return
      showRowError('')

      const res = await fetch(`/editor/api/comments/${commentId}`, {
        method: 'DELETE'
      }).catch(() => null)

      if (!res || !res.ok) {
        showRowError(!res ? 'Could not reach the server' : await readError(res))
        return
      }

      row.remove()
      const left = document.querySelectorAll('[data-comment]').length
      document.getElementById('comments-count').textContent = String(left)
      document.getElementById('comments-empty').hidden = left > 0
    })
  })
})()
