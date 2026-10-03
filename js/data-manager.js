const DataManager = (() => {
  let database = [];
  let nameIndex = new Map();

  async function init() {
    const resp = await fetch('/api/danh-nhan');
    if (!resp.ok) throw new Error('Failed to load danh-nhan data');
    database = await resp.json();
    buildIndex();
  }

  function buildIndex() {
    nameIndex.clear();
    for (const person of database) {
      indexName(person.name, person);
      if (person.realName) indexName(person.realName, person);
      if (person.aliases) {
        for (const alias of person.aliases) {
          indexName(alias, person);
        }
      }
    }
  }

  function indexName(name, person) {
    const normalized = normalize(name);
    nameIndex.set(normalized, person);
    const words = normalized.split(/\s+/);
    if (words.length >= 2) {
      nameIndex.set(words.slice(-2).join(' '), person);
    }
  }

  function normalize(str) {
    return str.toLowerCase()
      .replace(/[""'']/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripStreetPrefix(streetName) {
    const prefixes = [
      'phố', 'đường', 'ngõ', 'ngách', 'phường', 'quận',
      'tổ', 'khu', 'thôn', 'xóm', 'hẻm'
    ];
    let name = streetName.trim();
    for (const prefix of prefixes) {
      const re = new RegExp('^' + prefix + '\\s+', 'i');
      name = name.replace(re, '');
    }
    return name.trim();
  }

  function matchStreetName(streetName) {
    if (!streetName) return null;
    const stripped = stripStreetPrefix(streetName);
    const normalized = normalize(stripped);

    const exact = nameIndex.get(normalized);
    if (exact) return exact;

    for (const [key, person] of nameIndex) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return person;
      }
    }

    return null;
  }

  function search(query) {
    if (!query || query.length < 2) return [];
    const q = normalize(query);
    const results = [];
    const seen = new Set();

    for (const person of database) {
      if (seen.has(person.id)) continue;
      const haystack = normalize(
        [person.name, person.realName, person.title, ...(person.aliases || [])].join(' ')
      );
      if (haystack.includes(q)) {
        results.push(person);
        seen.add(person.id);
      }
    }
    return results;
  }

  function getAll() {
    return [...database];
  }

  function getById(id) {
    return database.find(p => p.id === id) || null;
  }

  async function fetchWikiSummary(wikiSlug) {
    if (!wikiSlug) return null;
    try {
      const url = `https://vi.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiSlug)}`;
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const data = await resp.json();
      return {
        extract: data.extract || '',
        thumbnail: data.thumbnail ? data.thumbnail.source : null,
        url: data.content_urls?.desktop?.page || `https://vi.wikipedia.org/wiki/${wikiSlug}`
      };
    } catch {
      return null;
    }
  }

  return { init, matchStreetName, search, getAll, getById, fetchWikiSummary };
})();
