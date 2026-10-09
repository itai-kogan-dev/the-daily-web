// Autosave for both article forms - the reporter's and the editor's. There
// is no save button: the spec says work has to survive a refresh, a closed
// browser, or moving to another machine, so drafts go to the server rather
// than to localStorage.
//
// send(content, keepalive) makes the request and returns the fetch response.
// onSaved(data) gets the server's answer. skip(content) can say there is
// nothing worth saving yet. Returns the controls the page's buttons need.
function setUpAutosave({ form, statusEl, send, onSaved = () => {}, skip = () => false }) {
  const IDLE_MS = 1500     // save this long after typing stops
  const CEILING_MS = 10000 // ...but never go longer than this while typing

  let unsaved = false
  let idleTimer = null
  let ceilingTimer = null

  // form.elements, not form.title - every element has a .title property
  // (the tooltip) and it would shadow the input named "title"
  const readForm = () => ({
    title: form.elements.title.value,
    summary: form.elements.summary.value,
    body: form.elements.body.value,
    category: form.elements.category.value,
    imagePath: form.elements.imagePath.value
  })

  function showStatus(text, state = '') {
    statusEl.textContent = text
    statusEl.className = 'save-status ' + state
  }

  function stop() {
    unsaved = false
    clearTimeout(idleTimer)
    clearTimeout(ceilingTimer)
    ceilingTimer = null
  }

  async function run(keepalive) {
    if (!unsaved) return
    const content = readForm()
    // cleared before the request, so anything typed while it is in flight
    // is not swallowed
    stop()
    if (skip(content)) return showStatus('')

    showStatus('Saving...')
    const res = await send(content, keepalive).catch(() => null)

    // the network: try again. The server saying no: show why, because
    // sending the same thing again would only fail the same way
    if (!res) {
      unsaved = true
      showStatus('Could not save, retrying...', 'error')
      setTimeout(save, 3000)
      return
    }
    if (!res.ok) return showStatus(await readError(res), 'error')

    const data = await res.json()
    onSaved(data)

    // editing a published article moves it back to in progress
    const badge = document.getElementById('status-badge')
    if (badge && data.statusLabel) {
      badge.textContent = data.statusLabel
      badge.className = 'badge status-' + data.status
    }
    showStatus('Saved ' + new Date(data.savedAt).toLocaleTimeString())
  }

  // Saves run one after another. Two at once could both create the same new
  // article, or race each other to the server. keepalive lets the request
  // outlive the page when the tab is closing.
  let queue = Promise.resolve()
  function save({ keepalive = false } = {}) {
    queue = queue.then(() => run(keepalive)).catch(() => showStatus('Could not save', 'error'))
    return queue
  }

  function changed() {
    unsaved = true
    showStatus('Unsaved changes', 'pending')

    clearTimeout(idleTimer)
    idleTimer = setTimeout(save, IDLE_MS)

    // someone typing without pause would otherwise never trigger the idle save
    if (!ceilingTimer) ceilingTimer = setTimeout(save, CEILING_MS)
  }

  form.addEventListener('input', changed)

  // closing the tab or switching away
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save({ keepalive: true })
  })

  return { save, changed, stop }
}
