// Paging for the staff lists (editor queue, reporter dashboard): 50 rows a
// page, so thousands of articles never become one huge page.
const PAGE_SIZE = 50

// A page number from the query string: a whole number from 1 to max. Anything
// else - missing, "abc", -5 - reads as page 1.
function readPage(value, max) {
  return Math.min(max, Math.max(1, parseInt(value, 10) || 1))
}

// Which page to show and the links around it. path is the list's own URL;
// status, when set, is kept on every link so paging does not drop the filter.
function buildPager(path, status, requested, total) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = readPage(requested, pages)
  const href = n => `${path}?` + (status ? `status=${status}&` : '') + `page=${n}`

  return {
    page,
    pages,
    skip: (page - 1) * PAGE_SIZE,
    prevHref: page > 1 ? href(page - 1) : null,
    nextHref: page < pages ? href(page + 1) : null
  }
}

module.exports = { PAGE_SIZE, readPage, buildPager }
