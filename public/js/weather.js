// Fills the sidebar weather widget from /api/weather, for wherever the browser
// says the reader is. There is no default city - weather for somewhere else
// would look like theirs - so without a location it says why instead.
(() => {
  const widget = document.getElementById('weather-widget')
  const body = widget && widget.querySelector('.weather-body')
  if (!body) return

  // A tenth of a degree is about 11 km - enough for weather, and the most
  // precise location that ever leaves the browser.
  const round = value => Math.round(value * 10) / 10
  const STORE_KEY = 'weather-coords'

  // Remembered for the visit, so the next page goes straight to the weather
  // instead of waiting for the browser to find the reader again.
  function savedCoords() {
    try { return JSON.parse(sessionStorage.getItem(STORE_KEY)) } catch { return null }
  }
  function saveCoords(coords) {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(coords)) } catch { /* private mode */ }
  }

  function buildRow(label, value) {
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
    desc.textContent = w.description
    now.append(icon, temp, desc)

    // the place goes on a line of its own: it is how the reader knows the
    // weather is theirs
    const place = document.createElement('p')
    place.className = 'weather-place'
    place.textContent = w.city ? `In ${w.city}` : 'Near you'

    const details = document.createElement('dl')
    details.className = 'weather-details'
    details.append(
      buildRow('High / low', `${w.high}° / ${w.low}°`),
      buildRow('Feels like', `${w.feelsLike}°`),
      buildRow('Humidity', `${w.humidity}%`),
      buildRow('Wind', `${w.wind} km/h`)
    )

    const updated = document.createElement('p')
    updated.className = 'muted weather-updated'
    updated.textContent = w.stale ? `Last known, from ${time}` : `Updated ${time}`

    body.replaceChildren(place, now, details, updated)
  }

  // A message, and optionally a button that tries again.
  function showMessage(text, retryLabel) {
    const p = document.createElement('p')
    p.className = 'muted'
    p.textContent = text
    const parts = [p]
    if (retryLabel) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'btn btn-sm'
      button.textContent = retryLabel
      button.addEventListener('click', locate)
      parts.push(button)
    }
    body.replaceChildren(...parts)
  }

  let showing = false   // the reader's weather is on screen

  async function load(coords) {
    try {
      const res = await fetch(`/api/weather?lat=${coords.lat}&lon=${coords.lon}`, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error()
      render(await res.json())
      showing = true
    } catch {
      if (!showing) showMessage("Weather isn't available for your area right now.", 'Try again')
    }
  }

  let locating = false

  function locate() {
    if (locating) return
    locating = true
    if (!showing) showMessage('Finding your location…')

    navigator.geolocation.getCurrentPosition(
      position => {
        locating = false
        const coords = { lat: round(position.coords.latitude), lon: round(position.coords.longitude) }
        saveCoords(coords)
        load(coords)
      },
      error => {
        locating = false
        if (showing) return
        if (error.code === error.PERMISSION_DENIED) {
          // also what a dismissed prompt reports. The button asks again when
          // the browser still can; when it can't, the text says what to do
          showMessage('Allow location access for this site to see the weather where you are.', 'Use my location')
        } else {
          showMessage("We couldn't find your location, so weather isn't available right now.", 'Try again')
        }
      },
      // the first position after allowing access can be slow, so wait up to
      // 30s; one from the last 30 minutes is fine for weather
      { timeout: 30000, maximumAge: 30 * 60 * 1000 }
    )
  }

  if (!navigator.geolocation) {
    showMessage("Your browser can't share a location, so weather isn't available here.")
    return
  }

  const known = savedCoords()
  if (known) load(known)
  else locate()

  // If the reader changes the permission while the page is open - allows it
  // from the address bar after saying no, say - look again right away
  // instead of waiting for a reload.
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(status => {
      status.addEventListener('change', () => {
        if (status.state === 'granted' && !showing) locate()
      })
    }).catch(() => { /* not supported for geolocation here */ })
  }
})()
