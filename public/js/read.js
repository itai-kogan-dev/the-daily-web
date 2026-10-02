// Which articles this browser has opened. Guests have no account and no
// session, so the list lives in localStorage and never leaves the device. The
// feed's unread filter reads the same list. Shared by the article page, which
// records, and the feed page, which filters.
(function () {
  const KEY = 'the-daily-web:read'
  const MAX = 500

  function list() {
    try {
      const raw = window.localStorage.getItem(KEY)
      if (!raw) return []
      const ids = JSON.parse(raw)
      if (!Array.isArray(ids)) return []
      return ids.filter(id => typeof id === 'string' && id.length > 0)
    } catch {
      return []
    }
  }

  function has(id) {
    if (id === undefined || id === null) return false
    const value = String(id)
    if (!value) return false
    return list().indexOf(value) !== -1
  }

  function record(id) {
    if (id === undefined || id === null) return
    const value = String(id)
    if (!value) return
    try {
      // Newest first, capped. An old id falling off the end counts as unread
      // again, which for a news feed is the right direction.
      const ids = list().filter(existing => existing !== value)
      ids.unshift(value)
      window.localStorage.setItem(KEY, JSON.stringify(ids.slice(0, MAX)))
    } catch {
      // private mode or no storage: reading still works, the filter just will
      // not remember anything
    }
  }

  window.DailyWebRead = { list, has, record, KEY, MAX }
})()
