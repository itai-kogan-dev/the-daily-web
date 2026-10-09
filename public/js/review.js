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

  // the badge is the only thing that changes without a reload
  function refreshBadge(data) {
    if (badge && data.statusLabel) {
      badge.textContent = data.statusLabel
      badge.className = 'badge status-' + data.status
    }
  }

  if (form) setUpEditing()

  // editing, the image picker, publish and send back
  function setUpEditing() {
    // form.elements, not form.title - same shadowing problem as the reporter form
    const getField = name => form.elements[name]

    const readForm = () => ({
      title: getField('title').value,
      summary: getField('summary').value,
      body: getField('body').value,
      category: getField('category').value,
      imagePath: getField('imagePath').value
    })

    // --- autosave ---
    // No reliance on the Save button: typing goes to the server on its own, so
    // an editor's in-progress draft survives a refresh or another computer.
    const IDLE_MS = 1500     // save this long after typing stops
    const CEILING_MS = 10000 // ...but never go longer than this while typing

    let hasUnsavedChanges = false
    let idleTimer = null
    let ceilingTimer = null

    async function saveDraft() {
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
        body: JSON.stringify(readForm())
      }).catch(() => null)

      // the server said no (bad image path and the like) - show it instead of
      // retrying something that will fail the same way again
      if (res && !res.ok) {
        showStatus('', '')
        showError(await readError(res))
        return
      }

      if (!res) {
        hasUnsavedChanges = true
        showStatus('Could not save, retrying...', 'error')
        setTimeout(saveDraft, 3000)
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
    }

    const preview = document.getElementById('image-preview')
    const removeBtn = document.getElementById('image-remove-btn')

    // the hidden field is set only by the picker, show its picture when valid
    function syncPreview() {
      const field = getField('imagePath')
      const value = field ? field.value.trim() : ''
      if (!value) {
        if (preview) {
          preview.hidden = true
          preview.removeAttribute('src')
        }
        if (removeBtn) removeBtn.hidden = true
        return
      }
      if (/^\/images\/[a-f0-9]{24}$/i.test(value)) {
        if (preview) {
          preview.src = value
          preview.hidden = false
        }
        if (removeBtn) removeBtn.hidden = false
      }
    }

    form.addEventListener('input', () => {
      hasUnsavedChanges = true
      showStatus('Unsaved changes', 'pending')
      syncPreview()

      clearTimeout(idleTimer)
      idleTimer = setTimeout(saveDraft, IDLE_MS)

      // someone typing without pause would otherwise never trigger the idle save
      if (!ceilingTimer) ceilingTimer = setTimeout(saveDraft, CEILING_MS)
    })

    // closing the tab or switching away - keepalive lets the request outlive
    // the page, a normal fetch gets cancelled when the page goes
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden' || !hasUnsavedChanges) return

      fetch(`/editor/api/article/${articleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(readForm()),
        keepalive: true
      })
    })

    const saveBtn = document.getElementById('save-btn')
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      showError('')
      showStatus('Saving...')
      saveBtn.disabled = true
      hasUnsavedChanges = true

      await saveDraft()

      saveBtn.disabled = false
    })

    // --- image ---
    // The picture goes to the server on its own and comes back as a path. Only
    // that short path is kept in the form, so the draft stays small and the
    // browser can cache the picture like any other image.
    const MAX_IMAGE_BYTES = 2 * 1024 * 1024
    const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']

    const imageError = document.getElementById('image-error')
    const imageName = document.getElementById('image-name')
    const fileInput = document.getElementById('image-file')
    const pickBtn = document.getElementById('image-pick-btn')

    function showImageError(text) {
      if (!imageError) return
      imageError.textContent = text
      imageError.hidden = !text
    }

    async function sendImage(file) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        showImageError('That file type is not supported - use PNG, JPEG, GIF, WebP or AVIF')
        return
      }

      if (file.size > MAX_IMAGE_BYTES) {
        showImageError(`That picture is ${Math.round(file.size / 1024)} KB, the limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB`)
        return
      }

      showImageError('')
      if (imageName) imageName.textContent = 'Uploading...'

      const res = await fetch('/editor/api/image', {
        method: 'POST',
        headers: { 'Content-Type': file.type, 'X-Image-Name': file.name },
        body: file
      }).catch(() => null)

      if (!res || !res.ok) {
        if (imageName) imageName.textContent = 'No image yet'
        return showImageError('Could not upload that picture')
      }

      const data = await res.json()
      const pathField = getField('imagePath')
      if (pathField) pathField.value = data.url
      if (imageName) imageName.textContent = file.name
      syncPreview()
      if (removeBtn) removeBtn.hidden = false

      // the path field fires no input event of its own, so autosave is told
      // directly - and saved now rather than in a second and a half, so the
      // draft points at the picture almost as soon as it is stored
      hasUnsavedChanges = true
      saveDraft()
    }

    if (pickBtn && fileInput) {
      pickBtn.addEventListener('click', () => fileInput.click())

      fileInput.addEventListener('change', () => {
        const file = fileInput.files[0]
        fileInput.value = ''   // so picking the same file twice still fires
        if (file) sendImage(file)
      })
    }

    if (removeBtn) removeBtn.addEventListener('click', () => {
      const pathField = getField('imagePath')
      if (pathField) pathField.value = ''
      if (preview) {
        preview.hidden = true
        preview.removeAttribute('src')
      }
      if (imageName) imageName.textContent = 'No image yet'
      showImageError('')
      removeBtn.hidden = true
      hasUnsavedChanges = true
      saveDraft()
    })

    const dropZone = document.getElementById('image-drop')

    if (dropZone) {
      // the browser opens a dropped file in the tab unless both of these are stopped
      for (const name of ['dragenter', 'dragover']) {
        dropZone.addEventListener(name, event => {
          event.preventDefault()
          dropZone.classList.add('dragging')
        })
      }
      for (const name of ['dragleave', 'drop']) {
        dropZone.addEventListener(name, () => dropZone.classList.remove('dragging'))
      }

      dropZone.addEventListener('drop', event => {
        event.preventDefault()
        const file = event.dataTransfer.files[0]
        if (file) sendImage(file)
      })
    }

    const publishBtn = document.getElementById('publish-btn')
    if (publishBtn) publishBtn.addEventListener('click', async () => {
      showError('')
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
  }

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
