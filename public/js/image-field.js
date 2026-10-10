// The image field on both article forms: choose or drop a picture, see it,
// remove it. The picture is uploaded on its own and comes back as a path;
// only that path is kept, in the hidden imagePath input, so the article
// stays small and the browser can cache the picture like any other image.
// onChange runs after the path changes, so the page can save the draft.
function setUpImageField({ uploadUrl, onChange }) {
  const field = document.querySelector('[data-image-field]')
  if (!field) return

  const MAX_BYTES = 2 * 1024 * 1024
  const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']

  const pathInput = field.querySelector('input[name="imagePath"]')
  const fileInput = field.querySelector('input[type="file"]')
  const drop = field.querySelector('.image-drop')
  const preview = field.querySelector('.image-preview')
  const nameEl = field.querySelector('.image-name')
  const removeBtn = field.querySelector('[data-image-remove]')
  const errorEl = field.querySelector('.error')

  function showError(text) {
    errorEl.textContent = text
    errorEl.hidden = !text
  }

  function setImage(path, name) {
    pathInput.value = path
    if (path) preview.src = path
    else preview.removeAttribute('src')
    preview.hidden = !path
    removeBtn.hidden = !path
    nameEl.textContent = name || 'No image yet'
  }

  async function upload(file) {
    // the server refuses these too, but could only say "no picture received"
    if (!TYPES.includes(file.type)) return showError('That file type is not supported - use PNG, JPEG, GIF, WebP or AVIF')
    if (file.size > MAX_BYTES) return showError(`That picture is ${Math.round(file.size / 1024)} KB, the limit is 2 MB`)

    showError('')
    const previousName = nameEl.textContent
    nameEl.textContent = 'Uploading…'

    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': file.type, 'X-Image-Name': file.name },
      body: file
    }).catch(() => null)

    if (!res || !res.ok) {
      nameEl.textContent = previousName
      return showError('Could not upload that picture')
    }

    const data = await res.json()
    setImage(data.url, file.name)
    onChange()
  }

  field.querySelector('[data-image-pick]').addEventListener('click', () => fileInput.click())

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0]
    fileInput.value = ''   // so picking the same file twice still fires
    if (file) upload(file)
  })

  removeBtn.addEventListener('click', () => {
    showError('')
    setImage('', '')
    onChange()
  })

  // the browser opens a dropped file in the tab unless both of these are stopped
  for (const name of ['dragenter', 'dragover']) {
    drop.addEventListener(name, event => {
      event.preventDefault()
      drop.classList.add('dragging')
    })
  }
  for (const name of ['dragleave', 'drop']) {
    drop.addEventListener(name, () => drop.classList.remove('dragging'))
  }
  drop.addEventListener('drop', event => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (file) upload(file)
  })
}
