const modes = ['listen', 'melody', 'rhythm', 'recital'];
const hands = ['both', 'left', 'right'];
export const practicePreferenceKey = (songId, profile) => JSON.stringify([profile, songId]);

/** Only deliberate choices belong here; suggested exercise settings are temporary. */
export function normalizePracticePreferences(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, entry] of Object.entries(value).slice(0, 2048)) {
    try {
      const identity = JSON.parse(key);
      if (!Array.isArray(identity) || identity.length !== 2 || !identity.every(part => typeof part === 'string' && part.length > 0 && part.length <= 200) || !entry || typeof entry !== 'object') continue;
      const preference = {};
      if (Number.isFinite(entry.speed) && entry.speed >= .2 && entry.speed <= 1.5) preference.speed = Math.round(entry.speed * 100) / 100;
      if (modes.includes(entry.mode)) preference.mode = entry.mode;
      if (hands.includes(entry.hands)) preference.hands = entry.hands;
      if (Object.keys(preference).length) result[key] = preference;
    } catch { /* Ignore malformed imported preferences. */ }
  }
  return result;
}

export function practicePreference(preferences, songId, profile) {
  return preferences?.[practicePreferenceKey(songId, profile)] || {};
}
