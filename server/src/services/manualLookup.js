const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

// Phrasing differs by item type: vehicles use "owner's manual", everything else "user manual".
function manualPhrase(type) {
  return type === 'vehicle' ? "owner's manual" : 'user manual';
}

function buildFallbackLinks({ type, terms }) {
  const phrase = manualPhrase(type);
  const q = encodeURIComponent(`${terms} ${phrase} PDF`);

  const links = [
    {
      title: `Search ManualsLib for ${terms}`,
      url: `https://www.manualslib.com/search?q=${encodeURIComponent(terms)}`,
      domain: 'manualslib.com',
      snippet: 'Large database of product and owner manuals',
    },
    {
      title: `Google: "${terms} ${phrase} PDF"`,
      url: `https://www.google.com/search?q=${q}`,
      domain: 'google.com',
      snippet: 'Search Google for a PDF of this manual',
    },
  ];

  // Automotive manufacturer portals only make sense for vehicles.
  if (type === 'vehicle') {
    const makeSlug = (terms.split(' ').find(Boolean) || '').toLowerCase();
    const mfgPortals = {
      toyota:     'https://www.toyota.com/owners/resources/warranty-owners-manuals',
      lexus:      'https://www.lexus.com/owners/resources/warranty-owners-manuals',
      honda:      'https://owners.honda.com/vehicles/information/manuals',
      acura:      'https://www.acura.com/tools/owners-manual',
      ford:       'https://www.ford.com/support/how-tos/ford-owner/owner-information/how-do-i-find-my-owner-manual/',
      lincoln:    'https://www.lincoln.com/support/owner-manuals/',
      chevrolet:  'https://my.chevrolet.com/learn',
      gmc:        'https://my.gmc.com/learn',
      buick:      'https://my.buick.com/learn',
      cadillac:   'https://my.cadillac.com/learn',
      dodge:      'https://www.mopar.com/en-us/vehicle-resources/owners-manual.html',
      ram:        'https://www.mopar.com/en-us/vehicle-resources/owners-manual.html',
      jeep:       'https://www.mopar.com/en-us/vehicle-resources/owners-manual.html',
      chrysler:   'https://www.mopar.com/en-us/vehicle-resources/owners-manual.html',
      nissan:     'https://www.nissanusa.com/owners.html',
      infiniti:   'https://www.infiniti.com/owners-manuals',
      hyundai:    'https://www.hyundaiusa.com/us/en/support/owners-manuals',
      kia:        'https://www.kia.com/us/en/owners/resources',
      subaru:     'https://www.subaru.com/owners/index.html',
      mazda:      'https://www.mazdausa.com/tools-and-support',
      volkswagen: 'https://www.vw.com/en/models/how-tos/owner-s-manual.html',
      bmw:        'https://www.bmwusa.com/owner-resources/bmw-manuals.html',
      mini:       'https://www.miniusa.com/owner/resources/manuals.html',
      mercedes:   'https://www.mbusa.com/en/owners/manuals',
      audi:       'https://www.audiusa.com/us/web/en/owners.html',
      porsche:    'https://www.porsche.com/usa/owners/information/',
      volvo:      'https://www.volvocars.com/us/support/manuals-and-guides',
      jaguar:     'https://www.jaguarusa.com/owners/owners-information/index.html',
      landrover:  'https://www.landroverusa.com/owners/owners-information/index.html',
      tesla:      'https://www.tesla.com/ownersmanual',
    };

    const portal = mfgPortals[makeSlug];
    if (portal) {
      links.push({
        title: `${makeSlug.charAt(0).toUpperCase() + makeSlug.slice(1)} Official Owner's Manual Portal`,
        url: portal,
        domain: new URL(portal).hostname.replace(/^www\./, ''),
        snippet: `Official resource for finding owner's manuals`,
        type: 'search-link',
      });
    }
  }

  return links.map(l => ({ ...l, type: l.type || 'search-link' }));
}

const REVIEW_PROMPT = `You are helping a user find the best product/owner's manual PDF for their item.
Given a list of candidate PDF links, identify the single best option — the one most likely to be the complete official manual for the exact item described.

Prefer in this order:
1. Official manufacturer PDF for the exact make/model
2. PDF from a reputable manual database (e.g. manualslib.com, or the manufacturer's own site)
3. Any other direct PDF that appears to be the complete manual (not a quick-start guide or supplement)

Return ONLY a JSON object — no markdown, no explanation:
{ "recommendedIndex": <number> }`;

async function rankWithClaude(candidates, itemDesc) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || candidates.length <= 1) return candidates;

  console.log('[auto-lookup] Step 2 — Claude ranking', candidates.length, 'candidates');
  try {
    const list = candidates
      .map((c, i) => `[${i}] ${c.title}\n    URL: ${c.url}\n    ${c.snippet || ''}`)
      .join('\n\n');

    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 64,
      system: REVIEW_PROMPT,
      messages: [{ role: 'user', content: `Item: ${itemDesc}\n\nCandidates:\n${list}` }],
    });

    const raw = msg.content[0]?.text || '';
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const { recommendedIndex: idx } = JSON.parse(jsonStr);

    if (typeof idx === 'number' && idx >= 0 && idx < candidates.length) {
      candidates[idx] = { ...candidates[idx], recommended: true };
      const best = candidates.splice(idx, 1)[0];
      candidates.unshift(best);
    }
  } catch (err) {
    console.warn('[auto-lookup] Claude ranking failed:', err.message, '— returning unranked');
  }
  return candidates;
}

async function findManuals({ type, terms }) {
  const braveKey = process.env.BRAVE_SEARCH_KEY;
  if (!braveKey) {
    console.warn('[ManualLookup] No BRAVE_SEARCH_KEY — using fallback links');
    return buildFallbackLinks({ type, terms });
  }

  const query = `${terms} ${manualPhrase(type)} filetype:pdf`;
  console.log('[auto-lookup] searching:', { type, terms }, 'braveKey:', !!braveKey);

  try {
    const response = await axios.get(BRAVE_SEARCH_URL, {
      headers: {
        'X-Subscription-Token': braveKey,
        'Accept': 'application/json',
      },
      params: { q: query, count: 10, search_lang: 'en' },
      timeout: 10000,
    });

    const results = response.data?.web?.results || [];

    const candidates = results
      .filter(r => r.url && r.title && /\.pdf(\?.*)?$/i.test(r.url))
      .slice(0, 6)
      .map(r => {
        let domain = '';
        try { domain = new URL(r.url).hostname.replace(/^www\./, ''); } catch {}
        return {
          title: r.title,
          url: r.url,
          domain,
          snippet: r.description || '',
        };
      });

    console.log('[auto-lookup] found:', candidates.length, 'isFallback: false');
    if (!candidates.length) return buildFallbackLinks({ type, terms });

    return await rankWithClaude(candidates, terms);
  } catch (err) {
    console.error('[ManualLookup] Brave search failed:', err.message);
    return buildFallbackLinks({ type, terms });
  }
}

module.exports = { findManuals };
