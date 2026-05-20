async function fetchRaceDetail(race) {
  if (!race || !race.raceId) {
    throw new Error('レース情報がありません。');
  }

  const url = `https://race.netkeiba.com/race/shutuba.html?race_id=${race.raceId}`;

  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    let horses = parseHorseRows($);

    const header = cleanText($('.RaceData01').first().text());
    const subHeader = cleanText($('.RaceData02').first().text());
    const { surface, distance } = parseSurfaceDistance(header);

    const validNumberCount = horses.filter(h =>
      /^\d{1,2}$/.test(String(h.number || ''))
    ).length;

    if (horses.length < 5 || validNumberCount < 5) {
      const fallback = getFallbackHorses(race.raceId);
      if (fallback.length >= 5) {
        horses = fallback;
      }
    }

    return {
      ...race,
      url,
      header,
      subHeader,
      surface: race.surface || surface,
      distance: race.distance || distance,
      horseCountParsed: horses.length,
      enoughHorseCount: horses.length,
      hasEnoughForm: horses.length >= 5,
      paceText: '取得済み馬名だけで推定してください。不明情報は作らないでください。',
      horses
    };
  } catch (error) {
    const fallback = getFallbackHorses(race.raceId);

    if (fallback.length >= 5) {
      return {
        ...race,
        url,
        header: '',
        subHeader: '',
        surface: race.surface || '',
        distance: race.distance || '',
        horseCountParsed: fallback.length,
        enoughHorseCount: fallback.length,
        hasEnoughForm: true,
        paceText: `netkeiba取得エラーのため固定補助データ使用。エラー：${error.message}`,
        horses: fallback
      };
    }

    throw error;
  }
}