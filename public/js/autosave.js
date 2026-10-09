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

  // the error takes the hint's place so the bar does not grow
  function showSubmitError(text) {
    submitError.textContent = text
    submitError.hidden = false
    if (submitHint) submitHint.hidden = true
  }

  const isBlank = content => !content.title.trim() && !content.summary.trim() &&
                             !content.body.trim() && !content.imagePath.trim()

  // A copy in this browser, under this article's key, written on every
  // keystroke. The server is the truth - this only matters when a save never
  // reached it: a keepalive that the browser drops (they are capped around
  // 64KB, and a long body alone is bigger), or a tab killed mid-request.
  const backupKey = () => `the-daily-web:draft:${articleId || 'new'}`

  function writeBackup(dirty) {
    try {
      window.localStorage.setItem(backupKey(), JSON.stringify({
        content: readForm(),
        at: Date.now(),
        dirty
      }))
    } catch {
      // private mode or full storage: the server saves still work
    }
  }

  function readBackup() {
    try {
      const raw = window.localStorage.getItem(backupKey())
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || !parsed.content) return null
      return parsed
    } catch {
      return null
    }
  }

  // A save that never reached the server leaves dirty:true behind. If the
  // form still shows what the server rendered, the backup is newer - put it
  // back and queue a save, so nothing is silently lost.
  (function recoverBackup() {
    const saved = readBackup()
    if (!saved || !saved.dirty) return
    const current = readForm()
    const same = ['title', 'summary', 'body', 'category', 'imagePath']
      .every(name => (saved.content[name] || '') === (current[name] || ''))
    if (same) return
    const fields = { title: 'title', summary: 'summary', body: 'body', category: 'category', imagePath: 'imagePath' }
    for (const name of Object.keys(fields)) {
      if (typeof saved.content[name] === 'string') getField(name).value = saved.content[name]
    }
    hasUnsavedChanges = true
    showStatus('Recovered unsent changes', 'pending')
    clearTimeout(idleTimer)
    idleTimer = setTimeout(saveDraft, IDLE_MS)
  })()

  // One request at a time. While a first POST is still in flight the id is
  // unknown, so a second save would POST again and create the article twice.
  // Instead it waits for the first one and then saves as a PATCH, or skips
  // when there is nothing new left to send.
  let inflight = null

  // Logged out mid-edit (or the article left the reporter's hands): saving
  // again would fail the same way forever, so stop and say so instead.
  let stopped = false

  function showLoggedOut() {
    stopped = true
    hasUnsavedChanges = false
    clearTimeout(idleTimer)
    clearTimeout(ceilingTimer)
    ceilingTimer = null
    if (!statusEl) return
    statusEl.textContent = ''
    statusEl.className = 'save-status error'
    statusEl.append('Session ended. ', Object.assign(document.createElement('a'), {
      href: '/login',
      textContent: 'Log in again'
    }), ' - nothing will save until then.')
  }

  async function saveDraft() {
    if (!hasUnsavedChanges || stopped) return
    // typed something then deleted it again - nothing worth creating yet
    if (!articleId && isBlank(readForm())) {
      hasUnsavedChanges = false
      showStatus('')
      return
    }
    if (inflight) {
      await inflight.catch(() => null)
      if (!hasUnsavedChanges || stopped) return
    }
    clearTimeout(idleTimer)
    clearTimeout(ceilingTimer)
    ceilingTimer = null

    // clear the flag before the request, so anything typed while it is in
    // flight is not swallowed
    hasUnsavedChanges = false
    showStatus('Saving...')

    const run = (async () => {
      const isNew = !articleId
      const res = await fetch(isNew ? '/reporter/api/article' : `/reporter/api/article/${articleId}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(readForm())
      }).catch(() => null)

      // the server said the session is gone or the article is not ours to
      // save - retrying would loop forever on the same answer
      if (res && (res.status === 401 || res.status === 403)) {
        showLoggedOut()
        return
      }

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
        // a freshly created article is an unpublished in_progress draft, which
        // the reporter can always delete - reveal the button without a reload
        // so a false start can be removed straight away
        ensureDeleteButton()
      }

      // editing a published article moves it back to in_progress
      const badge = document.getElementById('status-badge')
      if (badge && data.statusLabel) {
        badge.textContent = data.statusLabel
        badge.className = 'badge status-' + data.status
      }

      writeBackup(false)
      showStatus('Saved ' + new Date(data.savedAt).toLocaleTimeString())
    })()

    inflight = run
    try {
      await run
    } finally {
      if (inflight === run) inflight = null
    }
  }

  form.addEventListener('input', () => {
    if (stopped) return
    hasUnsavedChanges = true
    showStatus('Unsaved changes', 'pending')
    writeBackup(true)

    clearTimeout(idleTimer)
    idleTimer = setTimeout(saveDraft, IDLE_MS)

    // someone typing without pause would otherwise never trigger the idle save
    if (!ceilingTimer) ceilingTimer = setTimeout(saveDraft, CEILING_MS)
  })

  // Closing the tab or switching away. keepalive lets the request outlive the
  // page - a normal fetch gets cancelled when the page goes. The check matters:
  // without it, opening a new article and closing it untouched would create one.
  // Large bodies (over ~64KB) may be dropped by the browser here; the backup
  // above already holds them and is restored on the next visit.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden' || !hasUnsavedChanges || stopped) return

    const isNew = !articleId
    fetch(isNew ? '/reporter/api/article' : `/reporter/api/article/${articleId}`, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(readForm()),
      keepalive: true
    })
  })

  // --- image ---
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024

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
  // Without this the server still refuses the file, but the message it can
  // give is "no picture received", which does not say what went wrong.
  const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']

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
    getField('imagePath').value = data.url
    if (imageName) imageName.textContent = file.name

    // The hidden field fires no input event of its own, so autosave is told
    // directly - and saved now rather than in a second and a half, so the
    // article points at the picture almost as soon as it is stored.
    form.dispatchEvent(new Event('input', { bubbles: true }))
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

  // --- delete ---
  // Only rendered for a draft that was never published. Autosave is stopped
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
    const container = document.querySelector('.sticky-bar .sticky-right')
    if (!container) return
    const btn = document.createElement('button')
    btn.id = 'delete-btn'
    btn.type = 'button'
    btn.className = 'button-secondary danger-text'
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
