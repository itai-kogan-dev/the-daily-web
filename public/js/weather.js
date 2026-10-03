// Fills the sidebar weather widget from /api/weather. Loaded by the sidebar
// partial, so every page that has the sidebar gets it.
(async () => {
  const widget = document.getElementById('weather-widget')
  if (!widget) return
  const body = widget.querySelector('.weather-body')

  try {
    const res = await fetch('/api/weather', { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error()
    const w = await res.json()

    const time = new Date(w.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const row = (label, value) => {
      const item = document.createElement('div')
      const dt = document.createElement('dt')
      const dd = document.createElement('dd')
      dt.textContent = label
      dd.textContent = value
      item.append(dt, dd)
      return item
    }

    const now = document.createElement('p')
    now.className = 'weather-now'
    const icon = document.createElement('span')
    icon.className = 'weather-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.textContent = w.icon
    const temp = document.createElement('span')
    temp.className = 'weather-temp'
    temp.textContent = `${w.temperature}°`
    const desc = document.createElement('span')
    desc.textContent = `${w.description} in ${w.city}`
    now.append(icon, temp, desc)

    const details = document.createElement('dl')
    details.className = 'weather-details'
    details.append(
      row('High / low', `${w.high}° / ${w.low}°`),
      row('Feels like', `${w.feelsLike}°`),
      row('Humidity', `${w.humidity}%`),
      row('Wind', `${w.wind} km/h`)
    )

    const updated = document.createElement('p')
    updated.className = 'muted weather-updated'
    updated.textContent = w.stale ? `Last known, from ${time}` : `Updated ${time}`

    body.replaceChildren(now, details, updated)
  } catch {
    body.innerHTML = '<p class="muted">Weather is not available right now.</p>'
  }
})()
