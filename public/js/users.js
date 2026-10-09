// Staff account management. The list page deletes rows in place; the form
// page creates or updates one account. Both speak to /editor/api/users.

(function () {
  async function readError(res) {
    try {
      const data = await res.json()
      return data.error || 'Something went wrong'
    } catch {
      return 'Something went wrong'
    }
  }

  // --- list page: delete in place ---
  const list = document.getElementById('user-list')
  if (list) {
    list.addEventListener('click', async event => {
      const button = event.target.closest('[data-delete]')
      if (!button) return
      const row = button.closest('[data-user]')
      const errorEl = row && row.querySelector('[data-error]')
      if (!row) return

      if (!window.confirm('Delete this account? They will not be able to log in.')) return
      button.disabled = true
      if (errorEl) errorEl.hidden = true

      const res = await fetch(`/editor/api/users/${row.dataset.user}`, {
        method: 'DELETE'
      }).catch(() => null)

      if (!res || !res.ok) {
        button.disabled = false
        if (errorEl) {
          errorEl.textContent = !res ? 'Could not reach the server' : await readError(res)
          errorEl.hidden = false
        }
        return
      }

      row.remove()
    })
  }

  // --- form page: create / update ---
  const form = document.getElementById('user-form')
  if (form) {
    const errorEl = document.getElementById('user-error')
    const saveBtn = document.getElementById('user-save')
    const deleteBtn = document.getElementById('user-delete')
    const userId = form.dataset.id || null

    const showError = text => {
      if (!errorEl) return
      errorEl.textContent = text || ''
      errorEl.hidden = !text
    }

    form.addEventListener('submit', async event => {
      event.preventDefault()
      showError('')
      saveBtn.disabled = true

      const body = {
        username: form.elements.username.value,
        displayName: form.elements.displayName.value,
        role: form.elements.role.value,
        password: form.elements.password.value
      }
      // a blank password on edit means "keep the current one"
      if (userId && !body.password) delete body.password

      const res = await fetch(userId ? `/editor/api/users/${userId}` : '/editor/api/users', {
        method: userId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).catch(() => null)

      if (!res || !res.ok) {
        saveBtn.disabled = false
        showError(!res ? 'Could not reach the server' : await readError(res))
        return
      }

      location.href = '/editor/users'
    })

    if (deleteBtn && userId) {
      deleteBtn.addEventListener('click', async () => {
        if (!window.confirm('Delete this account? They will not be able to log in.')) return
        showError('')
        deleteBtn.disabled = true

        const res = await fetch(`/editor/api/users/${userId}`, {
          method: 'DELETE'
        }).catch(() => null)

        if (!res || !res.ok) {
          deleteBtn.disabled = false
          showError(!res ? 'Could not reach the server' : await readError(res))
          return
        }

        location.href = '/editor/users'
      })
    }
  }
})()
