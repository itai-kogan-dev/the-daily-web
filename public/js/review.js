// The editor's review page: autosave and the picture while the article waits
// for approval, publish, send back, delete, and comment moderation.
(function () {
  const page = document.querySelector('main[data-article]')
  if (!page) return

  const articleId = page.dataset.article
  const errorEl = document.getElementById('review-error')

  function showError(text) {
    errorEl.textContent = text || ''
    errorEl.hidden = !text
  }

  // the form is only on the page while the article waits for approval
  const form = document.getElementById('review-form')
  let autosave = null

  if (form) {
    autosave = setUpAutosave({
      form,
      statusEl: document.getElementById('review-status'),
      send: (content, keepalive) => fetch(`/editor/api/article/${articleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content),
        keepalive
      })
    })

    // a new picture is saved straight away rather than after the idle wait
    setUpImageField({
      uploadUrl: '/editor/api/image',
      onChange: () => {
        autosave.changed()
        autosave.save()
      }
    })
  }

  // Publish and send back both take what the editor saw, so anything still
  // waiting to be saved goes first.
  async function act(button, request) {
    showError('')
    button.disabled = true
    if (autosave && !(await autosave.save())) {
      button.disabled = false
      showError('Your latest changes could not be saved, so nothing was sent')
      return
    }

    const res = await request().catch(() => null)
    if (!res || !res.ok) {
      button.disabled = false
      showError(await readError(res))
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

    const res = await fetch(`/editor/api/article/${articleId}`, { method: 'DELETE' }).catch(() => null)
    if (!res || !res.ok) {
      deleteBtn.disabled = false
      showError(await readError(res))
      return
    }

    location.href = '/editor'
  })

  // --- comment moderation ---
  // comments are small enough to just reload after an edit
  document.querySelectorAll('[data-comment]').forEach(row => {
    const commentId = row.dataset.comment
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

      if (!res || !res.ok) return showRowError(await readError(res))
      location.reload()
    })

    deleteCommentBtn.addEventListener('click', async () => {
      if (!window.confirm('Delete this comment?')) return
      showRowError('')

      const res = await fetch(`/editor/api/comments/${commentId}`, { method: 'DELETE' }).catch(() => null)
      if (!res || !res.ok) return showRowError(await readError(res))

      row.remove()
      const left = document.querySelectorAll('[data-comment]').length
      document.getElementById('comments-count').textContent = String(left)
      document.getElementById('comments-empty').hidden = left > 0
    })
  })
})()
