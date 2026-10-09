(function () {
  const form = document.getElementById('review-form')
  if (!form || !form.dataset.id) return

  const articleId = form.dataset.id
  const statusEl = document.getElementById('review-status')
  const errorEl = document.getElementById('review-error')
  const badge = document.getElementById('status-badge')

  // form.elements, not form.title - same shadowing problem as the reporter form
  const getField = name => form.elements[name]

  const readForm = () => ({
    title: getField('title').value,
    summary: getField('summary').value,
    body: getField('body').value,
    category: getField('category').value,
    imagePath: getField('imagePath').value
  })

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

  // publish and send-back are only legal from pending_editor - the server
  // still 400s outside it, this just explains it instead of looking broken
  function currentStatus() {
    return form.dataset.status || ''
  }

  function waitingForApproval() {
    return form.dataset.status === 'pending_editor'
  }

  // the badge is the only thing that changes without a reload
  function refreshBadge(data) {
    if (badge && data.statusLabel) {
      badge.textContent = data.statusLabel
      badge.className = 'badge status-' + data.status
    }
  }

  const saveBtn = document.getElementById('save-btn')
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    showError('')
    showStatus('Saving...')
    saveBtn.disabled = true

    const res = await fetch(`/editor/api/article/${articleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(readForm())
    }).catch(() => null)

    saveBtn.disabled = false

    if (!res) {
      showStatus('', '')
      showError('Could not save, check your connection')
      return
    }

    if (!res.ok) {
      showStatus('', '')
      showError(await readError(res))
      return
    }

    const data = await res.json().catch(() => null)
    if (!data) {
      showStatus('', '')
      showError('Saved, but the reply was unreadable - reload to confirm')
      return
    }
    refreshBadge(data)
    showStatus('Saved ' + new Date(data.savedAt).toLocaleTimeString())
  })

  const publishBtn = document.getElementById('publish-btn')
  if (publishBtn) publishBtn.addEventListener('click', async () => {
    showError('')
    if (!waitingForApproval()) {
      showError('Only articles waiting for approval can be published')
      return
    }
    publishBtn.disabled = true

    const res = await fetch(`/editor/api/article/${articleId}/publish`, {
      method: 'POST'
    }).catch(() => null)

    if (!res) {
      publishBtn.disabled = false
      showError('Could not reach the server')
      return
    }

    if (!res.ok) {
      publishBtn.disabled = false
      showError(await readError(res))
      return
    }

    location.reload()
  })

  const returnBtn = document.getElementById('return-btn')
  const noteInput = document.getElementById('return-note')
  if (returnBtn) returnBtn.addEventListener('click', async () => {
    showError('')

    // same message as the server so it looks like one validation
    const note = noteInput ? noteInput.value : ''
    if (!note.trim()) {
      showError('Write a note so the reporter knows what to fix')
      return
    }

    if (!waitingForApproval()) {
      showError('Only articles waiting for approval can be sent back')
      return
    }

    returnBtn.disabled = true

    const res = await fetch(`/editor/api/article/${articleId}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note })
    }).catch(() => null)

    if (!res) {
      returnBtn.disabled = false
      showError('Could not reach the server')
      return
    }

    if (!res.ok) {
      returnBtn.disabled = false
      showError(await readError(res))
      return
    }

    location.reload()
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
      showError(!res ? 'Server unreachable, try again' : await readError(res))
      return
    }

    location.href = '/editor'
  })

  // comments are small enough to just reload after an edit
  document.querySelectorAll('[data-comment]').forEach(row => {
    const commentId = row.getAttribute('data-comment')
    const bodyEl = row.querySelector('[data-body]')
    const rowError = row.querySelector('[data-error]')
    const editBtn = row.querySelector('[data-edit]')
    const deleteBtnEl = row.querySelector('[data-delete]')

    const showRowError = text => {
      if (!rowError) return
      rowError.textContent = text || ''
      rowError.hidden = !text
    }

    if (editBtn && bodyEl) {
      // each row flips between showing text and editing it
      let editing = false

      editBtn.addEventListener('click', async () => {
        if (!editing) {
          if (row.querySelector('textarea')) return
          editing = true
          showRowError('')

          const input = document.createElement('textarea')
          input.rows = 3
          input.value = bodyEl.textContent
          input.setAttribute('aria-label', 'Edit comment')
          bodyEl.replaceWith(input)
          editBtn.textContent = 'Save'
          input.focus()
          return
        }

        const input = row.querySelector('textarea')
        if (!input) {
          editing = false
          editBtn.textContent = 'Edit'
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
    }

    if (deleteBtnEl) deleteBtnEl.addEventListener('click', async () => {
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

      const countEl = document.getElementById('comments-count')
      if (countEl) {
        const left = document.querySelectorAll('[data-comment]').length
        countEl.textContent = String(left)
        if (left === 0) {
          const list = document.querySelector('.comment-list')
          if (list) list.remove()
          const box = document.querySelector('.comments-box')
          if (box && !box.querySelector('.muted')) {
            const empty = document.createElement('p')
            empty.className = 'muted'
            empty.textContent = 'No comments yet.'
            box.appendChild(empty)
          }
        }
      }
    })
  })
})()
