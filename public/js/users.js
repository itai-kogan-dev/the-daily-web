// Manage users: deleting from the list, and the create / edit form.
(function () {
  // --- the list ---
  document.querySelectorAll('[data-user]').forEach(row => {
    const deleteBtn = row.querySelector('[data-delete]')
    const errorEl = row.querySelector('[data-error]')
    if (!deleteBtn) return

    deleteBtn.addEventListener('click', async () => {
      const name = row.querySelector('.list-title').textContent.trim()
      if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return

      errorEl.hidden = true
      deleteBtn.disabled = true

      const res = await fetch(`/editor/api/users/${row.dataset.user}`, { method: 'DELETE' }).catch(() => null)
      if (!res || !res.ok) {
        deleteBtn.disabled = false
        errorEl.textContent = await readError(res)
        errorEl.hidden = false
        return
      }

      row.remove()
    })
  })

  // --- the form ---
  const form = document.getElementById('user-form')
  if (!form) return

  // empty on the new user form
  const accountId = form.dataset.id
  const errorEl = document.getElementById('user-error')

  function showError(text) {
    errorEl.textContent = text || ''
    errorEl.hidden = !text
  }

  form.addEventListener('submit', async event => {
    event.preventDefault()
    showError('')

    const payload = {
      username: form.elements.username.value,
      displayName: form.elements.displayName.value
    }
    // the role is only chosen when the account is created
    if (!accountId) payload.role = form.elements.role.value
    // a blank password on the edit form means keep the current one
    const password = form.elements.password.value
    if (!accountId || password) payload.password = password

    const res = await fetch(accountId ? `/editor/api/users/${accountId}` : '/editor/api/users', {
      method: accountId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => null)

    if (!res || !res.ok) return showError(await readError(res))
    location.href = '/editor/users'
  })

  const deleteBtn = document.getElementById('delete-btn')
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!window.confirm('Delete this account? This cannot be undone.')) return
    showError('')
    deleteBtn.disabled = true

    const res = await fetch(`/editor/api/users/${accountId}`, { method: 'DELETE' }).catch(() => null)
    if (!res || !res.ok) {
      deleteBtn.disabled = false
      return showError(await readError(res))
    }

    location.href = '/editor/users'
  })
})()
