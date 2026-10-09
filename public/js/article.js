// Posting a comment without reloading the article, so a reader does not lose
// their place and the page does not jump back to the top.

const form = document.getElementById('comment-form')
const listEl = document.getElementById('comment-list')
const countEl = document.getElementById('comment-count')
const emptyEl = document.getElementById('comment-empty')
const errorEl = document.getElementById('comment-error')
const busyEl = document.getElementById('comment-busy')
const submitBtn = document.getElementById('comment-submit')

if (form && listEl) {
  // form.elements, not form.body - every element has a .body property
  const authorInput = form.elements.authorName
  const bodyInput = form.elements.body
  const articleId = form.dataset.article

  // Opening the article marks it read for this browser only. It never leaves
  // the device; the feed's unread filter reads the same list.
  try {
    if (window.DailyWebRead) window.DailyWebRead.record(articleId)
  } catch {
    // recording is best effort; the article itself must always render
  }

  // A second press while the first is still in flight would post the same
  // comment twice.
  let sending = false

  function showError(text) {
    if (!errorEl) return
    errorEl.textContent = text
    errorEl.hidden = !text
  }

  function setBusy(text) {
    if (busyEl) busyEl.textContent = text
    if (submitBtn) submitBtn.disabled = Boolean(text)
  }

  // The same nodes views/article.ejs renders, so a new comment is
  // indistinguishable from one that arrived with the page.
  function buildComment(comment) {
    const item = document.createElement('li')
    item.className = 'comment'
    item.id = `comment-${comment.id}`

    const head = document.createElement('div')
    head.className = 'comment-head'

    const author = document.createElement('span')
    author.className = 'comment-author'
    // textContent, never innerHTML: a comment is typed by anyone at all
    author.textContent = comment.authorName
    head.append(author)

    const time = document.createElement('time')
    time.dateTime = comment.createdAt
    time.textContent = new Date(comment.createdAt).toLocaleString()
    head.append(time)

    const body = document.createElement('p')
    body.className = 'comment-body'
    body.textContent = comment.body

    item.append(head, body)
    return item
  }

  function bumpCount() {
    if (countEl) countEl.textContent = String(Number(countEl.textContent || 0) + 1)
  }

  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (sending) return

    showError('')
    sending = true
    setBusy('Posting...')

    let comment
    try {
      const res = await fetch(`/api/articles/${articleId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorName: authorInput.value.trim(),
          body: bodyInput.value.trim()
        })
      })

      // The rate limiter and the validation errors both answer with
      // { error }, so one place turns them into something readable.
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not post that comment')
      comment = data
    } catch (err) {
      showError(err.message || 'Could not post that comment')
      sending = false
      setBusy('')
      return
    }

    const item = buildComment(comment)
    listEl.append(item)
    listEl.hidden = false
    if (emptyEl) emptyEl.hidden = true
    bumpCount()

    // only the text is cleared, so a name typed once is not typed again
    bodyInput.value = ''

    sending = false
    setBusy('')

    // the new comment is the reason the reader is still here
    item.scrollIntoView({ block: 'nearest' })
  })
}
