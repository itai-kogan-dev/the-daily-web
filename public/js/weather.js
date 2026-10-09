// Fills the sidebar weather widget from /api/weather. Loaded by the sidebar
// partial, so every page that has the sidebar gets it.
//
// The default place shows straight away, then we ask the browser where the
// reader is and swap in their weather if they let us. Nothing waits on the
// permission prompt, and saying no just leaves the default.
(() => {
  const widget = document.getElementById('weather-widget')
  const body = widget && widget.querySelector('.weather-body')
  if (!body) return

  // A tenth of a degree is about 11 km - enough for weather, and the most
  // precise location that ever leaves the browser.
  const round = value => Math.round(value * 10) / 10
  const STORE_KEY = 'weather-coords'

  // Remembered for the visit, so the next page goes straight to the reader's
  // weather instead of showing the default first and then switching.
  function savedCoords() {
    try { return JSON.parse(sessionStorage.getItem(STORE_KEY)) } catch { return null }
  }
  function saveCoords(coords) {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(coords)) } catch { /* private mode */ }
  }

  function row(label, value) {
    const item = document.createElement('div')
    const dt = document.createElement('dt')
    const dd = document.createElement('dd')
    dt.textContent = label
    dd.textContent = value
    item.append(dt, dd)
    return item
  }

  function render(w) {
    const time = new Date(w.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

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
    desc.textContent = w.city ? `${w.description} in ${w.city}` : `${w.description} near you`
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
  }

  function showError() {
    const p = document.createElement('p')
    p.className = 'muted'
    p.textContent = 'Weather is not available right now.'
    body.replaceChildren(p)
  }

  // the two requests can finish in either order - a cached position answers
  // instantly - and the default must never replace the reader's own weather
  let showingLocal = false

  async function load(coords) {
    const query = coords ? `?lat=${coords.lat}&lon=${coords.lon}` : ''
    const res = await fetch('/api/weather' + query, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error()
    const weather = await res.json()
    if (!coords && showingLocal) return
    if (coords) showingLocal = true
    render(weather)
  }

  const known = savedCoords()
  if (known) {
    // their place failed (service down for it, say) -> the default beats nothing
    load(known).catch(() => load().catch(showError))
    return
  }

  load().catch(() => { if (!showingLocal) showError() })

  if (!navigator.geolocation) return
  navigator.geolocation.getCurrentPosition(
    position => {
      const coords = { lat: round(position.coords.latitude), lon: round(position.coords.longitude) }
      saveCoords(coords)
      // if this fails the default is already on screen, so leave it there
      load(coords).catch(() => {})
    },
    () => { /* denied, unavailable or timed out - the default stays */ },
    // a position from the last 30 minutes is fine for weather, and is instant
    { timeout: 8000, maximumAge: 30 * 60 * 1000 }
  )
})()
