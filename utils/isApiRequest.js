// API routes answer with JSON, pages with HTML - for errors and for the login
// check alike. originalUrl and not path, because path is relative to where the
// router is mounted - but without the query string, or a search for "/api/"
// would turn a page into JSON.
function isApiRequest(req) {
  return req.originalUrl.split('?')[0].includes('/api/')
}

module.exports = { isApiRequest }
