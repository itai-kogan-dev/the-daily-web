// The version tabs on the article pages: one panel shows at a time.
document.querySelectorAll('[role="tab"][data-tab]').forEach(tab => {
  tab.addEventListener('click', () => {
    for (const other of tab.parentElement.querySelectorAll('[role="tab"]')) {
      const selected = other === tab
      other.classList.toggle('active', selected)
      other.setAttribute('aria-selected', String(selected))
      document.getElementById(other.dataset.tab).hidden = !selected
    }
  })
})
