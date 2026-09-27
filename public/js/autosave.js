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
  const submitHint = document.getElementById('submit-hint')

  let articleId = form.dataset.id || null
  let hasUnsavedChanges = false
  let idleTimer = null
  let ceilingTimer = null

  // form.elements, not form.title - every element has a .title property
  // (the tooltip) and it would shadow the input named "title"
  const getField = name => form.elements[name]

  // The image can be a few hundred KB, so it only rides along on the save
  // that changed it. The server keeps the stored one when the field is absent.
  let imageChanged = false

  function readForm() {
    const content = {
      title: getField('title').value,
      summary: getField('summary').value,
      body: getField('body').value,
      category: getField('category').value
    }
    if (imageChanged) content.imageUrl = getField('imageUrl').value
    return content
  }

  function showStatus(text, state = '') {
    if (!statusEl) return
    statusEl.textContent = text
    statusEl.className = 'save-status ' + state
  }

  // the error takes the hint's place so the bar does not grow
  function showSubmitError(text) {
    submitError.textContent = text
    submitError.hidden = false
    if (submitHint) submitHint.hidden = true
  }

  const isBlank = content => !content.title.trim() && !content.summary.trim() &&
                             !content.body.trim() && !(content.imageUrl || '').trim()

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
    const sendingImage = imageChanged
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

    if (sendingImage) imageChanged = false

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

  // --- image ---
  // The picture is read in the browser and stored as a data URI, so it sits in
  // the database with the article and everyone who opens the project sees it.
  // Saving the file to disk instead would leave it on one laptop.
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024

  const preview = document.getElementById('image-preview')
  const imageError = document.getElementById('image-error')
  const imageName = document.getElementById('image-name')
  const fileInput = document.getElementById('image-file')
  const pickBtn = document.getElementById('image-pick-btn')

  function showImageError(text) {
    if (!imageError) return
    imageError.textContent = text
    imageError.hidden = !text
  }

  // The picture goes to the server on its own and comes back as a path. Only
  // that short path is kept in the form, so the article document stays small
  // and the browser can cache the picture like any other image.
  async function sendImage(file) {
    if (file.size > MAX_IMAGE_BYTES) {
      showImageError(`That picture is ${Math.round(file.size / 1024)} KB, the limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB`)
      return
    }

    showImageError('')
    if (imageName) imageName.textContent = 'Uploading...'

    const res = await fetch('/reporter/api/image', {
      method: 'POST',
      headers: { 'Content-Type': file.type, 'X-Image-Name': file.name },
      body: file
    }).catch(() => null)

    if (!res || !res.ok) {
      if (imageName) imageName.textContent = 'No image yet'
      return showImageError('Could not upload that picture')
    }

    const data = await res.json()
    getField('imageUrl').value = data.url
    imageChanged = true
    if (imageName) imageName.textContent = file.name
    if (preview) {
      preview.src = data.url
      preview.hidden = false
    }
    // the hidden field fires no input events, so tell autosave directly
    form.dispatchEvent(new Event('input', { bubbles: true }))
  }

  if (pickBtn && fileInput) {
    pickBtn.addEventListener('click', () => fileInput.click())

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0]
      fileInput.value = ''   // so picking the same file twice still fires
      if (file) sendImage(file)
    })
  }

  // --- drag and drop ---
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
