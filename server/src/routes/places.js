const express = require('express');
const axios = require('axios');
const { requireAuth } = require('../middleware/auth');
const { mapsGuard } = require('../middleware/usageMeter');
const { routeLeg } = require('../services/geo');
const TravelLeg = require('../models/TravelLeg');

const router = express.Router();
router.use(requireAuth);
// Maps is unlimited on every tier; this only caps runaway per-household volume.
router.use(mapsGuard());

const BASE = 'https://places.googleapis.com/v1';
const LEG_FRESH_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

router.get('/autocomplete', async (req, res) => {
  const { query, type, lat, lon, country } = req.query;
  if (!query || query.trim().length < 2) return res.json({ predictions: [] });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Google Places API key not configured' });

  // Bias results toward the household's locale so a generic query ("beach")
  // ranks nearby places over globally prominent ones. Coords come from the
  // client (post-drop the server can't read the encrypted home location) or,
  // pre-drop, from the plaintext coords the weather geocoder caches on the
  // household. The client's holiday-calendar country is the coarse fallback.
  const hh = req.household || req.user;
  const qLat = Number(lat);
  const qLon = Number(lon);
  const biasLat = Number.isFinite(qLat) ? qLat : hh?.lat;
  const biasLon = Number.isFinite(qLon) ? qLon : hh?.lon;
  const hasCoords = Number.isFinite(biasLat) && Number.isFinite(biasLon);
  const region = typeof country === 'string' && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null;

  try {
    const body = { input: query };
    if (hasCoords) {
      // 50 km is the API's max circle radius — roughly "my metro area".
      body.locationBias = { circle: { center: { latitude: biasLat, longitude: biasLon }, radius: 50000 } };
    }
    if (type === 'address') {
      body.includedPrimaryTypes = ['street_address', 'route', 'premise', 'subpremise'];
      body.includedRegionCodes = [region ?? 'CA'];
    } else if (type === 'city') {
      // Cities worldwide (no region restriction) for trip destinations
      body.includedPrimaryTypes = ['(cities)'];
    } else if (type === 'airport') {
      body.includedPrimaryTypes = ['airport'];
    } else if (type === 'transit') {
      // Train stations, ferry terminals, etc. for rail/sea journeys (max 5 types)
      body.includedPrimaryTypes = ['train_station', 'transit_station', 'subway_station', 'light_rail_station', 'ferry_terminal'];
    } else if (type === 'business') {
      // Service contacts: match both businesses and street addresses (no
      // primary-type filter so a plumber name *or* an address resolves).
      body.includedRegionCodes = [region ?? 'CA'];
    } else {
      body.includedPrimaryTypes = ['establishment'];
      // No coords to bias with — restricting to the user's country is the
      // only locality signal left (keeps "beach" from resolving to India).
      if (!hasCoords && region) body.includedRegionCodes = [region];
    }

    const { data } = await axios.post(
      `${BASE}/places:autocomplete`,
      body,
      { headers: { 'X-Goog-Api-Key': apiKey, 'Content-Type': 'application/json' } },
    );

    const predictions = (data.suggestions ?? [])
      .map(s => s.placePrediction)
      .filter(Boolean)
      .map(p => ({
        place_id:       p.placeId,
        description:    p.text?.text ?? '',
        main_text:      p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        secondary_text: p.structuredFormat?.secondaryText?.text ?? '',
      }));

    res.json({ predictions });
  } catch (err) {
    console.error('[Places] error:', err.response?.data ?? err.message);
    res.status(500).json({ error: err.response?.data?.error?.message ?? err.message });
  }
});

router.get('/details/:placeId', async (req, res) => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Google Places API key not configured' });

  try {
    const { data } = await axios.get(
      `${BASE}/places/${req.params.placeId}`,
      {
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'formattedAddress,nationalPhoneNumber,internationalPhoneNumber,displayName',
        },
      },
    );

    res.json({
      result: {
        formatted_address:         data.formattedAddress,
        formatted_phone_number:    data.nationalPhoneNumber,
        international_phone_number: data.internationalPhoneNumber,
        name: data.displayName?.text,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.error?.message ?? err.message });
  }
});

// Resolve the IANA timezone (e.g. "Europe/Rome") for a place — used to
// auto-populate a trip's destination timezone label.
router.get('/timezone/:placeId', async (req, res) => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Google Places API key not configured' });

  try {
    const { data: place } = await axios.get(
      `${BASE}/places/${req.params.placeId}`,
      { headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'location' } },
    );
    const loc = place.location;
    if (!loc) return res.status(404).json({ error: 'No location for place' });

    const { data: tz } = await axios.get(
      'https://maps.googleapis.com/maps/api/timezone/json',
      {
        params: {
          location: `${loc.latitude},${loc.longitude}`,
          timestamp: Math.floor(Date.now() / 1000),
          key: apiKey,
        },
      },
    );
    if (tz.status !== 'OK') return res.status(502).json({ error: tz.status || 'Timezone lookup failed' });

    res.json({ timeZoneId: tz.timeZoneId, timeZoneName: tz.timeZoneName });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.error?.message ?? err.message });
  }
});

router.get('/travel-time', async (req, res) => {
  const { destination, origin } = req.query;
  if (!destination) return res.status(400).json({ error: 'destination required' });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Google Places API key not configured' });

  const homeAddress = origin?.trim() || (req.household || req.user).homeAddress;
  if (!homeAddress) return res.status(400).json({ error: 'No starting address — set one in Settings or type it in the From field' });

  try {
    const { data } = await axios.post(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        origin:      { address: homeAddress },
        destination: { address: destination },
        travelMode:  'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
      },
      {
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
          'Content-Type': 'application/json',
        },
      },
    );

    const route = data.routes?.[0];
    if (!route) return res.status(404).json({ error: 'No route found' });

    const seconds    = parseInt(route.duration, 10);
    const minutes    = Math.ceil(seconds / 60);
    const distanceKm = ((route.distanceMeters ?? 0) / 1000).toFixed(1);

    res.json({ minutes, distanceKm });
  } catch (err) {
    const msg = err.response?.data?.error?.message ?? err.message;
    res.status(500).json({ error: msg });
  }
});

// Travel time between two bookings (cached). Body: originPlaceId/originAddress,
// destPlaceId/destAddress, mode. Returns { minutes, distanceKm }.
router.post('/route-leg', async (req, res) => {
  const { originPlaceId, originAddress, destPlaceId, destAddress, mode = 'DRIVE', departureTime } = req.body || {};
  const originKey = originPlaceId ? `place:${originPlaceId}` : (originAddress ? `addr:${originAddress.toLowerCase().trim()}` : null);
  const destKey   = destPlaceId   ? `place:${destPlaceId}`   : (destAddress   ? `addr:${destAddress.toLowerCase().trim()}`   : null);
  if (!originKey || !destKey) return res.status(400).json({ error: 'origin and destination required' });
  if (originKey === destKey) return res.json({ minutes: 0, distanceKm: 0, sameLocation: true });

  try {
    const cached = await TravelLeg.findOne({ originKey, destKey, mode }).lean();
    if (cached && Date.now() - new Date(cached.computedAt).getTime() < LEG_FRESH_MS) {
      return res.json({ minutes: cached.minutes, distanceKm: cached.distanceKm, cached: true });
    }

    const result = await routeLeg({
      origin:      { placeId: originPlaceId, address: originAddress },
      destination: { placeId: destPlaceId,   address: destAddress },
      mode,
      departureTime,
    });
    // No route (e.g. no transit service / coverage) — 200 so it isn't a console error.
    if (!result) return res.json({ minutes: null, distanceKm: null, error: 'no_route' });

    await TravelLeg.findOneAndUpdate(
      { originKey, destKey, mode },
      { minutes: result.minutes, distanceKm: result.distanceKm, computedAt: new Date() },
      { upsert: true },
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
