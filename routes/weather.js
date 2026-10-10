const express = require('express')
const weather = require('../controllers/weatherController')

const router = express.Router()

router.get('/', weather.showWeather)

module.exports = router
