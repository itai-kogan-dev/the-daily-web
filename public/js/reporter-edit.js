// The reporter's article editor: autosave, the picture, delete and send.
// The page is read only, with no form, while the article is with the editor.

const form = document.getElementById('article-form')

if (form) {
  const submitBtn = document.getElementById('submit-btn')
  const submitError = document.getElementById('submit-error')
  const submitHint = document.getElementById('submit-hint')

  // empty until the first save creates the article
  let articleId = form.dataset.id || null

  const isBlank = content => !content.title.trim() && !content.summary.trim() &&
                             !content.body.trim() && !content.imagePath.trim()

  // the error takes the hint's place
  function showSubmitError(text) {
    submitError.textContent = text
    submitError.hidden = false
    if (submitHint) submitHint.hidden = true
  }

  const autosave = setUpAutosave({
    form,
    statusEl: document.getElementById('save-status'),
    // typed something then deleted it again - nothing worth creating yet
    skip: content => !articleId && isBlank(content),
    exists: () => Boolean(articleId),
    send: (content, keepalive) => fetch(articleId ? `/reporter/api/article/${articleId}` : '/reporter/api/article', {
      method: articleId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(content),
      keepalive
    }),
    onSaved: data => {
      if (articleId) return
      articleId = data.id
      form.dataset.id = data.id
      // so a refresh lands on the real article instead of the empty form
      history.replaceState(null, '', `/reporter/article/${data.id}`)
      // a new article is an unpublished draft, which the reporter can always
      // delete - show the button now so a false start can be removed
      addDeleteButton()
    }
  })

  // a new picture is saved straight away rather than after the idle wait
  setUpImageField({
    uploadUrl: '/reporter/api/image',
    onChange: () => {
      autosave.markChanged()
      autosave.save()
    }
  })

  // --- delete ---
  // Only shown for a draft that was never published. Autosave is stopped
  // first, so a save cannot land on an article that no longer exists.
  async function deleteDraft(button) {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return

    autosave.stop()
    button.disabled = true

    const res = await fetch(`/reporter/api/article/${articleId}`, { method: 'DELETE' }).catch(() => null)
    if (!res || !res.ok) {
      button.disabled = false
      showSubmitError(await readError(res))
      return
    }

    location.href = '/reporter'
  }

  function addDeleteButton() {
    if (document.getElementById('delete-btn')) return
    const button = document.createElement('button')
    button.id = 'delete-btn'
    button.type = 'button'
    button.className = 'btn btn-danger'
    button.textContent = 'Delete draft'
    button.addEventListener('click', () => deleteDraft(button))
    document.getElementById('side-actions').append(button)
  }

  const deleteBtn = document.getElementById('delete-btn')
  if (deleteBtn) deleteBtn.addEventListener('click', () => deleteDraft(deleteBtn))

  // --- send to editor ---
  submitBtn.addEventListener('click', async () => {
    submitError.hidden = true
    if (submitHint) submitHint.hidden = false
    submitBtn.disabled = true

    // flush anything still waiting, or we would submit a stale draft
    if (!(await autosave.save())) {
      showSubmitError('Your latest changes could not be saved, so nothing was sent')
      submitBtn.disabled = false
      return
    }

    // still nothing saved, so there is no article to send
    if (!articleId) {
      showSubmitError('Write something first')
      submitBtn.disabled = false
      return
    }

    const res = await fetch(`/reporter/api/article/${articleId}/submit`, { method: 'POST' }).catch(() => null)
    if (!res || !res.ok) {
      showSubmitError(await readError(res))
      submitBtn.disabled = false
      return
    }

    // reload so the page comes back read only, with the new status
    location.reload()
  })
}
